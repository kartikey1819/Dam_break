'use strict';
// Shared helpers for the flood solvers: input normalisation, hydrograph integration, PRNG.

const G = 9.81;

// Piecewise-linear hydrograph, q clamped >= 0 and held constant outside [t0, tn].
// cum(s) = exact integral of q from 0 to s, so injected volume is exact for any dt.
function makeHydrograph(hg) {
  const ts = (hg && hg.t) || [];
  const qs = (hg && hg.q) || [];
  const n = Math.min(ts.length, qs.length);
  if (n === 0) return { q: () => 0, cum: () => 0 };
  const t = new Float64Array(n);
  const q = new Float64Array(n);
  for (let k = 0; k < n; k++) { t[k] = +ts[k]; q[k] = Math.max(0, +qs[k] || 0); }
  const C = new Float64Array(n);
  for (let k = 1; k < n; k++) C[k] = C[k - 1] + 0.5 * (q[k] + q[k - 1]) * (t[k] - t[k - 1]);
  let seg = 0; // cached segment index (queries are mostly monotonic in time)
  function find(s) {
    if (s < t[seg]) seg = 0;
    while (seg < n - 2 && s >= t[seg + 1]) seg++;
    return seg;
  }
  function qAt(s) {
    if (n === 1 || s <= t[0]) return q[0];
    if (s >= t[n - 1]) return q[n - 1];
    const k = find(s);
    const dt = t[k + 1] - t[k];
    return dt > 0 ? q[k] + (q[k + 1] - q[k]) * (s - t[k]) / dt : q[k + 1];
  }
  function phi(s) { // integral from t0 to s
    if (n === 1 || s <= t[0]) return q[0] * (s - t[0]);
    if (s >= t[n - 1]) return C[n - 1] + q[n - 1] * (s - t[n - 1]);
    const k = find(s);
    const dt = t[k + 1] - t[k];
    const a = s - t[k];
    const slope = dt > 0 ? (q[k + 1] - q[k]) / dt : 0;
    return C[k] + a * (q[k] + 0.5 * a * slope);
  }
  const phi0 = phi(0);
  return { q: qAt, cum: (s) => phi(s) - phi0 };
}

// Validates and normalises the common solver input.
function prepare(input) {
  const g = input.grid || {};
  const rows = g.rows | 0, cols = g.cols | 0;
  const dx = +g.dx, dy = +g.dy;
  if (!(rows > 1 && cols > 1 && dx > 0 && dy > 0)) throw new Error('invalid grid');
  const N = rows * cols;
  if (!input.z || input.z.length !== N) throw new Error('z must have rows*cols values');

  const z = new Float64Array(N);
  const act = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const zi = input.z[i];
    const ok = Number.isFinite(zi) && (!input.mask || input.mask[i] !== 0);
    act[i] = ok ? 1 : 0;
    z[i] = Number.isFinite(zi) ? zi : 0;
  }

  // g * n^2 per cell
  const gn2 = new Float64Array(N);
  const man = input.manning;
  for (let i = 0; i < N; i++) {
    let n = typeof man === 'number' ? man : (man && man.length === N ? man[i] : 0.035);
    if (!(n >= 0)) n = 0.035;
    gn2[i] = G * n * n;
  }

  const sources = [];
  for (const s of input.sources || []) {
    const cells = [];
    for (const c of s.cells || []) {
      const i = c | 0;
      if (i >= 0 && i < N) { cells.push(i); act[i] = 1; } // sources always wet-able
    }
    if (!cells.length) continue;
    let ex = 0, ey = 0, speed = 0;
    if (s.dir && s.speed > 0) {
      const m = Math.hypot(s.dir[0], s.dir[1]);
      if (m > 0) { ex = s.dir[0] / m; ey = -s.dir[1] / m; speed = +s.speed; } // ey: south-positive (row index)
    }
    sources.push({ cells: Int32Array.from(cells), hyd: makeHydrograph(s.hydrograph), ex, ey, speed });
  }

  const h0 = new Float64Array(N);
  if (input.initialDepth && input.initialDepth.length === N) {
    for (let i = 0; i < N; i++) {
      const d = input.initialDepth[i];
      if (act[i] && d > 0 && Number.isFinite(d)) h0[i] = d;
    }
  }

  const duration = Math.max(0, +input.duration || 0);
  const frameInterval = +input.frameInterval > 0 ? +input.frameInterval : 900;
  const th = input.thresholds || {};
  const wet = th.wet > 0 ? +th.wet : 0.05;
  const block = th.block > 0 ? +th.block : 0.3;
  return { rows, cols, dx, dy, N, z, act, gn2, sources, h0, duration, frameInterval, wet, block };
}

function newRasters(N) {
  const arr = new Float32Array(N).fill(-1);
  const tblk = new Float32Array(N).fill(-1);
  return { dmax: new Float32Array(N), vmax: new Float32Array(N), arr, tblk, dur: new Float32Array(N) };
}

// Calls onProgress at most once per whole percent.
function progressReporter(onProgress, label) {
  let last = -1;
  return function (frac, extra) {
    if (typeof onProgress !== 'function') return;
    const p = Math.floor(Math.min(1, Math.max(0, frac)) * 100);
    if (p <= last) return;
    last = p;
    onProgress(p / 100, label + ' ' + p + '%' + (extra ? ' ' + extra : ''));
  };
}

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { G, makeHydrograph, prepare, newRasters, progressReporter, rng };
