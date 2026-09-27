'use strict';
/* FloodSim HADR backend — zero-dependency Node.js HTTP server.
 *   node server/index.js   (or: npm run dev)   →  http://localhost:8080
 * Serves the dashboard (public/) and the REST API (/api/*). Heavy work runs in worker threads;
 * results are stored as files under data/results/ (no database). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const A = require('../public/js/analysis.js');
const X = require('../public/js/geoexport.js');
const dams = require('./data/dams.js');
const hydro = require('./data/hydrology.js');
const demLib = require('./data/dem.js');
const delft3d = require('./delft3d.js');
const { RESULTS, UPLOADS, CACHE, STEPS } = require('./pipeline.js');

const PORT = +process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
[RESULTS, UPLOADS, CACHE].forEach((d) => fs.mkdirSync(d, { recursive: true }));
const VERSION = '1.0.0';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

// ---------- helpers ----------
function send(res, code, body, headers, req) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  if (!h['Content-Type']) h['Content-Type'] = typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json';
  if (req && buf.length > 2048 && !h['Content-Encoding'] && /gzip/.test(req.headers['accept-encoding'] || '') && /json|text|javascript|xml/.test(h['Content-Type'])) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length;
  res.writeHead(code, h);
  res.end(buf);
}
const json = (res, obj, req, code) => send(res, code || 200, obj, { 'Content-Type': 'application/json' }, req);
const fail = (res, code, msg) => send(res, code, { error: msg }, { 'Content-Type': 'application/json' });
function readBody(req, limit) {
  return new Promise((ok, bad) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { bad(new Error('Request body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', bad);
  });
}
const safeId = (id) => /^[a-z0-9-]{3,80}$/i.test(id || '');

// ---------- scenario store ----------
function listScenarios() {
  if (!fs.existsSync(RESULTS)) return [];
  return fs.readdirSync(RESULTS).filter((d) => fs.existsSync(path.join(RESULTS, d, 'meta.json')))
    .map((d) => { try { const m = JSON.parse(fs.readFileSync(path.join(RESULTS, d, 'meta.json'), 'utf8')); delete m.log; return m; } catch (e) { return null; } })
    .filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
const scnCache = new Map();
function loadScenario(id) {
  if (scnCache.has(id)) return scnCache.get(id);
  const f = path.join(RESULTS, id, 'scenario.json.gz');
  if (!fs.existsSync(f)) return null;
  const scn = A.unpackScenario(JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')));
  scnCache.set(id, scn);
  if (scnCache.size > 3) scnCache.delete(scnCache.keys().next().value);
  return scn;
}

// ---------- jobs (one running at a time; others queued) ----------
const jobs = new Map(), queue = [];
let running = null;
function startNext() {
  if (running || !queue.length) return;
  const job = queue.shift();
  running = job;
  job.status = 'running'; job.startedAt = new Date().toISOString();
  const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { req: job.req } });
  job.worker = w;
  w.on('message', (m) => {
    if (m.type === 'progress') Object.assign(job, m.p);
    if (m.type === 'done') { job.status = 'done'; job.progress = 1; job.scenarioId = m.meta.id; job.meta = m.meta; }
    if (m.type === 'error') { job.status = 'error'; job.error = m.error; console.error('[job', job.id, ']', m.stack || m.error); }
  });
  const end = () => { if (job.status === 'running') { job.status = 'error'; job.error = job.error || 'Worker exited unexpectedly'; } job.finishedAt = new Date().toISOString(); job.worker = null; running = null; startNext(); };
  w.on('error', (e) => { job.status = 'error'; job.error = e.message; end(); });
  w.on('exit', end);
}
const publicJob = (j) => ({ id: j.id, status: j.status, step: j.step ?? 0, stepName: j.stepName || STEPS[0], steps: STEPS, progress: j.progress || 0, message: j.message || (j.status === 'queued' ? `Queued (${queue.indexOf(j) + 1} ahead)` : ''), log: j.log || [], stepTimes: j.stepTimes || [], scenarioId: j.scenarioId || null, error: j.error || null, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, dam: j.req.dam && j.req.dam.name });

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/health') {
    return json(res, { ok: true, version: VERSION, time: new Date().toISOString(), engines: { sph: { available: true, name: 'SPH-SWE particle solver (in-house)' }, swe: { available: true, name: 'Finite-volume HLL 2D SWE solver (in-house, Delft3D-class)' }, delft3d: delft3d.status() }, gee: { connected: false, reason: 'No Earth Engine credentials configured — GEE scripts are generated per scenario' }, data: { dem: 'AWS Terrain Tiles (Terrarium, SRTM-derived)', osm: 'Overpass API', dams: 'Wikidata snapshot' }, jobs: { running: running ? running.id : null, queued: queue.length } }, req);
  }
  if (p === '/api/dams' && m === 'GET') {
    const all = dams.listDams();
    const list = Array.isArray(all) ? all : all.dams || [];
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const out = list.filter((d) => !q || [d.name, d.river, d.state].some((x) => x && String(x).toLowerCase().includes(q)));
    return json(res, { count: out.length, total: list.length, source: 'Wikidata (CC0) snapshot', dams: out.slice(0, +(url.searchParams.get('limit') || 500)) }, req);
  }
  if (p === '/api/breach' && m === 'POST') {
    const b = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
    if (!(b.heightM > 0 && b.storageMCM > 0)) return fail(res, 400, 'heightM and storageMCM required');
    return json(res, hydro.breachParams({ heightM: +b.heightM, storageMCM: +b.storageMCM, mode: b.mode || 'overtopping' }), req);
  }
  if (p === '/api/dem' && m === 'POST') {
    const text = (await readBody(req, 80e6)).toString('utf8');
    const parsed = demLib.parseEsriAscii(text);
    const id = 'dem-' + crypto.randomBytes(5).toString('hex');
    fs.writeFileSync(path.join(UPLOADS, id + '.asc'), text);
    const s = parsed.spec;
    return json(res, { id, rows: s.rows, cols: s.cols, north: s.north, west: s.west, south: s.south ?? s.north - s.rows * s.dLat, east: s.east ?? s.west + s.cols * s.dLng }, req);
  }
  if (p === '/api/jobs' && m === 'POST') {
    const body = JSON.parse((await readBody(req, 2e6)).toString() || '{}');
    if (!body.dam || !isFinite(body.dam.lat) || !isFinite(body.dam.lng)) return fail(res, 400, 'dam.lat and dam.lng required');
    const job = { id: 'job-' + crypto.randomBytes(5).toString('hex'), status: 'queued', req: body, createdAt: new Date().toISOString(), progress: 0 };
    jobs.set(job.id, job); queue.push(job); startNext();
    return json(res, publicJob(job), req, 202);
  }
  if (p === '/api/jobs' && m === 'GET') return json(res, [...jobs.values()].map(publicJob).reverse(), req);
  let mm;
  if ((mm = p.match(/^\/api\/jobs\/([\w-]+)$/))) {
    const j = jobs.get(mm[1]);
    if (!j) return fail(res, 404, 'job not found');
    if (m === 'DELETE') { if (j.worker) j.worker.terminate(); const qi = queue.indexOf(j); if (qi >= 0) queue.splice(qi, 1); j.status = 'cancelled'; return json(res, publicJob(j), req); }
    return json(res, publicJob(j), req);
  }
  if (p === '/api/scenarios' && m === 'GET') return json(res, listScenarios(), req);
  if ((mm = p.match(/^\/api\/scenarios\/([\w-]+)$/)) && safeId(mm[1])) {
    const f = path.join(RESULTS, mm[1], 'scenario.json.gz');
    if (m === 'DELETE') { fs.rmSync(path.join(RESULTS, mm[1]), { recursive: true, force: true }); scnCache.delete(mm[1]); return json(res, { deleted: mm[1] }, req); }
    if (!fs.existsSync(f)) return fail(res, 404, 'scenario not found');
    const buf = fs.readFileSync(f);
    if (/gzip/.test(req.headers['accept-encoding'] || '')) return send(res, 200, buf, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    return send(res, 200, zlib.gunzipSync(buf), { 'Content-Type': 'application/json' });
  }
  if ((mm = p.match(/^\/api\/scenarios\/([\w-]+)\/export\/(\w+)$/)) && safeId(mm[1])) {
    const id = mm[1], fmt = mm[2], key = url.searchParams.get('model') === 'sph' ? 'sph' : 'delft3d';
    const dir = path.join(RESULTS, id);
    if (fmt === 'gee') return send(res, 200, fs.readFileSync(path.join(dir, 'gee_flood_mapping.js'), 'utf8'), { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}_gee_flood_mapping.js"` });
    if (fmt === 'delft3d') {
      const dd = path.join(dir, 'delft3d');
      const files = fs.readdirSync(dd).map((n) => ({ name: n, data: new Uint8Array(fs.readFileSync(path.join(dd, n))) }));
      return send(res, 200, Buffer.from(X.zip(files)), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${id}_delft3d_flow_deck.zip"` });
    }
    if (fmt === 'delft3d-run') return json(res, delft3d.run(path.join(dir, 'delft3d')), req);
    const scn = loadScenario(id);
    if (!scn) return fail(res, 404, 'scenario not found');
    const M = scn.models[key];
    const ana = A.analyse(scn, key, { t0: 15 });
    const base = `${id}_${key}`;
    if (fmt === 'kml') return send(res, 200, X.kml(scn, M, ana, scn.name), { 'Content-Type': 'application/vnd.google-earth.kml+xml', 'Content-Disposition': `attachment; filename="${base}.kml"` }, req);
    if (fmt === 'geojson') return send(res, 200, JSON.stringify(X.geojson(scn, M, ana)), { 'Content-Type': 'application/geo+json', 'Content-Disposition': `attachment; filename="${base}.geojson"` }, req);
    if (fmt === 'shp') return send(res, 200, Buffer.from(X.shapefileZip(scn, M, scn.name)), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${base}_shp.zip"` });
    if (fmt === 'asc') {
      const files = [['max_depth_m', M.dmax], ['max_velocity_ms', M.vmax], ['arrival_min', M.arr], ['duration_min', M.dur], ['dem_m', scn.dem]].map(([n, a]) => ({ name: `${base}_${n}.asc`, data: X.asciiGrid(scn, a, -9999) }));
      files.push(...files.map((f) => ({ name: f.name.replace('.asc', '.prj'), data: X.PRJ })));
      return send(res, 200, Buffer.from(X.zip(files)), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${base}_rasters.zip"` });
    }
    return fail(res, 400, 'unknown export format');
  }
  return fail(res, 404, 'unknown API route');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const f = path.normalize(path.join(PUBLIC, rel));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return fail(res, 404, 'not found');
  send(res, 200, fs.readFileSync(f), { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, req);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, 500, err.message || String(err));
  }
});
server.listen(PORT, () => {
  console.log(`\n  FloodSim HADR backend v${VERSION}`);
  console.log(`  Dashboard + API:  http://localhost:${PORT}`);
  console.log(`  Delft3D: ${delft3d.status().reason}`);
  console.log('  Press Ctrl+C to stop.\n');
});
