/* FloodSim HADR — scenario-generic impact analysis (isomorphic: browser + Node server).
 *
 * Works on a "Scenario" object:
 *   grid     { rows, cols, north, west, dLat, dLng, n, dx, dy (m), cellArea (km²) }   row 0 = north
 *   models   { sph: M, delft3d: M }  M = { key, name, short, engine, dmax, vmax, arr, tblk, dur, hz, frames:{times,h}, stats, Qp }
 *            arr / tblk in minutes (Infinity = never), dur in minutes, frames.times in minutes
 *   features { villages, groups, infra, roads:{nodes,edges}, bridges, safeZones }
 *   channel  Uint8Array (permanent water cells, excluded from flooded-area statistics)
 * All derived priorities / risks / routes are rule-based decision-support outputs, not predictions.
 */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.FS = root.FS || {}; root.FS.analysis = m; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- encoding helpers (JSON transport of typed arrays) ----------
  const hasBuffer = typeof Buffer !== 'undefined';
  function bytesToB64(u8) {
    if (hasBuffer) return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    if (hasBuffer) { const b = Buffer.from(b64, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    const s = atob(b64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  // kinds: f32 raw; tmin = minutes with Infinity→-1 (f32); cm = depth quantised to Uint16 centimetres; u8 = bytes
  function pack(arr, kind) {
    if (!arr) return null;
    if (kind === 'cm') { const u = new Uint16Array(arr.length); for (let i = 0; i < arr.length; i++) u[i] = Math.min(65535, Math.round(Math.max(0, arr[i]) * 100)); return { enc: 'cm', b64: bytesToB64(new Uint8Array(u.buffer)) }; }
    if (kind === 'u8') return { enc: 'u8', b64: bytesToB64(arr) };
    const f = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) f[i] = kind === 'tmin' && !isFinite(arr[i]) ? -1 : arr[i];
    return { enc: kind === 'tmin' ? 'tmin' : 'f32', b64: bytesToB64(new Uint8Array(f.buffer)) };
  }
  function unpack(p) {
    if (!p) return null;
    const bytes = b64ToBytes(p.b64);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (p.enc === 'u8') return new Uint8Array(buf);
    if (p.enc === 'cm') { const u = new Uint16Array(buf), f = new Float32Array(u.length); for (let i = 0; i < u.length; i++) f[i] = u[i] / 100; return f; }
    const f = new Float32Array(buf);
    if (p.enc === 'tmin') for (let i = 0; i < f.length; i++) if (f[i] < 0) f[i] = Infinity;
    return f;
  }
  const MODEL_FIELDS = { dmax: 'f32', vmax: 'f32', arr: 'tmin', tblk: 'tmin', dur: 'f32', hz: 'f32' };
  function packScenario(scn) {
    const out = Object.assign({}, scn, { dem: pack(scn.dem, 'f32'), channel: pack(scn.channel, 'u8'), models: {} });
    Object.entries(scn.models).forEach(([k, M]) => {
      const pm = Object.assign({}, M, { frames: { times: M.frames.times, h: M.frames.h.map((h) => pack(h, 'cm')) } });
      Object.keys(MODEL_FIELDS).forEach((f) => (pm[f] = pack(M[f], MODEL_FIELDS[f])));
      out.models[k] = pm;
    });
    return out;
  }
  function unpackScenario(j) {
    const scn = Object.assign({}, j, { dem: unpack(j.dem), channel: unpack(j.channel), models: {} });
    Object.entries(j.models).forEach(([k, pm]) => {
      const M = Object.assign({}, pm, { frames: { times: pm.frames.times, h: pm.frames.h.map(unpack) } });
      Object.keys(MODEL_FIELDS).forEach((f) => (M[f] = unpack(pm[f])));
      scn.models[k] = M;
    });
    return scn;
  }

  // ---------- geometry ----------
  const R_EARTH = 6371.0088;
  function distKm(a, b) {
    const toR = Math.PI / 180, dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(s));
  }
  function lineKm(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += distKm(pts[i - 1], pts[i]); return d; }
  function cellIndex(g, lat, lng) {
    const r = Math.floor((g.north - lat) / g.dLat), c = Math.floor((lng - g.west) / g.dLng);
    return r < 0 || c < 0 || r >= g.rows || c >= g.cols ? -1 : r * g.cols + c;
  }
  const cellCenter = (g, i) => [g.north - (Math.floor(i / g.cols) + 0.5) * g.dLat, g.west + ((i % g.cols) + 0.5) * g.dLng];
  // densify a polyline so samples are ≤ stepKm apart
  function densify(pts, stepKm) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const d = distKm(pts[i - 1], pts[i]), n = Math.max(1, Math.ceil(d / stepKm));
      for (let k = 1; k <= n; k++) out.push([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / n, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / n]);
    }
    return out;
  }
  // distance from point to polyline (km, approx) + chainage along it
  function nearestOnLine(pts, p) {
    let best = Infinity, ch = 0, acc = 0, bestCh = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) acc += distKm(pts[i - 1], pts[i]);
      const d = distKm(pts[i], p);
      if (d < best) { best = d; bestCh = acc; }
    }
    ch = bestCh;
    return { dist: best, chainage: ch };
  }

  // ---------- raster access ----------
  // depth (m) at cell i and time t (min), linearly interpolated between stored frames
  function depthAt(M, i, t) {
    if (!(M.arr[i] <= t)) return 0;
    const T = M.frames.times, H = M.frames.h;
    if (!T.length) return M.dmax[i];
    if (t >= T[T.length - 1]) return H[H.length - 1][i];
    let k = 0; while (k < T.length - 1 && T[k + 1] <= t) k++;
    const f = (t - T[k]) / (T[k + 1] - T[k]);
    const d = H[k][i] + (H[k + 1][i] - H[k][i]) * f;
    return d > 0.02 ? d : M.arr[i] <= t && M.dur[i] > 0 && t - M.arr[i] < M.dur[i] ? Math.min(M.dmax[i], 0.05) : 0;
  }
  function sampleCell(M, i) {
    if (i < 0) return { depth: 0, arrival: Infinity, duration: 0, velocity: 0, hazard: 0, tblk: Infinity };
    return { depth: M.dmax[i], arrival: M.arr[i], duration: M.dur[i], velocity: M.vmax[i], hazard: M.hz[i], tblk: M.tblk[i] };
  }
  // footprint sample: max depth / earliest arrival within ±rad cells
  function sampleArea(scn, M, lat, lng, rad) {
    const g = scn.grid, c = cellIndex(g, lat, lng);
    if (c < 0) return sampleCell(M, -1);
    rad = rad == null ? 1 : rad;
    const r0 = Math.floor(c / g.cols), c0 = c % g.cols;
    let best = sampleCell(M, c);
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const r = r0 + dr, cc = c0 + dc;
      if (r < 0 || cc < 0 || r >= g.rows || cc >= g.cols || (!dr && !dc)) continue;
      const j = r * g.cols + cc;
      if (scn.channel && scn.channel[j]) continue;
      const q = sampleCell(M, j);
      if (q.depth > best.depth) best = Object.assign({}, q, { arrival: Math.min(q.arrival, best.arrival), tblk: Math.min(q.tblk, best.tblk) });
      else if (q.depth > 0.05) { best.arrival = Math.min(best.arrival, q.arrival); best.tblk = Math.min(best.tblk, q.tblk); }
    }
    return best;
  }

  // ---------- classification ----------
  const depthClass = (d) => (d <= 0.05 ? -1 : d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : d < 5 ? 3 : 4);
  const arrClass = (a) => (!isFinite(a) ? -1 : a < 15 ? 0 : a < 30 ? 1 : a < 60 ? 2 : a < 120 ? 3 : 4);
  const durClass = (m) => (m <= 0 ? -1 : m < 60 ? 0 : m < 180 ? 1 : m < 360 ? 2 : m < 720 ? 3 : 4);
  const hazClass = (h) => (h <= 0 ? -1 : h < 0.75 ? 0 : h < 1.25 ? 1 : h < 2 ? 2 : 3); // HR = d(v+0.5), after DEFRA/EA FD2320
  function riskLevel(depth, arrival, hazard) {
    if (!(depth > 0.05)) return 'NONE';
    if (hazard >= 2 || (depth >= 2 && arrival < 45)) return 'CRITICAL';
    if (depth >= 1 || hazard >= 1.25) return 'HIGH';
    if (depth >= 0.3) return 'MEDIUM';
    return 'LOW';
  }
  const RISK_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  // ---------- roads ----------
  const SPEED = { motorway: 50, trunk: 45, primary: 40, state: 35, secondary: 32, district: 28, tertiary: 25, link: 22, unclassified: 18, village: 15, bridge: 28 }; // km/h, emergency conditions (assumed)
  const BRIDGE_CLEARANCE = 6; // m above normal water level (assumption; replace with bridge inventory)
  const ROUTE_MARGIN = 10;    // min — safety margin before a segment becomes impassable

  function firstExceed(M, i, thr) {
    // first time depth ≥ thr at cell i from frames (min); Infinity if never
    const T = M.frames.times, H = M.frames.h;
    for (let k = 0; k < T.length; k++) if (H[k][i] >= thr) {
      if (k === 0) return T[0];
      const a = H[k - 1][i], b = H[k][i];
      return T[k - 1] + ((thr - a) / (b - a || 1)) * (T[k] - T[k - 1]);
    }
    return M.dmax[i] >= thr ? M.arr[i] : Infinity;
  }

  function evaluateRoads(scn, M, opts) {
    opts = opts || {};
    const thr = opts.roadThreshold || 0.3, g = scn.grid;
    const out = {};
    scn.features.roads.edges.forEach((e) => {
      if (!e._samples) e._samples = densify(e.geom, Math.max(0.1, Math.min(g.dx, g.dy) / 1000 / 2)).map((p) => cellIndex(g, p[0], p[1]));
      if (e.crossing) {
        // river crossing: overtopping when water rise at the crossing exceeds assumed deck clearance
        let rise = 0, bt = Infinity, cell = -1;
        e._samples.forEach((i) => { if (i >= 0 && M.dmax[i] > rise) { rise = M.dmax[i]; cell = i; } });
        const over = Math.max(0, rise - BRIDGE_CLEARANCE);
        if (over > 0) bt = firstExceed(M, cell, BRIDGE_CLEARANCE);
        const status = over > 0 ? 'OVERTOPPED' : rise > BRIDGE_CLEARANCE * 0.75 ? 'AT RISK' : 'CLEAR';
        out[e.id] = { maxDepth: over, arrival: bt, blockTime: bt, blocked: over > 0, risky: status === 'AT RISK', status, stage: rise };
        return;
      }
      let dm = 0, am = Infinity, bt = Infinity;
      e._samples.forEach((i) => {
        if (i < 0 || (scn.channel && scn.channel[i]) || !(M.dmax[i] > 0.05)) return;
        if (M.dmax[i] > dm) dm = M.dmax[i];
        if (M.arr[i] < am) am = M.arr[i];
        if (M.dmax[i] > thr) { const tb = thr <= 0.3 && isFinite(M.tblk[i]) && thr === 0.3 ? M.tblk[i] : firstExceed(M, i, thr); if (tb < bt) bt = tb; }
      });
      const blocked = dm > thr, risky = !blocked && dm > 0.1;
      out[e.id] = { maxDepth: dm, arrival: am, blockTime: bt, blocked, risky, status: blocked ? 'FLOODED' : risky ? 'CAUTION' : 'CLEAR' };
    });
    return out;
  }

  // binary heap for Dijkstra
  function Heap() { this.a = []; }
  Heap.prototype.push = function (p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } };
  Heap.prototype.pop = function () { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; };

  function adjacency(scn) {
    if (scn._adj) return scn._adj;
    const adj = {};
    scn.features.roads.edges.forEach((e) => { (adj[e.a] = adj[e.a] || []).push({ to: e.b, e }); (adj[e.b] = adj[e.b] || []).push({ to: e.a, e }); });
    Object.defineProperty(scn, '_adj', { value: adj, enumerable: false, writable: true });
    return adj;
  }
  const edgeTime = (e, mode) => (e.len / (mode === 'foot' ? 4.5 : SPEED[e.cls] || 20)) * 60;

  // time-dependent Dijkstra: an edge is usable only if cleared ROUTE_MARGIN min before it becomes impassable
  function shortestPaths(scn, src, roadEval, opts) {
    opts = opts || {};
    const t0 = opts.t0 || 0, adj = adjacency(scn);
    const dist = { [src]: 0 }, prev = {}, done = new Set(), pq = new Heap();
    pq.push(0, src);
    while (pq.a.length) {
      const [du, u] = pq.pop();
      if (done.has(u)) continue;
      done.add(u);
      if (opts.maxMin && du > opts.maxMin) break;
      (adj[u] || []).forEach(({ to, e }) => {
        const ev = roadEval[e.id], w0 = edgeTime(e, opts.mode);
        if (opts.avoidFlood && t0 + du + w0 + ROUTE_MARGIN > ev.blockTime) return;
        let w = w0;
        if (opts.avoidFlood && (ev.risky || ev.blocked)) w *= 1.8;
        if (opts.penalty && opts.penalty[e.id]) w *= opts.penalty[e.id];
        const nd = du + w;
        if (nd < (dist[to] ?? Infinity)) { dist[to] = nd; prev[to] = { from: u, e }; pq.push(nd, to); }
      });
    }
    return { dist, prev };
  }
  function tracePath(sp, dst) {
    if (!(dst in sp.dist)) return null;
    const edges = []; let cur = dst;
    while (sp.prev[cur]) { edges.unshift(sp.prev[cur].e); cur = sp.prev[cur].from; }
    return edges;
  }
  function describeRoute(edges, roadEval, mode, t0) {
    if (!edges) return null;
    let len = 0, time = 0, worst = 0, earliest = Infinity, minMargin = Infinity;
    const blocked = [], risky = [], coords = [];
    edges.forEach((e) => {
      const ev = roadEval[e.id];
      len += e.len; time += edgeTime(e, mode);
      worst = Math.max(worst, ev.maxDepth);
      const margin = ev.blockTime - ((t0 || 0) + time);
      if (margin < 0) blocked.push(e); else if (ev.risky || ev.blocked) risky.push(e);
      if (isFinite(ev.blockTime)) minMargin = Math.min(minMargin, margin);
      if (ev.maxDepth > 0.05) earliest = Math.min(earliest, ev.arrival);
      let g = e.geom;
      const pe = coords[coords.length - 1];
      if (pe && Math.abs(g[0][0] - pe[0]) + Math.abs(g[0][1] - pe[1]) > Math.abs(g[g.length - 1][0] - pe[0]) + Math.abs(g[g.length - 1][1] - pe[1])) g = g.slice().reverse();
      coords.push(...g);
    });
    return { edges, len, time, worst, earliest, minMargin, blocked, risky, risk: blocked.length ? 'UNSAFE' : risky.length || minMargin < 30 ? 'CAUTION' : 'LOW', coords };
  }
  function planEvacuation(scn, roadEval, villageId, destId, opts) {
    opts = opts || {};
    const mode = opts.mode || 'vehicle', t0 = opts.t0 ?? 15, zones = scn.features.safeZones;
    const sp = shortestPaths(scn, villageId, roadEval, { avoidFlood: true, mode, t0 });
    let dst = destId && destId !== 'auto' ? destId : null;
    if (!dst) { let b = Infinity; zones.forEach((z) => { if ((sp.dist[z.id] ?? Infinity) < b) { b = sp.dist[z.id]; dst = z.id; } }); }
    const recommended = dst && dst in sp.dist ? describeRoute(tracePath(sp, dst), roadEval, mode, t0) : null;
    let alternative = null;
    if (recommended) {
      const pen = {}; recommended.edges.forEach((e) => (pen[e.id] = e.cls === 'village' ? 1.5 : 6));
      const alt = describeRoute(tracePath(shortestPaths(scn, villageId, roadEval, { avoidFlood: true, mode, t0, penalty: pen }), dst), roadEval, mode, t0);
      if (alt && alt.edges.map((e) => e.id).join() !== recommended.edges.map((e) => e.id).join()) alternative = alt;
    }
    const sp0 = shortestPaths(scn, villageId, roadEval, { mode });
    let nd = destId && destId !== 'auto' ? destId : null;
    if (!nd) { let b = Infinity; zones.forEach((z) => { if ((sp0.dist[z.id] ?? Infinity) < b) { b = sp0.dist[z.id]; nd = z.id; } }); }
    const naive = nd ? describeRoute(tracePath(sp0, nd), roadEval, mode, t0) : null;
    return { villageId, dest: recommended ? dst : null, requestedDest: destId, t0, mode, recommended, alternative, naive: naive && naive.blocked.length ? naive : null, avoidIds: naive ? naive.blocked.map((e) => e.id) : [] };
  }

  // ---------- impact analysis ----------
  const DEFAULT_WEIGHTS = { population: 25, depth: 20, arrival: 25, infrastructure: 10, accessibility: 10, roads: 10 };

  function analyse(scn, key, opts) {
    opts = opts || {};
    const M = scn.models[key], g = scn.grid, F = scn.features;
    const weights = opts.weights || DEFAULT_WEIGHTS, t0 = opts.t0 ?? 15;
    const roadEval = evaluateRoads(scn, M, opts);
    // flooded area (excluding permanent water), per-group area by nearest village
    const vxy = F.villages.map((v) => [v.lat, v.lng]);
    const cosLat = Math.cos(((g.north - (g.rows * g.dLat) / 2) * Math.PI) / 180);
    let cells = 0, maxDepth = 0, maxVel = 0;
    const gpArea = {};
    for (let i = 0; i < g.n; i++) {
      if (!(M.dmax[i] > 0.05) || (scn.channel && scn.channel[i])) continue;
      cells++;
      if (M.dmax[i] > maxDepth) maxDepth = M.dmax[i];
      if (M.vmax[i] > maxVel) maxVel = M.vmax[i];
      if (vxy.length) {
        const [la, ln] = cellCenter(g, i);
        let b = 1e18, bi = 0;
        for (let k = 0; k < vxy.length; k++) { const q = (la - vxy[k][0]) ** 2 + ((ln - vxy[k][1]) * cosLat) ** 2; if (q < b) { b = q; bi = k; } }
        const gp = F.villages[bi].group;
        gpArea[gp] = (gpArea[gp] || 0) + g.cellArea;
      }
    }
    const area = cells * g.cellArea;
    const river = scn.river || [];
    const infra = F.infra.map((f) => {
      const q = sampleArea(scn, M, f.lat, f.lng, 0);
      return Object.assign({}, f, q, { distRiver: river.length ? nearestOnLine(river, [f.lat, f.lng]).dist : null, risk: riskLevel(q.depth, q.arrival, q.hazard) });
    });
    const bridges = F.bridges.map((b) => {
      const ev = roadEval[b.edge] || { maxDepth: 0, arrival: Infinity, status: 'CLEAR', blockTime: Infinity };
      const risk = ev.status === 'OVERTOPPED' || ev.status === 'FLOODED' ? 'CRITICAL' : ev.status === 'AT RISK' || ev.status === 'CAUTION' ? 'HIGH' : 'LOW';
      return Object.assign({}, b, { depth: ev.maxDepth, arrival: ev.arrival, status: ev.status, risk, distRiver: river.length ? nearestOnLine(river, [b.lat, b.lng]).dist : null });
    });
    const dam = scn.dam ? [scn.dam.lat, scn.dam.lng] : null;
    const affectedIds = new Set();
    const villages = F.villages.map((v) => {
      const q = sampleArea(scn, M, v.lat, v.lng, v.footprint ?? 1);
      if (q.depth > 0.05) affectedIds.add(v.id);
      const nr = river.length ? nearestOnLine(river, [v.lat, v.lng]) : { dist: null, chainage: null };
      return Object.assign({}, v, q, { risk: riskLevel(q.depth, q.arrival, q.hazard), distRiver: nr.dist, distDam: nr.chainage ?? (dam ? distKm(dam, [v.lat, v.lng]) : null), affected: q.depth > 0.05 });
    });
    const maxPop = Math.max(1, ...F.villages.map((v) => v.pop || 0));
    const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    villages.forEach((v) => {
      v.infra = infra.filter((f) => f.village === v.id);
      const conn = F.roads.edges.filter((e) => e.a === v.id || e.b === v.id);
      v.roadsBlockedFrac = conn.length ? conn.filter((e) => roadEval[e.id].blocked).length / conn.length : 1;
      v.evac = v.affected || opts.allRoutes ? planEvacuation(scn, roadEval, v.id, 'auto', { mode: 'vehicle', t0 }) : { villageId: v.id, dest: null, recommended: null, alternative: null, naive: null, avoidIds: [] };
      v.safeZone = v.evac.dest;
      const rt = v.evac.recommended;
      const crit = v.infra.filter((f) => f.type === 'school' || f.type === 'health').length;
      const f = {
        population: (v.pop || 0) / maxPop,
        depth: Math.min(1, v.depth / 4),
        arrival: v.affected ? Math.max(0, 1 - v.arrival / 240) : 0,
        infrastructure: Math.min(1, crit / 3),
        accessibility: !rt ? 1 : Math.min(1, (rt.time / 60) * (rt.risk === 'CAUTION' ? 1.3 : 1)),
        roads: v.roadsBlockedFrac
      };
      const contrib = {}; let score = 0;
      Object.keys(weights).forEach((k) => { contrib[k] = (weights[k] * f[k]) / wsum * 100; score += contrib[k]; });
      if (!v.affected) score = 0;
      Object.assign(v, { factors: f, contrib, score, priority: !v.affected ? 'NONE' : score >= 55 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW', accessLabel: !rt ? 'NONE' : rt.risk === 'CAUTION' || rt.time > 45 ? 'LOW' : rt.time > 25 ? 'MODERATE' : 'GOOD' });
    });
    const groups = F.groups.map((p) => {
      const vs = villages.filter((v) => v.group === p.id), aff = vs.filter((v) => v.affected);
      const ids = new Set(vs.map((v) => v.id));
      const inf = infra.filter((f) => f.village && ids.has(f.village) && f.depth > 0.05);
      const worst = aff.reduce((a, v) => (RISK_ORDER[v.risk] > RISK_ORDER[a] ? v.risk : a), 'NONE');
      const top = aff.reduce((a, v) => Math.max(a, v.score), 0);
      const roadsAff = F.roads.edges.filter((e) => (ids.has(e.a) || ids.has(e.b)) && roadEval[e.id].blocked).length;
      const brAff = bridges.filter((b) => b.group === p.id && b.risk !== 'LOW').length;
      return Object.assign({}, p, { villages: vs, affectedVillages: aff.length, population: aff.reduce((a, v) => a + (v.pop || 0), 0), area: gpArea[p.id] || 0, schools: inf.filter((f) => f.type === 'school').length, health: inf.filter((f) => f.type === 'health').length, infraCount: inf.length, roads: roadsAff, bridges: brAff, risk: worst, priorityScore: top, priority: top >= 55 ? 'HIGH' : top >= 35 ? 'MEDIUM' : top > 0 ? 'LOW' : 'NONE' });
    });
    const affV = villages.filter((v) => v.affected);
    const flooded = F.roads.edges.filter((e) => !e.crossing && e.cls !== 'village' && roadEval[e.id].blocked);
    return {
      roadEval, villages, infra, bridges, panchayats: groups,
      kpi: {
        maxDepth, maxVel, area, agriArea: area * (scn.assumptions?.cropFraction ?? 0.72),
        firstArrival: affV.reduce((a, v) => Math.min(a, v.arrival), Infinity),
        villages: affV.length, panchayats: groups.filter((x) => x.affectedVillages).length,
        population: affV.reduce((a, v) => a + (v.pop || 0), 0),
        roads: flooded.length, roadKm: flooded.reduce((a, e) => a + e.len, 0),
        bridges: bridges.filter((b) => b.risk !== 'LOW').length,
        infra: infra.filter((f) => f.depth > 0.05).length,
        highPriority: villages.filter((v) => v.priority === 'HIGH').length,
        peakQ: M.Qp,
        severity: affV.some((v) => v.risk === 'CRITICAL') ? 'SEVERE' : affV.some((v) => v.risk === 'HIGH') ? 'HIGH' : affV.length ? 'MODERATE' : 'LOW',
        damage: lossEstimate(scn, M, villages)
      }
    };
  }

  // Loss & damage (indicative): depth-damage curve for residential buildings, Asia
  // (JRC Global flood depth-damage functions, Huizinga et al. 2017 — values interpolated),
  // exposure from assumed households per settlement × assumed structure value. All assumptions exposed.
  const DDF = [[0, 0], [0.5, 0.33], [1, 0.49], [1.5, 0.62], [2, 0.72], [3, 0.87], [4, 0.93], [5, 0.98], [6, 1]];
  function damageFraction(d) {
    if (d <= 0) return 0;
    for (let i = 1; i < DDF.length; i++) if (d <= DDF[i][0]) return DDF[i - 1][1] + ((d - DDF[i - 1][0]) / (DDF[i][0] - DDF[i - 1][0])) * (DDF[i][1] - DDF[i - 1][1]);
    return 1;
  }
  function lossEstimate(scn, M, villages) {
    const a = Object.assign({ personsPerHousehold: 4.8, valuePerHouseINR: 450000, cropValuePerHaINR: 60000, cropFraction: 0.72 }, scn.assumptions || {});
    let houses = 0, housesDamaged = 0, bldgLoss = 0;
    villages.forEach((v) => {
      if (!v.affected) return;
      const h = (v.pop || 0) / a.personsPerHousehold, f = damageFraction(v.depth);
      houses += h; housesDamaged += h * (f > 0.3 ? 1 : f / 0.3); bldgLoss += h * f * a.valuePerHouseINR;
    });
    let cropHa = 0; const g = scn.grid;
    for (let i = 0; i < g.n; i++) if (M.dmax[i] > 0.05 && !(scn.channel && scn.channel[i])) cropHa += g.cellArea * 100 * a.cropFraction * (M.dur[i] > 1440 ? 1 : 0.6);
    return { houses: Math.round(houses), housesDamaged: Math.round(housesDamaged), buildingLossINR: bldgLoss, cropLossINR: cropHa * a.cropValuePerHaINR, cropHa, assumptions: a, method: 'JRC depth-damage (residential, Asia) × assumed exposure — indicative only' };
  }

  // ---------- polygons for export: merge flooded cells into rectangles (exact raster footprint) ----------
  function maskRects(g, test) {
    const rects = [], open = new Map(); // key "c0,c1" → rect
    for (let r = 0; r <= g.rows; r++) {
      const runs = [];
      if (r < g.rows) { let c = 0; while (c < g.cols) { if (test(r * g.cols + c)) { const s = c; while (c < g.cols && test(r * g.cols + c)) c++; runs.push([s, c]); } else c++; } }
      const next = new Map();
      runs.forEach(([a, b]) => { const k = a + ',' + b, o = open.get(k); if (o) { o.r1 = r + 1; next.set(k, o); open.delete(k); } else next.set(k, { c0: a, c1: b, r0: r, r1: r + 1 }); });
      open.forEach((o) => rects.push(o));
      open.clear(); next.forEach((v, k) => open.set(k, v));
    }
    return rects.map((o) => {
      const n = g.north - o.r0 * g.dLat, s = g.north - o.r1 * g.dLat, w = g.west + o.c0 * g.dLng, e = g.west + o.c1 * g.dLng;
      return [[w, n], [e, n], [e, s], [w, s], [w, n]]; // [lng,lat], clockwise
    });
  }
  // along-river profile of peak depth and arrival
  function riverProfile(scn, M, stepKm) {
    const pts = densify(scn.river, stepKm || 1), out = [];
    let km = 0;
    pts.forEach((p, i) => {
      if (i) km += distKm(pts[i - 1], p);
      if (i % 1) return;
      const q = sampleArea(scn, M, p[0], p[1], 2);
      out.push({ km, depth: q.depth, arrival: q.arrival });
    });
    const res = []; let next = 0;
    out.forEach((o) => { if (o.km >= next) { res.push(o); next += stepKm || 1; } });
    return res;
  }
  function compareMasks(scn, M, obs) {
    let inter = 0, sim = 0, ob = 0;
    for (let i = 0; i < scn.grid.n; i++) {
      if (scn.channel && scn.channel[i]) continue;
      const a = M.dmax[i] > 0.05, b = obs[i] === 1;
      if (a) sim++; if (b) ob++; if (a && b) inter++;
    }
    const u = sim + ob - inter, ca = scn.grid.cellArea;
    return { iou: u ? inter / u : 0, simArea: sim * ca, obsArea: ob * ca, overlap: ob ? inter / ob : 0, diff: (sim - ob) * ca };
  }

  return {
    pack, unpack, packScenario, unpackScenario, distKm, lineKm, densify, nearestOnLine, cellIndex, cellCenter,
    depthAt, sampleCell, sampleArea, firstExceed, depthClass, arrClass, durClass, hazClass, riskLevel, RISK_ORDER, HAZ_LABELS: ['LOW', 'MODERATE', 'SIGNIFICANT', 'EXTREME'],
    evaluateRoads, planEvacuation, analyse, maskRects, riverProfile, compareMasks, damageFraction,
    DEFAULT_WEIGHTS, SPEED, BRIDGE_CLEARANCE, ROUTE_MARGIN
  };
});
