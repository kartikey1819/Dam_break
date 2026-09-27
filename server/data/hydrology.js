'use strict';
// Dam-breach parameters, breach outflow hydrograph and DEM-derived
// downstream flow path. Units: SI (m, m^3, s, m^3/s) unless named otherwise.

const G = 9.81;

// Ranges of the regression databases (approximate), used for warnings only
const FROEHLICH_RANGE = { hMin: 3, hMax: 93, vMin: 1.3e4, vMax: 6.6e8 };

/**
 * Empirical breach parameters.
 *  heightM      dam / breach height (hb), also used as head Hw unless waterDepthM given
 *  storageMCM   reservoir volume above breach invert (Vw), million m^3
 *  mode         'overtopping' | 'piping'
 *  crestLengthM optional cap for breach width
 */
function breachParams({ heightM, storageMCM, mode = 'overtopping', waterDepthM, crestLengthM } = {}) {
  const hb = Number(heightM);
  const Vw = Number(storageMCM) * 1e6;
  if (!(hb > 0) || !(Vw > 0)) throw new Error('breachParams: heightM and storageMCM must be positive numbers');
  const Hw = waterDepthM > 0 ? Number(waterDepthM) : hb;
  const piping = String(mode).toLowerCase() === 'piping';
  const k0 = piping ? 1.0 : 1.3;

  // Froehlich (2008): average breach width and failure time
  let B = 0.27 * k0 * Math.pow(Vw, 0.32) * Math.pow(hb, 0.04);
  const tf = 63.2 * Math.sqrt(Vw / (G * hb * hb));
  const warnings = [];
  if (crestLengthM > 0 && B > crestLengthM) {
    warnings.push(`Breach width ${B.toFixed(0)} m capped at crest length ${crestLengthM} m`);
    B = Number(crestLengthM);
  }
  // Froehlich (1995) peak outflow; MacDonald & Langridge-Monopolis (1984)
  const qF95 = 0.607 * Math.pow(Vw, 0.295) * Math.pow(Hw, 1.24);
  const qMLM = 1.154 * Math.pow(Vw * Hw, 0.412);

  if (hb > FROEHLICH_RANGE.hMax || Vw > FROEHLICH_RANGE.vMax) {
    warnings.push('Inputs exceed the historical-failure database (dams ≲ 93 m, ≲ 660 MCM); results are extrapolated and highly uncertain.');
  }
  if (hb < FROEHLICH_RANGE.hMin || Vw < FROEHLICH_RANGE.vMin) warnings.push('Inputs below the regression database range.');

  return {
    mode: piping ? 'piping' : 'overtopping',
    inputs: { heightM: hb, waterDepthM: Hw, storageMCM: Vw / 1e6, k0 },
    breachWidthM: round(B, 1),
    sideSlopeH_V: piping ? 0.7 : 1.0,
    failureTimeMin: round(tf / 60, 1),
    failureTimeSec: round(tf, 0),
    peakQ_Froehlich1995: round(qF95, 0),
    peakQ_MLM1984: round(qMLM, 0),
    warnings,
    methods: {
      breachWidth: 'Froehlich (2008): B = 0.27·k0·Vw^0.32·hb^0.04, k0 = 1.3 overtopping / 1.0 piping',
      failureTime: 'Froehlich (2008): tf = 63.2·sqrt(Vw / (g·hb²)) [s]',
      peakQ_Froehlich1995: 'Froehlich (1995): Qp = 0.607·Vw^0.295·Hw^1.24 [m³/s]',
      peakQ_MLM1984: 'MacDonald & Langridge-Monopolis (1984), earthfill best fit: Qp = 1.154·(Vw·Hw)^0.412 [m³/s]'
    },
    citations: [
      'Froehlich, D.C. (2008). Embankment dam breach parameters and their uncertainties. J. Hydraul. Eng. 134(12), 1708-1721.',
      'Froehlich, D.C. (1995). Peak outflow from breached embankment dam. J. Water Resour. Plann. Manage. 121(1), 90-97.',
      'MacDonald, T.C. & Langridge-Monopolis, J. (1984). Breaching characteristics of dam failures. J. Hydraul. Eng. 110(5), 567-586.'
    ]
  };
}

function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/**
 * Breach outflow hydrograph: half-cosine rise to Qp at tf, then exponential
 * recession Qp·exp(-(t-tf)/k) with k chosen so the total volume ≈ volumeM3.
 * durationSec defaults to the time at which q falls to 1% of Qp.
 */
function breachHydrograph({ Qp, tfSec, volumeM3, durationSec, dtSec = 60 }) {
  if (!(Qp > 0 && tfSec > 0 && volumeM3 > 0)) throw new Error('breachHydrograph: Qp, tfSec, volumeM3 must be > 0');
  const riseVol = Qp * tfSec / 2; // integral of half-cosine rise
  let k = (volumeM3 - riseVol) / Qp;
  let note = null;
  if (k < tfSec / 10) {
    k = tfSec / 10;
    note = 'Rising limb alone exceeds the stored volume; recession constant set to tf/10 (volume overestimated).';
  }
  const T = durationSec > 0 ? durationSec : tfSec + k * Math.log(100);
  const n = Math.ceil(T / dtSec);
  const t = new Array(n + 1), q = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const ti = Math.min(i * dtSec, T);
    t[i] = ti;
    q[i] = ti <= tfSec
      ? Qp * (1 - Math.cos(Math.PI * ti / tfSec)) / 2
      : Qp * Math.exp(-(ti - tfSec) / k);
  }
  let vol = 0;
  for (let i = 1; i <= n; i++) vol += (q[i] + q[i - 1]) / 2 * (t[i] - t[i - 1]);
  return {
    t,
    q,
    volumeM3: Math.round(vol),
    targetVolumeM3: volumeM3,
    recessionK_s: Math.round(k),
    durationSec: T,
    shape: 'half-cosine rise to Qp at tf, exponential recession',
    note
  };
}

// ---------- DEM hydro-conditioning and flow tracing ----------

// Minimal binary min-heap over (key, value) pairs using typed arrays
class MinHeap {
  constructor(cap) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  push(key, val) {
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    const key = K[--this.n], val = V[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= key) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = key; V[i] = val;
    return top;
  }
}

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

/**
 * Priority-Flood + ε (Barnes, Lehman & Mulla 2014): fills depressions so
 * every cell drains to the grid edge; flats receive a tiny ε gradient.
 * NaN cells are treated as outlets (edges).
 */
function fillDepressions(spec, z, eps = 1e-3) {
  const { rows, cols } = spec;
  const N = rows * cols;
  const f = new Float64Array(N);
  const done = new Uint8Array(N);
  const heap = new MinHeap(N);
  for (let i = 0; i < N; i++) {
    const r = (i / cols) | 0, c = i - r * cols;
    const v = z[i];
    if (Number.isNaN(v)) { f[i] = -Infinity; done[i] = 1; continue; }
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
      f[i] = v; done[i] = 1; heap.push(v, i);
    }
  }
  // cells adjacent to NaN (no-data holes) also act as outlets
  for (let i = 0; i < N; i++) {
    if (done[i]) continue;
    const r = (i / cols) | 0, c = i - r * cols;
    for (let k = 0; k < 8; k++) {
      if (Number.isNaN(z[(r + DR[k]) * cols + c + DC[k]])) { f[i] = z[i]; done[i] = 1; heap.push(z[i], i); break; }
    }
  }
  while (heap.n > 0) {
    const i = heap.pop();
    const r = (i / cols) | 0, c = i - r * cols;
    const fi = f[i];
    for (let k = 0; k < 8; k++) {
      const rr = r + DR[k], cc = c + DC[k];
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (done[j]) continue;
      done[j] = 1;
      f[j] = z[j] > fi + eps ? z[j] : fi + eps;
      heap.push(f[j], j);
    }
  }
  return f;
}

function cellSizes(spec) {
  const latMid = spec.north - spec.rows * spec.dLat / 2;
  const dy = spec.dLat * 110574;
  const dx = spec.dLng * 111320 * Math.cos(latMid * Math.PI / 180);
  return { dx, dy, dd: Math.hypot(dx, dy) };
}

/**
 * Downstream course from (lat, lng) by D8 steepest descent on the filled DEM.
 * The start is first snapped to the lowest raw-DEM cell within snapM (~1 km),
 * i.e. the channel just below the dam rather than the reservoir surface.
 */
function flowPath(spec, z, lat, lng, maxKm = 60, { snapM = 1000, smooth = true, filled } = {}) {
  const { rows, cols } = spec;
  const { dx, dy, dd } = cellSizes(spec);
  const r0 = Math.floor((spec.north - lat) / spec.dLat);
  const c0 = Math.floor((lng - spec.west) / spec.dLng);
  if (r0 < 0 || c0 < 0 || r0 >= rows || c0 >= cols) throw new Error('flowPath: start point outside the DEM grid');

  // snap to lowest cell within radius
  const nr = Math.ceil(snapM / dy), nc = Math.ceil(snapM / dx);
  let best = r0 * cols + c0;
  for (let r = Math.max(0, r0 - nr); r <= Math.min(rows - 1, r0 + nr); r++) {
    for (let c = Math.max(0, c0 - nc); c <= Math.min(cols - 1, c0 + nc); c++) {
      if (Math.hypot((r - r0) * dy, (c - c0) * dx) > snapM) continue;
      const j = r * cols + c;
      if (z[j] < z[best]) best = j;
    }
  }

  const f = filled || fillDepressions(spec, z);
  const dist = [dy, dx, dy, dx, dx, dy, dx, dy].map((v, k) => (DR[k] && DC[k] ? dd : v));
  const cells = [best];
  const seen = new Set(cells);
  let cur = best, travelled = 0, reachedEdge = false;
  // D8 zig-zag overstates length; trace further, then trim on smoothed km
  const maxM = maxKm * 1000 * 1.5;
  while (travelled < maxM) {
    const r = (cur / cols) | 0, c = cur - r * cols;
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) { reachedEdge = true; break; }
    let nxt = -1, bestS = 0, step = 0;
    for (let k = 0; k < 8; k++) {
      const j = (r + DR[k]) * cols + c + DC[k];
      const s = (f[cur] - f[j]) / dist[k];
      if (s > bestS) { bestS = s; nxt = j; step = dist[k]; }
    }
    if (nxt < 0 || seen.has(nxt)) break; // outlet / no-data hole
    seen.add(nxt);
    cells.push(nxt);
    travelled += step;
    cur = nxt;
  }

  let path = cells.map(i => {
    const r = (i / cols) | 0, c = i - r * cols;
    return [spec.north - (r + 0.5) * spec.dLat, spec.west + (c + 0.5) * spec.dLng];
  });
  if (smooth && path.length > 4) {
    // light 5-point weighted moving average; endpoints fixed
    const w = [1, 2, 3, 2, 1];
    path = path.map((p, i) => {
      if (i < 2 || i > path.length - 3) return p;
      let la = 0, ln = 0, sw = 0;
      for (let k = -2; k <= 2; k++) { la += path[i + k][0] * w[k + 2]; ln += path[i + k][1] * w[k + 2]; sw += w[k + 2]; }
      return [la / sw, ln / sw];
    });
  }
  path = path.map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
  let km = [0];
  for (let i = 1; i < path.length; i++) km.push(km[i - 1] + haversineKm(path[i - 1], path[i]));
  const cut = km.findIndex(v => v >= maxKm);
  if (cut > 0) {
    path = path.slice(0, cut + 1);
    km = km.slice(0, cut + 1);
    cells.length = cut + 1;
    reachedEdge = false;
  }
  const elev = cells.map(i => Math.round(z[i] * 10) / 10);
  return {
    path,
    km: km.map(v => Math.round(v * 1000) / 1000),
    elev,
    cells,
    lengthKm: Math.round(km[km.length - 1] * 100) / 100,
    snappedStart: path[0],
    reachedEdge,
    method: 'Priority-Flood+ε depression filling (Barnes et al. 2014) + D8 steepest descent'
  };
}

function haversineKm(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Unit vector [east, north] from the path start to the point ~alongKm downstream. */
function downstreamBearing(path, alongKm = 3) {
  const pts = Array.isArray(path) ? path : path.path;
  if (!pts || pts.length < 2) return [0, -1];
  let acc = 0, end = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    acc += haversineKm(pts[i - 1], pts[i]);
    if (acc >= alongKm) { end = pts[i]; break; }
  }
  const [lat0, lng0] = pts[0];
  const e = (end[1] - lng0) * 111320 * Math.cos(lat0 * Math.PI / 180);
  const n = (end[0] - lat0) * 110574;
  const L = Math.hypot(e, n);
  return L > 0 ? [e / L, n / L] : [0, -1];
}

module.exports = {
  breachParams,
  breachHydrograph,
  fillDepressions,
  flowPath,
  downstreamBearing,
  haversineKm
};
