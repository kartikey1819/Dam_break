'use strict';
/* End-to-end scenario pipeline (runs inside a worker thread).
 *  1 DEM (AWS Terrain Tiles / uploaded ESRI ASCII)      6 inundation rasters → scenario models
 *  2 hydrology (Froehlich breach + hydrograph)           7 OSM features (villages, roads, facilities)
 *  3 domain, reservoir mask, breach source cells          8 impact + safe zones
 *  4 SPH-SWE particle solver                              9 arrival-time zones
 *  5 SWE finite-volume solver (+ Delft3D-FLOW deck)      10 HADR priority → 11 store results */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const A = require('../public/js/analysis.js');
const dem = require('./data/dem.js');
const hydro = require('./data/hydrology.js');
const osm = require('./data/osm.js');
const swe = require('./solvers/swe.js');
const sph = require('./solvers/sph.js');
const delft3d = require('./delft3d.js');
const gee = require('./gee.js');
const { buildFeatures } = require('./features.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const RESULTS = path.join(ROOT, 'data', 'results');
const UPLOADS = path.join(ROOT, 'data', 'uploads');

const STEPS = ['Loading DEM', 'Preparing hydrological inputs', 'Generating dam-break scenario', 'Running SPH model', 'Running Delft3D model', 'Generating inundation map', 'Calculating impact statistics', 'Generating village/infrastructure impact', 'Calculating flood arrival-time zones', 'Generating HADR priority analysis', 'Simulation complete'];
// share of total progress per step
const WEIGHT = [0.06, 0.02, 0.06, 0.3, 0.3, 0.03, 0.12, 0.06, 0.01, 0.03, 0.01];

function parseHydrographCsv(text) {
  const t = [], q = [];
  text.split(/\r?\n/).forEach((l) => { const m = l.split(/[,;\t ]+/).map(Number); if (m.length >= 2 && isFinite(m[0]) && isFinite(m[1])) { t.push(m[0] * 60); q.push(m[1]); } });
  if (t.length < 2) throw new Error('Hydrograph CSV needs ≥ 2 rows of "time_min,discharge_m3s"');
  return { t, q };
}
function hydroVolume(h) { let v = 0; for (let k = 1; k < h.t.length; k++) v += ((h.q[k] + h.q[k - 1]) / 2) * (h.t[k] - h.t[k - 1]); return v; }

async function runPipeline(req, report) {
  const t0 = Date.now();
  const log = [];
  let stepIdx = 0, stepStart = Date.now();
  const stepTimes = [];
  const say = (msg) => { log.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`); };
  const progress = (frac, msg) => {
    const base = WEIGHT.slice(0, stepIdx).reduce((a, b) => a + b, 0);
    report({ step: stepIdx, stepName: STEPS[stepIdx], progress: Math.min(0.999, base + WEIGHT[stepIdx] * Math.max(0, Math.min(1, frac))), message: msg || STEPS[stepIdx], log: log.slice(-30), stepTimes });
  };
  const next = (msg) => { stepTimes[stepIdx] = Date.now() - stepStart; stepIdx++; stepStart = Date.now(); say(STEPS[stepIdx] + (msg ? ' — ' + msg : '')); progress(0, msg); };

  const damIn = req.dam || {};
  const cfg = Object.assign({ type: 'Dam Break', reachKm: 60, bufferKm: 10, resolution: 'auto', maxCells: 70000, duration: 360, manning: 0.035, maxParticles: 12000, eventDate: new Date().toISOString().slice(0, 10) }, req.config || {});
  if (!(damIn.lat && damIn.lng)) throw new Error('Dam location (lat, lng) is required');
  const heightM = +cfg.heightM || +damIn.heightM || null;
  const storageMCM = +cfg.storageMCM || +damIn.storageMCM || null;
  if (!heightM || !storageMCM) throw new Error('Dam height (m) and released storage (MCM) are required — Wikidata does not provide them for this dam, please enter values');
  const durationSec = cfg.duration * 60;
  const sources = [];

  // ---------- 1. DEM + flow path ----------
  say(STEPS[0]); progress(0);
  const reachDeg = (cfg.reachKm * 1.15) / 111;
  let upload = null;
  if (cfg.demUploadId) {
    const f = path.join(UPLOADS, cfg.demUploadId + '.asc');
    if (!fs.existsSync(f)) throw new Error('Uploaded DEM not found: ' + cfg.demUploadId);
    upload = dem.parseEsriAscii(fs.readFileSync(f, 'utf8'));
    sources.push(['DEM', `User-uploaded ESRI ASCII grid (${cfg.demUploadId})`, 'REAL']);
  }
  const getGrid = async (spec) => (upload ? { z: dem.resampleToSpec(upload.spec, upload.z, spec), source: 'Uploaded DEM', zoom: null } : dem.getDEMGrid(spec, { cacheDir: CACHE }));
  const coarseSpec = dem.makeGridSpec({ south: damIn.lat - reachDeg, north: damIn.lat + reachDeg * 0.3, west: damIn.lng - reachDeg, east: damIn.lng + reachDeg }, 450);
  const coarse = await getGrid(coarseSpec);
  progress(0.5, 'Tracing downstream flow path on DEM');
  const fp = hydro.flowPath(coarseSpec, coarse.z, damIn.lat, damIn.lng, cfg.reachKm);
  if (!fp.path || fp.path.length < 3) throw new Error('Could not trace a downstream flow path from the dam location on the DEM');
  const river = fp.path;
  say(`Flow path traced: ${fp.km[fp.km.length - 1].toFixed(1)} km (${coarse.source}${coarse.zoom ? ', zoom ' + coarse.zoom : ''})`);
  if (!upload) sources.push(['DEM', `${coarse.source}`, 'REAL']);
  sources.push(['River course', 'D8 steepest-descent flow path on the DEM (priority-flood filled)', 'DERIVED']);

  // ---------- 2. hydrology ----------
  next();
  const mode = cfg.type === 'River Blockage / Lake Burst' ? 'piping' : 'overtopping';
  const bp = hydro.breachParams({ heightM, storageMCM, mode });
  const breachWidth = +cfg.breachWidth || bp.breachWidthM;
  const breachTimeMin = +cfg.breachTime || bp.failureTimeMin;
  let Qp = +cfg.peakDischarge || bp.peakQ_Froehlich1995;
  let volume = storageMCM * 1e6;
  if (cfg.type === 'Sudden Water Release') { Qp = +cfg.peakDischarge || Math.round(bp.peakQ_Froehlich1995 * 0.3); volume = storageMCM * 1e6 * (cfg.releaseFraction || 0.25); }
  let hydrograph = cfg.hydrographCsv ? parseHydrographCsv(cfg.hydrographCsv) : hydro.breachHydrograph({ Qp, tfSec: breachTimeMin * 60, volumeM3: volume, durationSec, dtSec: 60 });
  Qp = Math.max(...hydrograph.q);
  const inflowVol = hydroVolume(hydrograph);
  say(`Breach: width ${breachWidth.toFixed(0)} m, formation ${breachTimeMin.toFixed(0)} min, Qp ${Qp.toFixed(0)} m³/s, hydrograph volume ${(inflowVol / 1e6).toFixed(1)} Mm³ (${cfg.hydrographCsv ? 'user CSV' : 'Froehlich'})`);
  sources.push(['Dam attributes', damIn.source || 'User input', damIn.source && /Wikidata/.test(damIn.source) ? 'REAL' : 'USER']);
  sources.push(['Breach hydrograph', cfg.hydrographCsv ? 'User-supplied CSV' : 'Froehlich (2008) breach width/time; Froehlich (1995) peak discharge', cfg.hydrographCsv ? 'USER' : 'DERIVED']);

  // ---------- 3. model domain ----------
  next();
  let s = 90, n = -90, w = 180, e = -180;
  river.forEach(([la, ln]) => { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, ln); e = Math.max(e, ln); });
  const bufLat = cfg.bufferKm / 111, bufLng = cfg.bufferKm / (111 * Math.cos((damIn.lat * Math.PI) / 180));
  const bbox = { south: s - bufLat, north: n + bufLat * 0.4, west: w - bufLng, east: e + bufLng };
  const areaM2 = (bbox.north - bbox.south) * 110574 * (bbox.east - bbox.west) * 111320 * Math.cos((damIn.lat * Math.PI) / 180);
  const res = cfg.resolution === 'auto' ? Math.max(90, Math.ceil(Math.sqrt(areaM2 / cfg.maxCells) / 10) * 10) : Math.max(60, +cfg.resolution);
  const spec = dem.makeGridSpec(bbox, res);
  const osmPromise = osm.getFeatures(bbox, { cacheDir: CACHE }).catch((err) => ({ ok: false, error: String(err), places: [], roads: [], amenities: [], waterways: [] }));
  progress(0.3, `Fetching ${spec.cols}×${spec.rows} DEM at ${res} m`);
  const fine = await getGrid(spec);
  const cosL = Math.cos((((spec.north + (spec.south ?? spec.north - spec.rows * spec.dLat)) / 2) * Math.PI) / 180);
  const grid = { rows: spec.rows, cols: spec.cols, north: spec.north, west: spec.west, dLat: spec.dLat, dLng: spec.dLng, n: spec.rows * spec.cols, dx: spec.dLng * 111320 * cosL, dy: spec.dLat * 110574, demSource: fine.source };
  grid.cellArea = (grid.dx * grid.dy) / 1e6;
  const z = fine.z;
  // reservoir mask: cells upstream of the dam (behind the breach) are inactive walls
  const dir = hydro.downstreamBearing(river); // [east, north]
  const mask = new Uint8Array(grid.n).fill(1);
  const damXY = [damIn.lng * 111320 * cosL, damIn.lat * 110574];
  const reservoirR = Math.max(3000, Math.sqrt((storageMCM * 1e6) / Math.max(5, heightM * 0.4)) * 1.2);
  for (let i = 0; i < grid.n; i++) {
    const [la, ln] = A.cellCenter(grid, i);
    const dx = ln * 111320 * cosL - damXY[0], dy = la * 110574 - damXY[1];
    const along = dx * dir[0] + dy * dir[1], d = Math.hypot(dx, dy);
    if (along < -Math.max(grid.dx, grid.dy) * 0.9 && d < reservoirR) mask[i] = 0;
  }
  // breach source cells: across the flow direction at the first downstream cell
  const srcCells = [];
  const nx = -dir[1], ny = dir[0];
  const halfW = Math.max(breachWidth / 2, Math.max(grid.dx, grid.dy) * 0.6);
  for (let k = -halfW; k <= halfW; k += Math.min(grid.dx, grid.dy) / 2) {
    const la = damIn.lat + (dir[1] * grid.dy * 1.2 + ny * k) / 110574, ln = damIn.lng + (dir[0] * grid.dx * 1.2 + nx * k) / (111320 * cosL);
    const i = A.cellIndex(grid, la, ln);
    if (i >= 0 && !srcCells.includes(i)) { srcCells.push(i); mask[i] = 1; }
  }
  // permanent water (river channel) mask from flow path + OSM rivers (added later)
  const channel = new Uint8Array(grid.n);
  A.densify(river, Math.min(grid.dx, grid.dy) / 2000).forEach((p) => { const i = A.cellIndex(grid, p[0], p[1]); if (i >= 0) channel[i] = 1; });
  say(`Domain ${grid.cols}×${grid.rows} cells @ ${res} m (${(areaM2 / 1e6).toFixed(0)} km²), ${srcCells.length} breach cells, reservoir radius ${(reservoirR / 1000).toFixed(1)} km masked`);

  const solverInput = {
    grid: { rows: grid.rows, cols: grid.cols, dx: grid.dx, dy: grid.dy }, z, mask, manning: cfg.manning,
    sources: [{ cells: srcCells, hydrograph, dir, speed: Math.min(8, 0.5 * Math.sqrt(9.81 * heightM)) }],
    duration: durationSec, frameInterval: 900, thresholds: { wet: 0.05, block: 0.3 }, cfl: 0.45,
    maxParticles: cfg.maxParticles
  };
  const toModel = (key, name, short, engine, r) => {
    const n2 = grid.n, m = (a) => { const f = new Float32Array(n2); for (let i = 0; i < n2; i++) f[i] = a[i] < 0 ? Infinity : a[i] / 60; return f; };
    const hz = new Float32Array(n2); for (let i = 0; i < n2; i++) hz[i] = r.dmax[i] > 0.05 ? r.dmax[i] * (r.vmax[i] + 0.5) : 0;
    const dur = new Float32Array(n2); for (let i = 0; i < n2; i++) dur[i] = r.dur[i] / 60;
    return { key, name, short, engine, label: 'SIMULATED (numerical solver, open-data inputs)', dmax: r.dmax, vmax: r.vmax, arr: m(r.arr), tblk: m(r.tblk), dur, hz, frames: { times: r.frames.map((f) => f.t / 60), h: r.frames.map((f) => f.h) }, Qp, stats: r.stats };
  };

  // ---------- 4. SPH ----------
  next(`particles ≤ ${cfg.maxParticles}`);
  const rSph = sph.run(solverInput, (f, msg) => progress(f, msg || 'SPH-SWE particle solver'));
  say(`SPH done: ${rSph.stats.steps} steps, ${rSph.stats.particles} particles, mass error ${(+rSph.stats.massErrorPct).toFixed(2)}%, ${(rSph.stats.runtimeMs / 1000).toFixed(1)} s`);

  // ---------- 5. SWE (Delft3D-class) + Delft3D deck ----------
  next();
  const rSwe = swe.run(solverInput, (f, msg) => progress(f, msg || 'SWE finite-volume solver'));
  say(`SWE done: ${rSwe.stats.steps} steps, mass error ${(+rSwe.stats.massErrorPct).toFixed(2)}%, ${(rSwe.stats.runtimeMs / 1000).toFixed(1)} s`);

  // ---------- 6. inundation rasters ----------
  next();
  const id = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${(damIn.name || 'dam').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
  const dir2 = path.join(RESULTS, id);
  fs.mkdirSync(dir2, { recursive: true });
  const scn = {
    id, mode: 'live', createdAt: new Date().toISOString(), name: `${damIn.name || 'Dam'} — ${cfg.type}`,
    dam: { name: damIn.name || 'Selected dam', qid: damIn.qid || null, lat: damIn.lat, lng: damIn.lng, river: damIn.river || null, state: damIn.state || null, heightM, storageMCM, source: damIn.source || 'User input', note: 'Hypothetical failure scenario for decision-support; not a prediction about this structure.' },
    river, riverSource: 'DEM-derived flow path (D8)',
    config: Object.assign({}, cfg, { waterLevel: heightM, storage: storageMCM, breachWidth: Math.round(breachWidth), breachTime: Math.round(breachTimeMin), peakDischarge: Math.round(Qp), resolution: res, hydrographCsv: cfg.hydrographCsv ? '(user CSV)' : undefined }),
    breach: Object.assign({}, bp, { breachWidthUsed: breachWidth, failureTimeUsed: breachTimeMin, peakQUsed: Qp, inflowVolumeM3: inflowVol }),
    hydrograph: { t: hydrograph.t.map((x) => x / 60), q: hydrograph.q },
    grid, dem: z, channel,
    models: {
      sph: toModel('sph', 'Smooth Particle Hydrodynamics', 'SPH', 'SPH-SWE depth-integrated particle solver (in-house, Node.js)', rSph),
      delft3d: toModel('delft3d', 'Delft3D-class 2D SWE', 'Delft3D-class', 'Finite-volume HLL shallow-water solver (in-house) — same 2DH equations as Delft3D-FLOW; Delft3D input deck exported', rSwe)
    },
    assumptions: { cropFraction: 0.6, personsPerHousehold: 4.8, valuePerHouseINR: 450000, cropValuePerHaINR: 60000 },
    sources, log
  };
  progress(0.5, 'Writing Delft3D-FLOW input deck');
  const deckFiles = delft3d.writeDeck(path.join(dir2, 'delft3d'), scn, { hydrograph, sourceCell: srcCells[Math.floor(srcCells.length / 2)], manning: cfg.manning, durationMin: cfg.duration });
  say(`Delft3D-FLOW deck written (${deckFiles.length} files)`);
  sources.push(['Delft3D', delft3d.status().available ? 'Delft3D 4 installation found' : 'Input deck generated — Delft3D not installed', delft3d.status().available ? 'REAL' : 'NOT CONNECTED']);

  // ---------- 7. OSM features ----------
  next('OpenStreetMap (Overpass)');
  const osmData = await osmPromise;
  if (!osmData.ok) say('OSM unavailable: ' + osmData.error);
  (osmData.waterways || []).filter((wy) => wy.waterway === 'river').forEach((wy) => A.densify(wy.geom, Math.min(grid.dx, grid.dy) / 2000).forEach((p) => { const i = A.cellIndex(grid, p[0], p[1]); if (i >= 0) channel[i] = 1; }));
  sources.push(['Villages / roads / facilities / bridges', osmData.ok ? `OpenStreetMap via Overpass (${osmData.source || ''}) — © OSM contributors, ODbL` : 'OpenStreetMap unavailable for this run', osmData.ok ? 'REAL' : 'NOT CONNECTED']);

  // ---------- 8. features + safe zones ----------
  next();
  scn.features = buildFeatures(osmData, scn);
  say(`Features: ${scn.features.villages.length} settlements, ${scn.features.roads.edges.length} road segments, ${scn.features.infra.length} facilities, ${scn.features.bridges.length} bridges, ${scn.features.safeZones.length} safe zones`);
  sources.push(['Population', 'OSM population tag where present, otherwise place-type default (ESTIMATE)', 'ESTIMATE']);

  // ---------- 9. arrival zones ----------
  next();
  const zones = {};
  Object.entries(scn.models).forEach(([k, M]) => { const c = [0, 0, 0, 0, 0]; for (let i = 0; i < grid.n; i++) { const a = A.arrClass(M.arr[i]); if (a >= 0 && M.dmax[i] > 0.05 && !channel[i]) c[a] += grid.cellArea; } zones[k] = c; });

  // ---------- 10. priority ----------
  next();
  const kpi = {};
  Object.keys(scn.models).forEach((k) => { const an = A.analyse(scn, k, { t0: 15 }); kpi[k] = an.kpi; });

  // ---------- 11. store ----------
  next();
  fs.writeFileSync(path.join(dir2, 'scenario.json.gz'), zlib.gzipSync(JSON.stringify(A.packScenario(scn))));
  fs.writeFileSync(path.join(dir2, 'gee_flood_mapping.js'), gee.script({ bbox: { south: grid.north - grid.rows * grid.dLat, north: grid.north, west: grid.west, east: grid.west + grid.cols * grid.dLng }, eventDate: cfg.eventDate, name: scn.name }));
  const meta = { id, name: scn.name, createdAt: scn.createdAt, dam: scn.dam, config: scn.config, grid: { rows: grid.rows, cols: grid.cols, res }, kpi, arrivalZonesKm2: zones, stats: { sph: rSph.stats, delft3d: rSwe.stats }, runtimeSec: (Date.now() - t0) / 1000, stepTimes, osm: scn.features.counts, log };
  fs.writeFileSync(path.join(dir2, 'meta.json'), JSON.stringify(meta, null, 1));
  stepTimes[stepIdx] = Date.now() - stepStart;
  say(`Stored scenario ${id}`);
  report({ step: STEPS.length, stepName: 'Simulation complete', progress: 1, message: 'Simulation complete', log: log.slice(-30), stepTimes, done: true, scenarioId: id });
  return meta;
}

module.exports = { runPipeline, STEPS, RESULTS, UPLOADS, CACHE };
