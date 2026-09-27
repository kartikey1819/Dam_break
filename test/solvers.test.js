'use strict';
// Solver verification: synthetic north->south valley, breach hydrograph, SWE (FV) and SPH-SWE.
// Run: node test/solvers.test.js [swe|sph|perf]   (no argument = everything)

const assert = require('assert');
const swe = require('../server/solvers/swe');
const sph = require('../server/solvers/sph');
const { rng, makeHydrograph } = require('../server/solvers/common');

// Valley DEM: bed slope S southward, gentle floodplain cross-slope, steep hillsides, random roughness.
function valleyDem(rows, cols, d, opts) {
  const o = Object.assign({ S: 0.001, floodHalf: 1500, cross: 0.002, hill: 0.03, rough: 0.2, seed: 7 }, opts);
  const rnd = rng(o.seed);
  const z = new Float32Array(rows * cols);
  const xc = (cols / 2) * d;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const y = (r + 0.5) * d, x = (c + 0.5) * d;
      const off = Math.abs(x - xc);
      let zz = 100 - o.S * y + o.cross * off + o.hill * Math.max(0, off - o.floodHalf);
      if (o.meander) zz += o.meander * Math.sin(y / 2500) * (off / o.floodHalf); // tilts cross-section
      zz += o.rough * (rnd() - 0.5) * 2;
      z[r * cols + c] = zz;
    }
  }
  return z;
}

// Breach hydrograph: linear rise to peak at tp, exponential recession (time constant tau).
function breachHydrograph(peak, tp, tau, tEnd, step) {
  const t = [], q = [];
  for (let s = 0; s <= tEnd; s += step) {
    t.push(s);
    q.push(s <= tp ? peak * s / tp : peak * Math.exp(-(s - tp) / tau));
  }
  return { t, q };
}

function sourceCells(cols, row, half) {
  const c0 = (cols / 2) | 0, cells = [];
  for (let c = c0 - half; c <= c0 + half - 1; c++) cells.push(row * cols + c);
  return cells;
}

// Rows north of the breach are the reservoir/dam: inactive (reflective) cells.
function damMask(rows, cols, srcRow) {
  const m = new Uint8Array(rows * cols).fill(1);
  m.fill(0, 0, srcRow * cols);
  return m;
}

function hasNaN(a) { for (let i = 0; i < a.length; i++) if (Number.isNaN(a[i])) return true; return false; }

// Earliest arrival across the floodplain (+-k cols of the thalweg) in a given row.
function rowArrival(res, rows, cols, r, k) {
  const c0 = (cols / 2) | 0;
  let best = -1;
  for (let c = c0 - k; c <= c0 + k; c++) {
    const a = res.arr[r * cols + c];
    if (a >= 0 && (best < 0 || a < best)) best = a;
  }
  return best;
}

function summarize(name, res, rows, cols, d, srcRow) {
  const st = res.stats;
  let area = 0, hmax = 0;
  for (let i = 0; i < res.dmax.length; i++) {
    if (res.dmax[i] > 0.05) area++;
    if (res.dmax[i] > hmax) hmax = res.dmax[i];
  }
  let vm = 0;
  for (let i = 0; i < res.vmax.length; i++) if (res.vmax[i] > vm) vm = res.vmax[i];
  const L = rows - 1 - srcRow;
  const arrivals = [0.25, 0.5, 0.75].map((f) => {
    const r = srcRow + Math.round(f * L);
    return { f, r, t: rowArrival(res, rows, cols, r, 12) };
  });
  const fmt = (x, n = 2) => (x == null ? '-' : Number(x).toFixed(n));
  console.log(`\n== ${name} (${st.engine}) ==`);
  console.log(`  runtime        ${fmt(st.runtimeMs / 1000, 2)} s, steps ${st.steps}, dt ${fmt(st.dtMin, 2)}..${fmt(st.dtMax, 2)} s`);
  console.log(`  volume in/out/final  ${fmt(st.volumeIn / 1e6, 2)} / ${fmt(st.volumeOut / 1e6, 2)} / ${fmt(st.volumeFinal / 1e6, 2)} Mm3` +
    (st.volumeOutEdges ? `  (out N/S/E/W ${['north', 'south', 'east', 'west'].map((k) => fmt(st.volumeOutEdges[k] / 1e6, 1)).join('/')})` : ''));
  console.log(`  mass error     ${fmt(st.massErrorPct, 4)} %` +
    (st.rasterVolumeErrorPct != null ? `   (raster vs particle volume ${fmt(st.rasterVolumeErrorPct, 2)} %)` : '') +
    (st.volumeClipped != null ? `   (clipped ${fmt(st.volumeClipped, 1)} m3)` : ''));
  if (st.particles != null) console.log(`  particles      peak ${st.particles}, V=${fmt(st.particleVolume, 0)} m3, l=${fmt(st.smoothingLength, 0)} m, ~${fmt(st.meanNeighbours, 1)} neighbours`);
  console.log(`  flooded area   ${fmt(area * d * d / 1e6, 2)} km2 (dmax>0.05 m), max depth ${fmt(hmax, 2)} m, max speed ${fmt(vm, 2)} m/s`);
  console.log('  arrival        ' + arrivals.map((a) => `${a.f * 100}% (row ${a.r}): ${a.t < 0 ? 'never' : fmt(a.t / 60, 1) + ' min'}`).join(', '));
  console.log(`  frames         ${res.frames.length} (${res.frames.map((f) => f.t).slice(0, 4).join(',')}...)`);
  return { area, hmax, arrivals };
}

function check(name, res, sum, maxErr) {
  const N = res.dmax.length;
  for (const k of ['dmax', 'vmax', 'arr', 'tblk', 'dur']) {
    assert.ok(res[k] instanceof Float32Array && res[k].length === N, `${name}: ${k} shape`);
    assert.ok(!hasNaN(res[k]), `${name}: NaN in ${k}`);
  }
  for (const f of res.frames) assert.ok(!hasNaN(f.h), `${name}: NaN in frame t=${f.t}`);
  assert.ok(Math.abs(res.stats.massErrorPct) < maxErr, `${name}: mass error ${res.stats.massErrorPct}%`);
  const t = sum.arrivals.map((a) => a.t);
  assert.ok(t.every((x) => x >= 0), `${name}: front did not reach 75% of the valley`);
  assert.ok(t[0] < t[1] && t[1] < t[2], `${name}: arrival not monotonic downstream (${t.join(', ')})`);
  assert.ok(sum.hmax > 0.5 && sum.hmax < 60, `${name}: implausible max depth ${sum.hmax}`);
}

function valleyCase() {
  const rows = 120, cols = 80, d = 150, srcRow = 3;
  const z = valleyDem(rows, cols, d, {});
  const hg = breachHydrograph(20000, 1200, 6900, 3 * 3600, 60);
  const total = makeHydrograph(hg).cum(3 * 3600);
  const input = {
    grid: { rows, cols, dx: d, dy: d }, z, manning: 0.035, mask: damMask(rows, cols, srcRow),
    sources: [{ cells: sourceCells(cols, srcRow, 2), hydrograph: hg, dir: [0, -1], speed: 3 }],
    duration: 3 * 3600, frameInterval: 900, thresholds: { wet: 0.05, block: 0.3 }, cfl: 0.45,
    sph: { maxParticles: 15000 },
  };
  return { input, rows, cols, d, srcRow, total };
}

function progress() {
  let last = 0;
  return (f, msg) => { const now = Date.now(); if (now - last > 2000) { last = now; process.stdout.write(`    ${msg}\n`); } };
}

function testValley(which) {
  const C = valleyCase();
  console.log(`Valley ${C.rows}x${C.cols} @ ${C.d} m, breach hydrograph 20000 m3/s peak @ 20 min, total ~150 Mm3 (${(C.total / 1e6).toFixed(1)} Mm3 within the 3 h run)`);
  if (which !== 'sph') {
    const r = swe.run(C.input, progress());
    check('SWE', r, summarize('SWE', r, C.rows, C.cols, C.d, C.srcRow), 3);
  }
  if (which !== 'swe') {
    const r = sph.run(C.input, progress());
    check('SPH', r, summarize('SPH', r, C.rows, C.cols, C.d, C.srcRow), 5);
  }
}

// Lake at rest over rough terrain must stay at rest (well-balanced check, SWE only).
function testLakeAtRest() {
  const rows = 40, cols = 40, d = 100;
  const z = valleyDem(rows, cols, d, { S: 0, floodHalf: 800, cross: 0.01, hill: 0.05, rough: 1.0 });
  const h0 = new Float32Array(rows * cols);
  for (let i = 0; i < h0.length; i++) h0[i] = Math.max(0, 101.5 - z[i]);
  const r = swe.run({ grid: { rows, cols, dx: d, dy: d }, z, initialDepth: h0, mask: undefined, sources: [],
    duration: 1800, frameInterval: 900, thresholds: { wet: 0.05, block: 0.3 } });
  let vm = 0;
  for (let i = 0; i < r.vmax.length; i++) vm = Math.max(vm, r.vmax[i]);
  console.log(`\n== SWE lake at rest == max spurious speed ${vm.toExponential(2)} m/s, mass error ${r.stats.massErrorPct.toExponential(2)} %`);
  assert.ok(vm < 1e-6, 'SWE not well-balanced');
}

// Mask wall test: a reflective block in the valley must receive no water.
function testMask() {
  const C = valleyCase();
  const mask = Uint8Array.from(C.input.mask);
  const c0 = (C.cols / 2) | 0;
  for (let r = 40; r < 46; r++) for (let c = c0 - 3; c < c0 + 3; c++) mask[r * C.cols + c] = 0;
  const input = Object.assign({}, C.input, { mask, duration: 3600 });
  for (const [name, solver] of [['SWE', swe], ['SPH', sph]]) {
    const r = solver.run(input);
    let wetInWall = 0;
    for (let i = C.srcRow * C.cols; i < mask.length; i++) if (!mask[i] && r.dmax[i] > 0) wetInWall++;
    console.log(`== ${name} mask wall == wet inactive cells: ${wetInWall}, mass error ${r.stats.massErrorPct.toFixed(4)} %`);
    assert.strictEqual(wetInWall, 0);
  }
}

function testPerf() {
  const rows = 250, cols = 250, d = 150;
  const z = valleyDem(rows, cols, d, { floodHalf: 4000, cross: 0.003, hill: 0.02, rough: 0.5, meander: 4, seed: 11 });
  const hg = breachHydrograph(30000, 1800, 9000, 6 * 3600, 60);
  const input = {
    grid: { rows, cols, dx: d, dy: d }, z, manning: 0.035, mask: damMask(rows, cols, 4),
    sources: [{ cells: sourceCells(cols, 4, 3), hydrograph: hg, dir: [0, -1], speed: 3 }],
    duration: 6 * 3600, frameInterval: 900, thresholds: { wet: 0.05, block: 0.3 }, cfl: 0.45,
    sph: { maxParticles: 15000 },
  };
  console.log(`\nPerformance 250x250 @ 150 m, 6 h, peak 30000 m3/s (${(makeHydrograph(hg).cum(6 * 3600) / 1e6).toFixed(0)} Mm3)`);
  const r = swe.run(input, progress());
  const s = summarize('SWE perf', r, rows, cols, d, 4);
  assert.ok(Math.abs(r.stats.massErrorPct) < 3 && !hasNaN(r.dmax) && s.hmax > 0);
  if (process.argv.includes('sph-perf')) {
    const q = sph.run(input, progress());
    summarize('SPH perf', q, rows, cols, d, 4);
  }
}

const arg = process.argv[2] || 'all';
if (arg === 'all' || arg === 'swe' || arg === 'sph') testValley(arg);
if (arg === 'all' || arg === 'swe') testLakeAtRest();
if (arg === 'all' || arg === 'mask') testMask();
if (arg === 'all' || arg === 'perf' || arg === 'sph-perf') testPerf();
console.log('\nOK');
