/* FloodSim HADR — OFFLINE DEMO scenario (browser-side PARAMETRIC SURROGATE).
 *
 * Used only when the backend is not running (file:// or static hosting). It does NOT implement SPH or
 * Delft3D; "SPH" and "Delft3D" outputs are the same closed-form surrogate with calibration offsets,
 * labelled SIMULATED DEMO. The real numerical solvers run in the Node backend (server/solvers).
 * Output uses the generic Scenario format consumed by FS.analysis and all views.
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
      if (!G.valid[i]) continue;
      const k = Math.min(ns - 1, Math.max(0, Math.round(G.S[i] / STEP)));
      let e = G.Z[i] - bedLevel(G.S[i]);
      if (G.channel[i]) e = 0.05;
      else if (M.scatter) e += M.scatter * vnoise(G.X[i] / 0.9 + 40, G.Y[i] / 0.9 + 40);
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

  // ---------- generic Scenario (same format the backend returns) ----------
  function tblkOf(res, i, thr) {
    const k = Math.min(R.stations.length - 1, Math.max(0, Math.round(G.S[i] / STEP)));
    const H = res.st.Hs[k], e = res.E[i];
    return e + thr < H && res.dmax[i] >= thr ? res.st.ta[k] + (res.st.tr[k] * (e + thr)) / H : Infinity;
  }
  function stageDepth(res, i, t) {
    if (!(res.arr[i] <= t)) return 0;
    const k = Math.min(R.stations.length - 1, Math.max(0, Math.round(G.S[i] / STEP)));
    const { ta, Hs, tr, trec } = res.st, tau = t - ta[k];
    const stage = tau < tr[k] ? (Hs[k] * tau) / tr[k] : Hs[k] * Math.exp(-(tau - tr[k]) / trec[k]);
    return Math.max(0, Math.min(res.dmax[i], stage - res.E[i]));
  }
  function toModel(res, duration) {
    const n = G.n, tblk = new Float32Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) if (res.dmax[i] > 0.3) tblk[i] = tblkOf(res, i, 0.3);
    const times = [], h = [];
    for (let t = 0; t <= duration + 1e-6; t += 15) {
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) if (res.dmax[i] > 0) f[i] = stageDepth(res, i, t);
      times.push(t); h.push(f);
    }
    const M = res.model;
    return {
      key: M.key, name: M.name, short: M.short, label: 'SIMULATED DEMO (surrogate)',
      engine: `Parametric surrogate with ${M.short} calibration offsets (browser demo — not an SPH/Delft3D numerical run)`,
      dmax: res.dmax, vmax: res.vmax, arr: res.arr, tblk, dur: res.dur, hz: res.hz,
      frames: { times, h }, Qp: res.Qp, stats: { engine: 'surrogate', cells: n }
    };
  }
  function features() {
    const villages = D.villages.map((v) => { const ll = sdToLL(v.s, v.d); return { id: v.id, name: v.name, lat: ll[0], lng: ll[1], pop: v.pop, popSource: 'DEMO', group: v.gp, place: 'village' }; });
    const infra = D.infra.map((f) => { const ll = sdToLL(f.s, f.d); const v = D.villages.find((x) => x.id === f.village) || D.villages.reduce((a, x) => (Math.abs(x.s - f.s) < Math.abs(a.s - f.s) ? x : a)); return { id: f.id, type: f.type, name: f.name, lat: ll[0], lng: ll[1], village: f.village, group: v.gp }; });
    const nodes = {};
    Object.values(ROADS.nodes).forEach((n) => (nodes[n.id] = { id: n.id, lat: n.ll[0], lng: n.ll[1], kind: n.kind }));
    const edges = ROADS.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, name: e.name, cls: e.cls, len: e.len, geom: e.geom.map((g) => g.ll), crossing: !!e.crossing, bridge: e.bridge ? { id: e.bridge.id, name: e.bridge.name } : null }));
    const nearGp = (s) => D.villages.reduce((a, x) => (Math.abs(x.s - s) < Math.abs(a.s - s) ? x : a)).gp;
    const bridges = ROADS.bridges.map((b) => ({ id: b.id, name: b.name, lat: b.ll[0], lng: b.ll[1], edge: b.edge, crossing: b.crossing, group: nearGp(b.s) }));
    const safeZones = D.safeZones.map((z) => { const ll = sdToLL(z.s, z.d); return { id: z.id, name: z.name, lat: ll[0], lng: ll[1], capacity: z.capacity, note: 'Illustrative demo location — not an officially notified relief camp' }; });
    const groups = D.panchayats.map((p) => ({ id: p.id, name: p.name, block: p.block, kind: 'Gram Panchayat (demo)' }));
    return { villages, groups, infra, roads: { nodes, edges }, bridges, safeZones };
  }
  let FEAT = null;
  function buildScenario(cfg) {
    cfg = Object.assign({}, cfg);
    FEAT = FEAT || features();
    const sph = runModel(cfg, 'sph'), dl = runModel(cfg, 'delft3d');
    const [s, n] = [G.north - G.rows * G.dLat, G.north];
    const cosL = Math.cos((((s + n) / 2) * Math.PI) / 180);
    return {
      id: 'demo-kosi', mode: 'demo', createdAt: new Date().toISOString(),
      name: 'Kosi Demo Dam', dam: { name: D.dam.name, lat: D.dam.lat, lng: D.dam.lng, river: 'Kosi', state: 'Bihar', heightM: null, storageMCM: cfg.storage, note: D.dam.type },
      river: D.river, riverSource: 'OpenStreetMap (ODbL), simplified',
      config: cfg,
      grid: { rows: G.rows, cols: G.cols, north: G.north, west: G.west, dLat: G.dLat, dLng: G.dLng, n: G.n, dx: G.dLng * 111320 * cosL, dy: G.dLat * 110574, cellArea: G.cellArea, demSource: 'Synthetic demo DEM (procedural)' },
      dem: G.Z, channel: G.channel,
      models: { sph: toModel(sph, cfg.duration), delft3d: toModel(dl, cfg.duration) },
      features: FEAT,
      assumptions: { cropFraction: 0.72 },
      sources: [
        ['River centreline', 'OpenStreetMap (ODbL), simplified snapshot', 'REAL'],
        ['DEM', 'Synthetic procedural terrain (demo)', 'DEMO'],
        ['Villages / panchayats / roads / infrastructure / safe zones', 'Synthetic demo layers', 'DEMO'],
        ['Model results', 'Browser parametric surrogate (SPH / Delft3D offsets)', 'SIM']
      ]
    };
  }

  // synthetic "observed" water mask for the remote-sensing DEMO (perturbed simulation extent)
  function syntheticObservedMask(scn, M) {
    const m = new Uint8Array(G.n);
    for (let i = 0; i < G.n; i++) {
      if (!G.valid[i]) continue;
      if (G.channel[i]) { m[i] = 1; continue; }
      const bias = 0.45 * vnoise(G.X[i] / 3 + 90, G.Y[i] / 3 - 30) + 0.2 * vnoise(G.X[i] / 0.8, G.Y[i] / 0.8 + 7);
      m[i] = M.dmax[i] + bias - (M.dmax[i] > 0 ? 0 : 0.6) > 0.3 ? 1 : 0;
    }
    return m;
  }

  FS.demo = { buildScenario, peakDischarge, syntheticObservedMask, MODELS };
})();
