/* FloodSim HADR — browser-side PARAMETRIC SURROGATE engine (demo).
 *
 * IMPORTANT (scientific honesty): this file does NOT implement Smooth Particle Hydrodynamics
 * or Delft3D. It is a lightweight closed-form surrogate used to generate plausible-looking
 * SIMULATED DEMO RESULTS so that the decision-support workflow can be demonstrated.
 * "SPH" and "Delft3D" outputs here are the same surrogate with different calibration offsets.
 * Real model runs are expected to come from a backend (see FS.backend in app.js).
 *
 * Components:
 *  - river-coordinate system (chainage s, lateral offset d) on a local km projection
 *  - procedurally generated demo DEM (synthetic, NOT SRTM/ASTER)
 *  - peak discharge: broad-crested weir estimate Q = 1.7·B·H^1.5 (SI), reduced for slow breach
 *  - stage from wide-channel Manning relation, downstream attenuation, decaying front celerity
 *  - hazard rating HR = d·(v+0.5) (after DEFRA/EA FD2320, debris factor omitted)
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FS = (root.FS = root.FS || {});
  const D = FS.data;

  // ---------- projection (local equirectangular, km) ----------
  const LAT0 = 26.2, LON0 = 86.75;
  const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180), KY = 110.57;
  const toXY = (lat, lng) => [(lng - LON0) * KX, (lat - LAT0) * KY];
  const toLL = (x, y) => [LAT0 + y / KY, LON0 + x / KX];

  // ---------- river stations ----------
  const STEP = 0.5;
  function buildRiver() {
    const pts = D.river.map((p) => toXY(p[0], p[1]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const st = [];
    let seg = 0;
    for (let s = 0; s <= L + 1e-6; s += STEP) {
      while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
      const f = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
      st.push({ s, x: pts[seg][0] + f * (pts[seg + 1][0] - pts[seg][0]), y: pts[seg][1] + f * (pts[seg + 1][1] - pts[seg][1]) });
    }
    // smoothed tangents (±2 km) to keep large lateral offsets well-behaved
    const W = 4;
    st.forEach((p, i) => {
      const a = st[Math.max(0, i - W)], b = st[Math.min(st.length - 1, i + W)];
      const tx = b.x - a.x, ty = b.y - a.y, n = Math.hypot(tx, ty) || 1;
      p.tx = tx / n; p.ty = ty / n;
      p.nx = -p.ty; p.ny = p.tx; // left of flow (flow ≈ south) → east bank positive
    });
    return { stations: st, length: L };
  }

  const R = buildRiver();

  function stationAt(s) {
    const i = Math.max(0, Math.min(R.stations.length - 2, Math.floor(s / STEP)));
    const a = R.stations[i], b = R.stations[i + 1];
    const f = Math.max(0, Math.min(1, (s - a.s) / STEP));
    return { x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y), nx: a.nx + f * (b.nx - a.nx), ny: a.ny + f * (b.ny - a.ny) };
  }
  function sdToXY(s, d) { const p = stationAt(s); return [p.x + d * p.nx, p.y + d * p.ny]; }
  function sdToLL(s, d) { const [x, y] = sdToXY(s, d); return toLL(x, y); }

  // ---------- synthetic terrain (DEMO DEM) ----------
  function hash(ix, iy) {
    let h = (ix * 374761393 + iy * 668265263) ^ 0x5bd1e995;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
  }
  const noise = (x, y) => 0.9 * vnoise(x / 6, y / 6) + 0.45 * vnoise(x / 2.2 + 17, y / 2.2 - 9);
  const bedLevel = (s) => 74 - 0.25 * s; // m, illustrative
  function lateralRise(d) {
    const a = Math.abs(d);
    const k = d > 0 ? 0.92 : 1.06; // east bank slightly lower (demo asymmetry)
    return k * (2.0 * (1 - Math.exp(-a / 1.0)) + 0.38 * a + 0.07 * Math.max(0, a - 8) ** 2);
  }
  const terrainAt = (s, d, x, y) => bedLevel(s) + lateralRise(d) + (Math.abs(d) < 0.35 ? -1.5 : noise(x, y));

  // ---------- computational grid ----------
  const CELL = 0.4; // km
  const BUF = 18.5;
  function buildGrid() {
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    R.stations.forEach((p) => { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    minx -= BUF; maxx += BUF; miny -= BUF; maxy += 8;
    const [south, west] = toLL(minx, miny), [north, east] = toLL(maxx, maxy);
    const dLat = CELL / KY, dLng = CELL / KX;
    const cols = Math.ceil((east - west) / dLng), rows = Math.ceil((north - south) / dLat);
    const n = rows * cols;
    const S = new Float32Array(n), Dd = new Float32Array(n), Z = new Float32Array(n), valid = new Uint8Array(n), channel = new Uint8Array(n);
    const X = new Float32Array(n), Y = new Float32Array(n);
    const st = R.stations;
    for (let r = 0; r < rows; r++) {
      const lat = north - (r + 0.5) * dLat; // row 0 = north
      for (let c = 0; c < cols; c++) {
        const lng = west + (c + 0.5) * dLng;
        const [x, y] = toXY(lat, lng);
        const i = r * cols + c;
        X[i] = x; Y[i] = y;
        let best = 1e18, bi = 0;
        for (let k = 0; k < st.length; k += 2) { const dx = x - st[k].x, dy = y - st[k].y, q = dx * dx + dy * dy; if (q < best) { best = q; bi = k; } }
        for (let k = Math.max(0, bi - 2); k <= Math.min(st.length - 1, bi + 2); k++) { const dx = x - st[k].x, dy = y - st[k].y, q = dx * dx + dy * dy; if (q < best) { best = q; bi = k; } }
        const p = st[bi], dx = x - p.x, dy = y - p.y;
        const s = p.s + dx * p.tx + dy * p.ty, d = dx * p.nx + dy * p.ny;
        S[i] = s; Dd[i] = d;
        valid[i] = s > 0.2 && s < R.length + 0.3 && Math.abs(d) < BUF ? 1 : 0;
        channel[i] = Math.abs(d) < 0.35 && valid[i] ? 1 : 0;
        Z[i] = terrainAt(Math.max(0, s), d, x, y);
      }
    }
    return { rows, cols, n, north, south, east, west, dLat, dLng, S, D: Dd, Z, X, Y, valid, channel, cellArea: CELL * CELL };
  }
  const G = buildGrid();

  function cellIndexLL(lat, lng) {
    const r = Math.floor((G.north - lat) / G.dLat), c = Math.floor((lng - G.west) / G.dLng);
    if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) return -1;
    return r * G.cols + c;
  }
  const cellIndexSD = (s, d) => { const [la, ln] = sdToLL(s, d); return cellIndexLL(la, ln); };

  // ---------- model calibrations (demo offsets, NOT real model physics) ----------
  const MODELS = {
    sph: { key: 'sph', name: 'Smooth Particle Hydrodynamics', short: 'SPH', atten: 70, speed: 1.07, width: 5600, scatter: 0.35 },
    delft3d: { key: 'delft3d', name: 'Delft3D', short: 'Delft3D', atten: 58, speed: 0.96, width: 6200, scatter: 0 }
  };

  function peakDischarge(cfg) {
    const weir = 1.7 * cfg.breachWidth * Math.pow(cfg.waterLevel, 1.5);
    return weir / (1 + 0.004 * cfg.breachTime);
  }

  function runModel(cfg, modelKey) {
    const M = MODELS[modelKey];
    const H0 = cfg.waterLevel, tf = cfg.breachTime, V = cfg.storage * 1e6, T = cfg.duration;
    const Qp = cfg.peakDischarge > 0 ? cfg.peakDischarge : peakDischarge(cfg);
    const n = 0.04, Sl = 0.00025;
    const ns = R.stations.length;
    const ta = new Float32Array(ns), Hs = new Float32Array(ns), tr = new Float32Array(ns), trec = new Float32Array(ns), vf = new Float32Array(ns);
    const v0 = 0.5 * Math.sqrt(9.81 * H0), vmin = 2.4 * Math.pow(Qp / 40000, 0.25);
    let t = 0;
    for (let k = 0; k < ns; k++) {
      const s = R.stations[k].s;
      const Q = Qp / (1 + s / M.atten);
      Hs[k] = Math.pow((Q * n) / (M.width * Math.sqrt(Sl)), 0.6);
      vf[k] = (vmin + (v0 - vmin) * Math.exp(-s / 12)) * M.speed;
      if (k > 0) t += (STEP * 1000) / ((vf[k] + vf[k - 1]) / 2) / 60;
      ta[k] = t;
      tr[k] = tf * 0.9 + 1.2 * s;
      trec[k] = (V / Qp / 60) * (1 + s / 50);
    }
    const arr = new Float32Array(G.n).fill(Infinity), dmax = new Float32Array(G.n), dur = new Float32Array(G.n), vmax = new Float32Array(G.n), hz = new Float32Array(G.n);
    const E = new Float32Array(G.n); // elevation above normal water level (with model scatter)
    for (let i = 0; i < G.n; i++) {
      if (!G.valid[i] || G.channel[i]) continue;
      const k = Math.min(ns - 1, Math.max(0, Math.round(G.S[i] / STEP)));
      let e = G.Z[i] - bedLevel(G.S[i]);
      if (M.scatter) e += M.scatter * vnoise(G.X[i] / 0.9 + 40, G.Y[i] / 0.9 + 40);
      e = Math.max(0.05, e);
      E[i] = e;
      const H = Hs[k];
      if (e >= H) continue;
      const tA = ta[k] + (tr[k] * e) / H;
      if (tA > T) continue;
      const tPk = ta[k] + tr[k];
      const d = tPk <= T ? H - e : (H * (T - ta[k])) / tr[k] - e;
      if (d <= 0.02) continue;
      arr[i] = tA;
      dmax[i] = d;
      const tOut = ta[k] + tr[k] + trec[k] * Math.log(H / e);
      dur[i] = tOut - tA;
      vmax[i] = Math.min(7.5, 0.85 * vf[k] * Math.pow(d / H, 0.67));
      hz[i] = d * (vmax[i] + 0.5);
    }
    return { model: M, cfg: Object.assign({}, cfg), Qp, st: { ta, Hs, tr, trec, vf }, arr, dmax, dur, vmax, hz, E };
  }

  // depth at time t (min) for cell i
  function depthAt(res, i, t) {
    if (!(res.arr[i] <= t)) return 0;
    const k = Math.min(R.stations.length - 1, Math.max(0, Math.round(G.S[i] / STEP)));
    const { ta, Hs, tr, trec } = res.st;
    const tau = t - ta[k];
    const stage = tau < tr[k] ? (Hs[k] * tau) / tr[k] : Hs[k] * Math.exp(-(tau - tr[k]) / trec[k]);
    return Math.max(0, Math.min(res.dmax[i], stage - res.E[i]));
  }

  // ---------- classification helpers ----------
  const DEPTH_BANDS = [0.5, 1, 2, 5];
  const depthClass = (d) => (d <= 0 ? -1 : d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : d < 5 ? 3 : 4);
  const ARR_BANDS = [15, 30, 60, 120];
  const arrClass = (a) => (!isFinite(a) ? -1 : a < 15 ? 0 : a < 30 ? 1 : a < 60 ? 2 : a < 120 ? 3 : 4);
  const durClass = (m) => (m <= 0 ? -1 : m < 60 ? 0 : m < 180 ? 1 : m < 360 ? 2 : m < 720 ? 3 : 4);
  const hazClass = (h) => (h <= 0 ? -1 : h < 0.75 ? 0 : h < 1.25 ? 1 : h < 2 ? 2 : 3);
  const HAZ_LABELS = ['LOW', 'MODERATE', 'SIGNIFICANT', 'EXTREME'];

  function riskLevel(depth, arrival, hazard) {
    if (!(depth > 0.05)) return 'NONE';
    if (hazard >= 2 || (depth >= 2 && arrival < 45)) return 'CRITICAL';
    if (depth >= 1 || hazard >= 1.25) return 'HIGH';
    if (depth >= 0.3) return 'MEDIUM';
    return 'LOW';
  }
  const RISK_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  // ---------- sampling ----------
  function sampleCell(res, idx) {
    if (idx < 0) return { depth: 0, arrival: Infinity, duration: 0, velocity: 0, hazard: 0 };
    return { depth: res.dmax[idx], arrival: res.arr[idx], duration: res.dur[idx], velocity: res.vmax[idx], hazard: res.hz[idx] };
  }
  // village sample: max over 3x3 neighbourhood (settlement footprint)
  function sampleArea(res, s, d) {
    const c = cellIndexSD(s, d);
    if (c < 0) return sampleCell(res, -1);
    let best = sampleCell(res, c);
    const r0 = Math.floor(c / G.cols), c0 = c % G.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = r0 + dr, cc = c0 + dc;
      if (r < 0 || cc < 0 || r >= G.rows || cc >= G.cols) continue;
      const q = sampleCell(res, r * G.cols + cc);
      if (q.depth > best.depth) best = Object.assign({}, q, { arrival: Math.min(q.arrival, best.arrival) });
      else if (q.arrival < best.arrival && q.depth > 0.05) best.arrival = q.arrival;
    }
    return best;
  }

  // ---------- road network ----------
  function buildRoads() {
    const spec = D.roadSpec;
    const nodes = {}, edges = [];
    const addNode = (id, s, d, kind, ref) => (nodes[id] = { id, s, d, kind, ref, ll: sdToLL(s, d) });
    const names = { '1i': 'East Inner Road', '1o': 'East Upland Road', '-1i': 'West Inner Road', '-1o': 'West Upland Road' };
    let rc = 1;
    const addEdge = (a, b, name, cls, extra) => {
      const id = 'R' + String(rc++).padStart(2, '0');
      const A = nodes[a], B = nodes[b];
      const geom = [];
      const len0 = Math.hypot(B.s - A.s, B.d - A.d);
      const nseg = Math.max(2, Math.ceil(len0 / 0.4));
      let len = 0, prev = null;
      for (let k = 0; k <= nseg; k++) {
        const f = k / nseg, s = A.s + f * (B.s - A.s), d = A.d + f * (B.d - A.d);
        const xy = sdToXY(s, d);
        if (prev) len += Math.hypot(xy[0] - prev[0], xy[1] - prev[1]);
        prev = xy;
        geom.push({ s, d, ll: toLL(xy[0], xy[1]) });
      }
      const e = Object.assign({ id, a, b, name: `${id} · ${name}`, cls, len, geom }, extra || {});
      edges.push(e);
      return e;
    };
    [1, -1].forEach((side) => {
      spec.stations.forEach((s) => {
        addNode(`I${side}_${s}`, s, side * spec.innerOffset, 'junction');
        addNode(`O${side}_${s}`, s, side * spec.outerOffset, 'junction');
      });
    });
    [1, -1].forEach((side) => {
      spec.stations.forEach((s, j) => {
        if (j > 0) {
          const p = spec.stations[j - 1];
          const mb = spec.minorBridges.find((b) => b.side === side && b.s > p && b.s < s);
          addEdge(`I${side}_${p}`, `I${side}_${s}`, names[side + 'i'], 'district', mb ? { bridge: mb } : null);
          addEdge(`O${side}_${p}`, `O${side}_${s}`, names[side + 'o'], 'state');
        }
        addEdge(`I${side}_${s}`, `O${side}_${s}`, `Link Road L-${side > 0 ? 'E' : 'W'}${s}`, 'link');
      });
    });
    spec.bridges.forEach((b) => addEdge(`I1_${b.s}`, `I-1_${b.s}`, b.name.replace(/ \(.*/, '') + ' crossing', 'bridge', { bridge: b, crossing: true }));
    D.safeZones.forEach((z) => {
      addNode(z.id, z.s, z.d, 'safe', z);
      const side = Math.sign(z.d);
      const near = spec.stations.reduce((a, b) => (Math.abs(b - z.s) < Math.abs(a - z.s) ? b : a));
      addEdge(`O${side}_${near}`, z.id, `Access Road to ${z.id}`, 'link');
    });
    D.villages.forEach((v) => {
      addNode(v.id, v.s, v.d, 'village', v);
      const side = Math.sign(v.d);
      const cands = Object.values(nodes).filter((n) => n.kind === 'junction' && Math.sign(n.d) === side)
        .map((n) => ({ n, dist: Math.hypot(n.s - v.s, n.d - v.d) })).sort((a, b) => a.dist - b.dist).slice(0, 2);
      cands.forEach((c) => addEdge(v.id, c.n.id, `Village Road (${v.name})`, 'village'));
    });
    const bridges = [];
    edges.forEach((e) => { if (e.bridge) bridges.push({ id: e.bridge.id, name: e.bridge.name, edge: e.id, s: e.bridge.s, crossing: !!e.crossing, ll: e.crossing ? sdToLL(e.bridge.s, 0) : sdToLL(e.bridge.s, e.bridge.side * spec.innerOffset) }); });
    return { nodes, edges, bridges };
  }
  const ROADS = buildRoads();

  const SPEED = { state: 35, district: 28, link: 22, village: 15, bridge: 28 }; // km/h (emergency conditions, assumed)
  const DECK_CLEARANCE = 7.5; // m above normal water level (illustrative)

  // Per-edge flood evaluation. blockTime = first time (min) water depth on the edge exceeds the
  // passability threshold (default 0.3 m). Routing is time-aware: an edge is usable only if the
  // evacuee clears it before blockTime minus a safety margin.
  function evaluateRoads(res, threshold) {
    threshold = threshold || 0.3;
    const out = {};
    ROADS.edges.forEach((e) => {
      let dm = 0, am = Infinity, bt = Infinity;
      if (e.crossing) {
        const k = Math.round(e.bridge.s / STEP);
        const H = res.st.Hs[k];
        dm = Math.max(0, H - DECK_CLEARANCE);
        am = dm > 0 ? res.st.ta[k] + (res.st.tr[k] * DECK_CLEARANCE) / H : Infinity;
        bt = am;
        const status = dm > 0 ? 'OVERTOPPED' : H > DECK_CLEARANCE * 0.75 ? 'AT RISK' : 'CLEAR';
        out[e.id] = { maxDepth: dm, arrival: am, blockTime: bt, blocked: dm > 0, risky: status === 'AT RISK', status, stage: H };
        return;
      }
      e.geom.forEach((g) => {
        if (Math.abs(g.d) < 0.4) return;
        const i = cellIndexLL(g.ll[0], g.ll[1]);
        if (i < 0 || !(res.dmax[i] > 0.05)) return;
        if (res.dmax[i] > dm) dm = res.dmax[i];
        if (res.arr[i] < am) am = res.arr[i];
        if (res.dmax[i] > threshold) {
          const k = Math.min(R.stations.length - 1, Math.max(0, Math.round(G.S[i] / STEP)));
          const tb = res.st.ta[k] + (res.st.tr[k] * (res.E[i] + threshold)) / res.st.Hs[k];
          if (tb < bt) bt = tb;
        }
      });
      const blocked = dm > threshold;
      const risky = !blocked && dm > 0.1;
      out[e.id] = { maxDepth: dm, arrival: am, blockTime: bt, blocked, risky, status: blocked ? 'FLOODED' : risky ? 'CAUTION' : 'CLEAR' };
    });
    return out;
  }

  const ROUTE_MARGIN = 10; // min safety margin before a road segment floods
  const edgeTime = (e, mode) => (e.len / (mode === 'foot' ? 4.5 : SPEED[e.cls])) * 60;

  // Time-dependent Dijkstra. opts: {avoidFlood, t0 (departure, min after breach), penalty:{edgeId:factor}, mode}
  function shortestPaths(src, roadEval, opts) {
    opts = opts || {};
    const t0 = opts.t0 || 0;
    const adj = {};
    ROADS.edges.forEach((e) => {
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, e });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, e });
    });
    const dist = { [src]: 0 }, prev = {}, done = new Set();
    const pq = [[0, src]];
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [du, u] = pq.shift();
      if (done.has(u)) continue;
      done.add(u);
      (adj[u] || []).forEach(({ to, e }) => {
        const ev = roadEval[e.id];
        const w0 = edgeTime(e, opts.mode);
        if (opts.avoidFlood && t0 + du + w0 + ROUTE_MARGIN > ev.blockTime) return;
        let w = w0;
        if (opts.avoidFlood && (ev.risky || ev.blocked)) w *= 1.8; // prefer roads that never flood
        if (opts.penalty && opts.penalty[e.id]) w *= opts.penalty[e.id];
        const nd = du + w;
        if (nd < (dist[to] ?? Infinity)) { dist[to] = nd; prev[to] = { from: u, e }; pq.push([nd, to]); }
      });
    }
    return { dist, prev };
  }
  function tracePath(sp, dst) {
    if (!(dst in sp.dist)) return null;
    const edges = [];
    let cur = dst;
    while (sp.prev[cur]) { edges.unshift(sp.prev[cur].e); cur = sp.prev[cur].from; }
    return edges;
  }
  function describeRoute(edges, roadEval, mode, t0) {
    if (!edges) return null;
    let len = 0, time = 0, worst = 0, earliest = Infinity, minMargin = Infinity;
    const blocked = [], risky = [];
    edges.forEach((e) => {
      const ev = roadEval[e.id];
      len += e.len;
      time += edgeTime(e, mode);
      worst = Math.max(worst, ev.maxDepth);
      const margin = ev.blockTime - ((t0 || 0) + time);
      if (margin < 0) blocked.push(e);
      else if (ev.risky || ev.blocked) risky.push(e);
      if (isFinite(ev.blockTime)) minMargin = Math.min(minMargin, margin);
      if (ev.maxDepth > 0.05) earliest = Math.min(earliest, ev.arrival);
    });
    const risk = blocked.length ? 'UNSAFE' : risky.length || minMargin < 30 ? 'CAUTION' : 'LOW';
    const coords = [];
    edges.forEach((e, i) => {
      // orient geometry along path
      const prevEnd = i === 0 ? null : coords[coords.length - 1];
      let g = e.geom.map((p) => p.ll);
      if (prevEnd && (Math.abs(g[0][0] - prevEnd[0]) + Math.abs(g[0][1] - prevEnd[1])) > (Math.abs(g[g.length - 1][0] - prevEnd[0]) + Math.abs(g[g.length - 1][1] - prevEnd[1]))) g = g.slice().reverse();
      coords.push(...g);
    });
    return { edges, len, time, worst, earliest, minMargin, blocked, risky, risk, coords };
  }

  // opts: {mode:'vehicle'|'foot', t0: departure time (min after breach initiation)}
  function planEvacuation(villageId, destId, roadEval, opts) {
    opts = opts || {};
    const mode = opts.mode || 'vehicle', t0 = opts.t0 ?? 15;
    const sp = shortestPaths(villageId, roadEval, { avoidFlood: true, mode, t0 });
    let dst = destId;
    if (!dst || dst === 'auto') {
      let best = Infinity;
      dst = null;
      D.safeZones.forEach((z) => { if ((sp.dist[z.id] ?? Infinity) < best) { best = sp.dist[z.id]; dst = z.id; } });
    }
    const recommended = dst && dst in sp.dist ? describeRoute(tracePath(sp, dst), roadEval, mode, t0) : null;
    let alternative = null;
    if (recommended) {
      const pen = {};
      recommended.edges.forEach((e) => (pen[e.id] = e.cls === 'village' ? 1.5 : 6));
      const alt = describeRoute(tracePath(shortestPaths(villageId, roadEval, { avoidFlood: true, mode, t0, penalty: pen }), dst), roadEval, mode, t0);
      if (alt && alt.edges.map((e) => e.id).join() !== recommended.edges.map((e) => e.id).join()) alternative = alt;
    }
    // flood-unaware shortest path — shown only when it would cross roads flooded before the evacuee passes
    const sp0 = shortestPaths(villageId, roadEval, { mode });
    let naiveDst = destId && destId !== 'auto' ? destId : null;
    if (!naiveDst) { let b = Infinity; D.safeZones.forEach((z) => { if ((sp0.dist[z.id] ?? Infinity) < b) { b = sp0.dist[z.id]; naiveDst = z.id; } }); }
    const naive = naiveDst ? describeRoute(tracePath(sp0, naiveDst), roadEval, mode, t0) : null;
    const avoidIds = naive ? naive.blocked.map((e) => e.id) : [];
    return { villageId, dest: dst, requestedDest: destId, t0, mode, recommended, alternative, naive: naive && naive.blocked.length ? naive : null, avoidIds };
  }

  // ---------- impact analysis ----------
  const DEFAULT_WEIGHTS = { population: 25, depth: 20, arrival: 25, infrastructure: 10, accessibility: 10, roads: 10 };

  function analyse(res, opts) {
    opts = opts || {};
    const weights = opts.weights || DEFAULT_WEIGHTS;
    const roadEval = evaluateRoads(res, opts.roadThreshold);
    // flooded area & per-panchayat area (cells assigned to nearest village)
    const vxy = D.villages.map((v) => sdToXY(v.s, v.d));
    let area = 0, maxDepth = 0, maxVel = 0, cells = 0;
    const gpArea = {};
    for (let i = 0; i < G.n; i++) {
      if (res.dmax[i] <= 0.05) continue;
      cells++;
      maxDepth = Math.max(maxDepth, res.dmax[i]);
      maxVel = Math.max(maxVel, res.vmax[i]);
      let b = 1e9, bi = 0;
      for (let k = 0; k < vxy.length; k++) { const q = (G.X[i] - vxy[k][0]) ** 2 + (G.Y[i] - vxy[k][1]) ** 2; if (q < b) { b = q; bi = k; } }
      const gp = D.villages[bi].gp;
      gpArea[gp] = (gpArea[gp] || 0) + G.cellArea;
    }
    area = cells * G.cellArea;
    const infra = D.infra.map((f) => {
      const q = sampleArea(res, f.s, f.d);
      const ll = sdToLL(f.s, f.d);
      return Object.assign({}, f, q, { lat: ll[0], lng: ll[1], distRiver: Math.abs(f.d), risk: riskLevel(q.depth, q.arrival, q.hazard) });
    });
    const bridges = ROADS.bridges.map((b) => {
      const ev = roadEval[b.edge];
      const risk = ev.status === 'OVERTOPPED' || ev.status === 'FLOODED' ? 'CRITICAL' : ev.status === 'AT RISK' || ev.status === 'CAUTION' ? 'HIGH' : 'LOW';
      return Object.assign({}, b, { depth: ev.maxDepth, arrival: ev.arrival, status: ev.status, risk, distRiver: b.crossing ? 0 : D.roadSpec.innerOffset, lat: b.ll[0], lng: b.ll[1] });
    });
    const villages = D.villages.map((v) => {
      const q = sampleArea(res, v.s, v.d);
      const ll = sdToLL(v.s, v.d);
      const risk = riskLevel(q.depth, q.arrival, q.hazard);
      const evac = planEvacuation(v.id, 'auto', roadEval, { mode: 'vehicle', t0: opts.t0 ?? 15 });
      const vInfra = infra.filter((f) => f.village === v.id);
      const connectors = ROADS.edges.filter((e) => e.a === v.id || e.b === v.id);
      const blockedConn = connectors.filter((e) => roadEval[e.id].blocked).length;
      return Object.assign({}, v, q, { lat: ll[0], lng: ll[1], risk, distRiver: Math.abs(v.d), distDam: v.s, affected: q.depth > 0.05, affectedPop: q.depth > 0.05 ? v.pop : 0, infra: vInfra, evac, safeZone: evac.dest, roadsBlockedFrac: connectors.length ? blockedConn / connectors.length : 0 });
    });
    // HADR priority (transparent weighted sum of normalised factors)
    const maxPop = Math.max(...D.villages.map((v) => v.pop));
    const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    villages.forEach((v) => {
      const critCount = v.infra.filter((f) => f.type === 'school' || f.type === 'health').length;
      const rt = v.evac.recommended;
      const access = !rt ? 1 : Math.min(1, rt.time / 60) * (rt.risk === 'CAUTION' ? 1.3 : 1);
      const f = {
        population: v.pop / maxPop,
        depth: Math.min(1, v.depth / 4),
        arrival: v.affected ? Math.max(0, 1 - v.arrival / 240) : 0,
        infrastructure: Math.min(1, critCount / 3),
        accessibility: Math.min(1, access),
        roads: v.roadsBlockedFrac
      };
      const contrib = {};
      let score = 0;
      Object.keys(weights).forEach((k) => { contrib[k] = (weights[k] * f[k]) / wsum * 100; score += contrib[k]; });
      if (!v.affected) score = 0;
      v.factors = f; v.contrib = contrib; v.score = score;
      v.priority = !v.affected ? 'NONE' : score >= 55 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
      v.accessLabel = !rt ? 'NONE' : rt.risk === 'CAUTION' || rt.time > 45 ? 'LOW' : rt.time > 25 ? 'MODERATE' : 'GOOD';
    });
    const gps = D.panchayats.map((p) => {
      const vs = villages.filter((v) => v.gp === p.id);
      const aff = vs.filter((v) => v.affected);
      const inf = infra.filter((f) => f.village && vs.some((v) => v.id === f.village) && f.depth > 0.05);
      const worst = aff.reduce((a, v) => (RISK_ORDER[v.risk] > RISK_ORDER[a] ? v.risk : a), 'NONE');
      const topPri = aff.reduce((a, v) => Math.max(a, v.score), 0);
      const vIds = new Set(vs.map((v) => v.id));
      const roadsAff = ROADS.edges.filter((e) => (vIds.has(e.a) || vIds.has(e.b)) && roadEval[e.id].blocked).length;
      const minS = Math.min(...vs.map((v) => v.s)) - 3, maxS = Math.max(...vs.map((v) => v.s)) + 3;
      const brAff = bridges.filter((b) => b.s >= minS && b.s <= maxS && b.risk !== 'LOW').length;
      return Object.assign({}, p, { villages: vs, affectedVillages: aff.length, population: aff.reduce((a, v) => a + v.pop, 0), area: gpArea[p.id] || 0, schools: inf.filter((f) => f.type === 'school').length, health: inf.filter((f) => f.type === 'health').length, infraCount: inf.length, roads: roadsAff, bridges: brAff, risk: worst, priorityScore: topPri, priority: topPri >= 55 ? 'HIGH' : topPri >= 35 ? 'MEDIUM' : topPri > 0 ? 'LOW' : 'NONE' });
    });
    const affV = villages.filter((v) => v.affected);
    const roadsFlooded = ROADS.edges.filter((e) => !e.crossing && roadEval[e.id].blocked);
    const firstArrival = affV.reduce((a, v) => Math.min(a, v.arrival), Infinity);
    return {
      roadEval, villages, infra, bridges, panchayats: gps,
      kpi: {
        maxDepth, maxVel, area, agriArea: area * 0.72, firstArrival,
        villages: affV.length, panchayats: gps.filter((g) => g.affectedVillages).length,
        population: affV.reduce((a, v) => a + v.pop, 0),
        roads: roadsFlooded.length, roadKm: roadsFlooded.reduce((a, e) => a + e.len, 0),
        bridges: bridges.filter((b) => b.risk !== 'LOW').length,
        infra: infra.filter((f) => f.depth > 0.05).length,
        highPriority: villages.filter((v) => v.priority === 'HIGH').length,
        peakQ: res.Qp,
        severity: affV.some((v) => v.risk === 'CRITICAL') ? 'SEVERE' : affV.some((v) => v.risk === 'HIGH') ? 'HIGH' : affV.length ? 'MODERATE' : 'LOW'
      }
    };
  }

  // flood envelope polygon (for KML/SHP/GeoJSON export): lateral extent per station
  function envelope(res, t) {
    const left = [], right = [];
    for (let s = 0.5; s <= R.length; s += 1) {
      let dl = 0, dr = 0;
      for (let d = 0.4; d <= BUF; d += 0.2) {
        const ip = cellIndexSD(s, d), im = cellIndexSD(s, -d);
        const wp = ip >= 0 && (t == null ? res.dmax[ip] > 0.05 : depthAt(res, ip, t) > 0.05);
        const wm = im >= 0 && (t == null ? res.dmax[im] > 0.05 : depthAt(res, im, t) > 0.05);
        if (wp) dl = d;
        if (wm) dr = d;
      }
      if (dl > 0 || dr > 0) { left.push(sdToLL(s, Math.max(dl, 0.35))); right.push(sdToLL(s, -Math.max(dr, 0.35))); }
    }
    if (left.length < 2) return null;
    const ring = left.concat(right.reverse());
    ring.push(ring[0]);
    return ring; // [lat,lng]
  }

  // synthetic "observed" water mask for the remote-sensing DEMO (perturbed simulation extent)
  function syntheticObservedMask(res) {
    const m = new Uint8Array(G.n);
    for (let i = 0; i < G.n; i++) {
      if (!G.valid[i]) continue;
      if (G.channel[i]) { m[i] = 1; continue; }
      const k = Math.min(R.stations.length - 1, Math.max(0, Math.round(G.S[i] / STEP)));
      const vd = res.dmax[i] > 0 ? res.dmax[i] : res.st.Hs[k] - res.E[i]; // virtual depth (negative when dry)
      const bias = 0.45 * vnoise(G.X[i] / 3 + 90, G.Y[i] / 3 - 30) + 0.2 * vnoise(G.X[i] / 0.8, G.Y[i] / 0.8 + 7);
      m[i] = vd + bias > 0.3 ? 1 : 0;
    }
    return m;
  }
  function compareMasks(res, obs) {
    let inter = 0, sim = 0, ob = 0;
    for (let i = 0; i < G.n; i++) {
      if (!G.valid[i] || G.channel[i]) continue;
      const a = res.dmax[i] > 0.05, b = obs[i] === 1;
      if (a) sim++;
      if (b) ob++;
      if (a && b) inter++;
    }
    const union = sim + ob - inter;
    return { iou: union ? inter / union : 0, simArea: sim * G.cellArea, obsArea: ob * G.cellArea, overlap: ob ? inter / ob : 0, diff: (sim - ob) * G.cellArea };
  }

  FS.engine = {
    toXY, toLL, sdToLL, R, G, ROADS, MODELS, STEP, bedLevel,
    peakDischarge, runModel, depthAt, analyse, evaluateRoads, planEvacuation,
    depthClass, arrClass, durClass, hazClass, HAZ_LABELS, DEPTH_BANDS, ARR_BANDS, riskLevel, RISK_ORDER,
    envelope, syntheticObservedMask, compareMasks, ROUTE_MARGIN, cellIndexLL, sampleCell, DEFAULT_WEIGHTS, DECK_CLEARANCE
  };
})();
