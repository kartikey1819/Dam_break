'use strict';
// Depth-integrated SPH shallow-water solver (SPH-SWE, after Vacondio et al. / Ata & Soulaimani).
// Particles carry water volume V_j; depth is the kernel sum h_i = sum_j V_j W(r_ij, l).
// Momentum (variational form for fixed l, pairwise antisymmetric => conserves momentum):
//   dv_i/dt = -sum_j V_j (g + Pi_ij) grad_i W_ij - g grad z(x_i) - g n^2 |v| v / h^(4/3)
// with Monaghan artificial viscosity Pi_ij. Wendland C2 kernel (support 2l), cell-linked list,
// symplectic Euler with semi-implicit friction, CFL + force time step, optional XSPH.
// Internal y axis is south-positive (row index); only speed magnitudes are exported.

const { G, prepare, newRasters, progressReporter, rng } = require('./common');

const VCAP = 25;          // m/s safety cap
const DT_CAP = 30;        // s
const HFRIC_MIN = 0.01;   // m, depth floor in the friction term
const VMIN_DEPTH = 0.01;  // m, minimum raster depth for vmax statistics

// Wendland C2 kernel tabulated against s = r^2/R^2 (avoids a sqrt per pair); linear interpolation.
const TABN = 4096;
function kernelTables(ell) {
  const aD = 7 / (4 * Math.PI * ell * ell), gradC = -5 * aD / (ell * ell);
  const TW = new Float64Array(TABN + 2), TF = new Float64Array(TABN + 2);
  for (let k = 0; k <= TABN + 1; k++) {
    const q = 2 * Math.sqrt(Math.min(1, k / TABN)), a = 1 - 0.5 * q;
    TW[k] = aD * a * a * a * a * (2 * q + 1);
    TF[k] = gradC * a * a * a;
  }
  const DW = new Float64Array(TABN + 1), DF = new Float64Array(TABN + 1);
  for (let k = 0; k <= TABN; k++) { DW[k] = TW[k + 1] - TW[k]; DF[k] = TF[k + 1] - TF[k]; }
  return { TW, DW, TF, DF };
}

// Counting sort of particles into search cells; keeps neighbours contiguous in memory.
function sortParticles(S) {
  const n = S.n, cs = S.cs, ncx = S.ncx, ncy = S.ncy, nCells = S.nCells;
  const px = S.px, py = S.py, vx = S.vx, vy = S.vy, pv = S.pv, ph = S.ph;
  const tx = S.tx, ty = S.ty, tvx = S.tvx, tvy = S.tvy, tpv = S.tpv, tph = S.hn;
  const cellStart = S.cellStart, fillPtr = S.fillPtr, cellOf = S.cellOf;
  cellStart.fill(0);
  for (let i = 0; i < n; i++) {
    let cx = (px[i] / cs) | 0, cy = (py[i] / cs) | 0;
    if (cx >= ncx) cx = ncx - 1;
    if (cy >= ncy) cy = ncy - 1;
    const k = cy * ncx + cx;
    cellOf[i] = k; cellStart[k + 1]++;
  }
  for (let k = 0; k < nCells; k++) { cellStart[k + 1] += cellStart[k]; fillPtr[k] = cellStart[k]; }
  for (let i = 0; i < n; i++) {
    const d = fillPtr[cellOf[i]]++;
    tx[d] = px[i]; ty[d] = py[i]; tvx[d] = vx[i]; tvy[d] = vy[i]; tpv[d] = pv[i]; tph[d] = ph[i];
  }
  S.px = tx; S.tx = px; S.py = ty; S.ty = py; S.vx = tvx; S.tvx = vx;
  S.vy = tvy; S.tvy = vy; S.pv = tpv; S.tpv = pv; S.ph = tph; S.hn = ph;
}

// Single fused pass over all pairs (each pair once): new depth h_i = sum_j V_j W_ij, pressure
// force -g V_j grad W_ij and Monaghan viscosity (+XSPH). The viscosity uses the previous-step
// depth/celerity, so no second neighbour pass is needed. Returns the number of pairs.
function pairPass(S) {
  const n = S.n, ncx = S.ncx, ncy = S.ncy, R2 = S.R2, aD = S.aD;
  const TW = S.TW, DW = S.DW, TF = S.TF, DF = S.DF, tScale = TABN / R2;
  const aell = S.alpha * S.ell, avEps = 0.01 * S.ell * S.ell, eps = S.eps;
  const px = S.px, py = S.py, vx = S.vx, vy = S.vy, pv = S.pv, ph = S.ph, pc = S.pc, hn = S.hn;
  const ax = S.ax, ay = S.ay, xs = S.xs, ys = S.ys, cellStart = S.cellStart;
  const OX = S.stX, OY = S.stY, nst = OX.length;
  for (let i = 0; i < n; i++) {
    pc[i] = Math.sqrt(G * ph[i]); hn[i] = pv[i] * aD;
    ax[i] = 0; ay[i] = 0; xs[i] = 0; ys[i] = 0;
  }
  let pairs = 0;
  for (let cy = 0; cy < ncy; cy++) for (let cx = 0; cx < ncx; cx++) {
    const k = cy * ncx + cx, s = cellStart[k], e = cellStart[k + 1];
    for (let i = s; i < e; i++) {
      const xi = px[i], yi = py[i], Vi = pv[i], hi = ph[i], ci = pc[i], ui = vx[i], wi = vy[i];
      let hsum = 0, axi = 0, ayi = 0, xsi = 0, ysi = 0;
      for (let m = 0; m < nst; m++) {
        let js, je;
        if (m === 0) { js = i + 1; je = e; }
        else {
          const nx = cx + OX[m], ny = cy + OY[m];
          if (nx < 0 || nx >= ncx || ny >= ncy) continue;
          const k2 = ny * ncx + nx;
          js = cellStart[k2]; je = cellStart[k2 + 1];
        }
        for (let j = js; j < je; j++) {
          const rx = xi - px[j], ry = yi - py[j], r2 = rx * rx + ry * ry;
          if (r2 >= R2) continue;
          const tx = r2 * tScale, t0 = tx | 0, tf = tx - t0;
          const w = TW[t0] + tf * DW[t0];
          const Vj = pv[j];
          hsum += Vj * w; hn[j] += Vi * w;
          if (r2 < 1e-12) continue;
          pairs++;
          const F = TF[t0] + tf * DF[t0]; // grad_i W_ij = F (x_i - x_j), F < 0
          const dvx = ui - vx[j], dvy = wi - vy[j], vr = dvx * rx + dvy * ry;
          let pij = G;
          if (vr < 0) pij -= aell * vr * (ci + pc[j]) / ((r2 + avEps) * (hi + ph[j])); // -alpha cbar mu / hbar
          const fx = pij * F * rx, fy = pij * F * ry;
          axi -= Vj * fx; ayi -= Vj * fy;
          ax[j] += Vi * fx; ay[j] += Vi * fy;
          if (eps > 0) {
            const wx = 2 * w / (hi + ph[j]);
            xsi -= Vj * wx * dvx; ysi -= Vj * wx * dvy;
            xs[j] += Vi * wx * dvx; ys[j] += Vi * wx * dvy;
          }
        }
      }
      hn[i] += hsum; ax[i] += axi; ay[i] += ayi; xs[i] += xsi; ys[i] += ysi;
    }
  }
  S.ph = hn; S.hn = ph; // new depth becomes current
  return pairs;
}

// Bed-slope acceleration (bilinear DEM gradient). Returns [max |v|+c, max |a|] via S.
function bedPass(S) {
  const n = S.n, rows = S.rows, cols = S.cols, dx = S.dx, dy = S.dy, zb = S.zb;
  const px = S.px, py = S.py, vx = S.vx, vy = S.vy, ph = S.ph, ax = S.ax, ay = S.ay;
  let smax = 0, amax2 = 0;
  for (let i = 0; i < n; i++) {
    const fx = px[i] / dx - 0.5, fy = py[i] / dy - 0.5;
    let c0 = Math.floor(fx), r0 = Math.floor(fy);
    if (c0 < 0) c0 = 0; else if (c0 > cols - 2) c0 = cols - 2;
    if (r0 < 0) r0 = 0; else if (r0 > rows - 2) r0 = rows - 2;
    let wx = fx - c0, wy = fy - r0;
    if (wx < 0) wx = 0; else if (wx > 1) wx = 1;
    if (wy < 0) wy = 0; else if (wy > 1) wy = 1;
    const b = r0 * cols + c0;
    const z00 = zb[b], z01 = zb[b + 1], z10 = zb[b + cols], z11 = zb[b + cols + 1];
    const axi = ax[i] - G * ((1 - wy) * (z01 - z00) + wy * (z11 - z10)) / dx;
    const ayi = ay[i] - G * ((1 - wx) * (z10 - z00) + wx * (z11 - z01)) / dy;
    ax[i] = axi; ay[i] = ayi;
    const s = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + Math.sqrt(G * ph[i]);
    if (s > smax) smax = s;
    const a2 = axi * axi + ayi * ayi;
    if (a2 > amax2) amax2 = a2;
  }
  S.smax = smax; S.amax = Math.sqrt(amax2);
}

// Kick (semi-implicit Manning), drift, removal at grid edges, reflection at inactive cells.
function integrate(S, dt) {
  const n = S.n, rows = S.rows, cols = S.cols, dx = S.dx, dy = S.dy, W = S.W, H = S.H;
  const act = S.act, gn2 = S.gn2, eps = S.eps;
  const px = S.px, py = S.py, vx = S.vx, vy = S.vy, pv = S.pv, ph = S.ph;
  const ax = S.ax, ay = S.ay, xs = S.xs, ys = S.ys;
  let w = 0, out = 0, refl = 0;
  for (let i = 0; i < n; i++) {
    let ui = vx[i] + dt * ax[i], wi = vy[i] + dt * ay[i];
    let c = (px[i] / dx) | 0, r = (py[i] / dy) | 0;
    if (c > cols - 1) c = cols - 1;
    if (r > rows - 1) r = rows - 1;
    let sp = Math.sqrt(ui * ui + wi * wi);
    const hf = ph[i] > HFRIC_MIN ? ph[i] : HFRIC_MIN;
    const f = 1 / (1 + dt * gn2[r * cols + c] * sp / (hf * Math.cbrt(hf)));
    ui *= f; wi *= f; sp *= f;
    if (sp > VCAP) { const k = VCAP / sp; ui *= k; wi *= k; }
    let xn = px[i] + dt * (ui + eps * xs[i]), yn = py[i] + dt * (wi + eps * ys[i]);
    if (!(xn >= 0 && xn < W && yn >= 0 && yn < H)) { // left the grid: north, south, east, west
      S.edgeOut[yn < 0 ? 0 : yn >= H ? 1 : xn >= W ? 2 : 3] += pv[i];
      out += pv[i];
      continue;
    }
    if (!act[((yn / dy) | 0) * cols + ((xn / dx) | 0)]) { // wall: revert, reverse
      xn = px[i]; yn = py[i]; ui = -ui; wi = -wi; refl++;
    }
    px[w] = xn; py[w] = yn; vx[w] = ui; vy[w] = wi; pv[w] = pv[i]; ph[w] = ph[i];
    w++;
  }
  S.n = w;
  S.vOut += out;
  S.reflections += refl;
}

// Kernel-sum depth and kernel-weighted velocity at grid cell centres.
function rasterize(S) {
  const n = S.n, rows = S.rows, cols = S.cols, dx = S.dx, dy = S.dy, N = S.N;
  const Rk = S.Rk, R2 = S.R2, act = S.act, TW = S.TW, DW = S.DW, tScale = TABN / R2;
  const px = S.px, py = S.py, vx = S.vx, vy = S.vy, pv = S.pv;
  const gh = S.gh, gvx = S.gvx, gvy = S.gvy;
  gh.fill(0); gvx.fill(0); gvy.fill(0);
  for (let i = 0; i < n; i++) {
    const x = px[i], y = py[i], V = pv[i], ux = vx[i], uy = vy[i];
    let ca = Math.ceil((x - Rk) / dx - 0.5), cb = Math.floor((x + Rk) / dx - 0.5);
    let ra = Math.ceil((y - Rk) / dy - 0.5), rb = Math.floor((y + Rk) / dy - 0.5);
    if (ca < 0) ca = 0;
    if (cb > cols - 1) cb = cols - 1;
    if (ra < 0) ra = 0;
    if (rb > rows - 1) rb = rows - 1;
    for (let r = ra; r <= rb; r++) {
      const ry = (r + 0.5) * dy - y, ry2 = ry * ry;
      const base = r * cols;
      for (let c = ca; c <= cb; c++) {
        const rx = (c + 0.5) * dx - x, r2 = rx * rx + ry2;
        if (r2 >= R2) continue;
        const tx = r2 * tScale, t0 = tx | 0;
        const w = V * (TW[t0] + (tx - t0) * DW[t0]);
        const k = base + c;
        gh[k] += w; gvx[k] += w * ux; gvy[k] += w * uy;
      }
    }
  }
  for (let k = 0; k < N; k++) if (!act[k]) gh[k] = 0;
}

function updateRasters(S, R, t) {
  const N = S.N, gh = S.gh, gvx = S.gvx, gvy = S.gvy, wet = S.wet, block = S.block;
  const dmax = R.dmax, vmax = R.vmax, arr = R.arr, tblk = R.tblk, dur = R.dur;
  const dtR = t - S.tLastRaster;
  S.tLastRaster = t;
  for (let k = 0; k < N; k++) {
    const d = gh[k];
    if (d <= 0) continue;
    if (d > dmax[k]) dmax[k] = d;
    if (d >= VMIN_DEPTH) {
      const sp = Math.sqrt(gvx[k] * gvx[k] + gvy[k] * gvy[k]) / d;
      if (sp > vmax[k]) vmax[k] = sp;
    }
    if (d >= wet) {
      dur[k] += dtR;
      if (arr[k] < 0) arr[k] = t;
      if (d >= block && tblk[k] < 0) tblk[k] = t;
    }
  }
}

function run(input, onProgress) {
  const T0 = Date.now();
  const P = prepare(input);
  const { rows, cols, dx, dy, N, act, sources, duration, frameInterval } = P;
  const opt = input.sph || {};
  const pick = (k, def) => (opt[k] > 0 ? +opt[k] : (input[k] > 0 ? +input[k] : def));
  const maxParticles = pick('maxParticles', 15000) | 0;
  const hFactor = pick('hFactor', 1.0);
  const cfl = opt.cfl > 0 ? +opt.cfl : 0.5;
  const rasterInterval = pick('rasterInterval', 30);
  const rand = rng(opt.seed || 12345);
  const A = dx * dy;
  const report = progressReporter(onProgress, 'SPH');

  // Bed for gradients: inactive cells take the mean of active neighbours (no pull into walls)
  const zb = Float64Array.from(P.z);
  for (let i = 0; i < N; i++) {
    if (act[i]) continue;
    const r = (i / cols) | 0, c = i - r * cols;
    let s = 0, m = 0;
    if (c > 0 && act[i - 1]) { s += P.z[i - 1]; m++; }
    if (c < cols - 1 && act[i + 1]) { s += P.z[i + 1]; m++; }
    if (r > 0 && act[i - cols]) { s += P.z[i - cols]; m++; }
    if (r < rows - 1 && act[i + cols]) { s += P.z[i + cols]; m++; }
    if (m) zb[i] = s / m;
  }

  // Particle volume and kernel
  let vHyd = 0, vInit = 0;
  for (const s of sources) vHyd += Math.max(0, s.hyd.cum(duration));
  for (let i = 0; i < N; i++) vInit += P.h0[i] * A;
  const Vp = Math.max(500, (vHyd + vInit) / Math.max(1, maxParticles));
  const ell = hFactor * Math.max(dx, dy);
  let nInit = 0;
  for (let i = 0; i < N; i++) if (P.h0[i] > 0) nInit += Math.max(1, Math.round(P.h0[i] * A / Vp));
  const cap = nInit + Math.ceil(vHyd / Vp) + 64;
  const Rk = 2 * ell;
  // Search cells of size Rk/SUB with a half stencil of (2*SUB+1)^2 cells (fewer distance tests)
  const SUB = opt.searchSub > 0 ? opt.searchSub | 0 : 2, cs = Rk / SUB;
  const ncx = Math.max(1, Math.ceil(cols * dx / cs)), ncy = Math.max(1, Math.ceil(rows * dy / cs));
  const stX = [0], stY = [0];
  for (let ox = 1; ox <= SUB; ox++) { stX.push(ox); stY.push(0); }
  for (let oy = 1; oy <= SUB; oy++) for (let ox = -SUB; ox <= SUB; ox++) { stX.push(ox); stY.push(oy); }
  const F64 = () => new Float64Array(cap);

  const S = {
    rows, cols, dx, dy, N, W: cols * dx, H: rows * dy, act, gn2: P.gn2, zb, wet: P.wet, block: P.block,
    ell, Rk, R2: Rk * Rk, aD: 7 / (4 * Math.PI * ell * ell),
    ...kernelTables(ell),
    alpha: opt.alpha >= 0 ? +opt.alpha : 0.5, eps: opt.xsph > 0 ? +opt.xsph : 0,
    n: 0, px: F64(), py: F64(), vx: F64(), vy: F64(), pv: F64(),
    tx: F64(), ty: F64(), tvx: F64(), tvy: F64(), tpv: F64(),
    ph: F64(), hn: F64(), pc: F64(), ax: F64(), ay: F64(), xs: F64(), ys: F64(), cellOf: new Int32Array(cap),
    cs, stX: Int32Array.from(stX), stY: Int32Array.from(stY),
    ncx, ncy, nCells: ncx * ncy, cellStart: new Int32Array(ncx * ncy + 1), fillPtr: new Int32Array(ncx * ncy),
    gh: new Float64Array(N), gvx: new Float64Array(N), gvy: new Float64Array(N),
    smax: 0, amax: 0, vOut: 0, edgeOut: new Float64Array(4), reflections: 0, tLastRaster: 0,
  };

  // Initial particles from initialDepth (cell volume split evenly)
  let V0 = 0;
  for (let i = 0; i < N; i++) {
    const d = P.h0[i];
    if (!(d > 0)) continue;
    const m = Math.max(1, Math.round(d * A / Vp)), vol = d * A / m;
    const r = (i / cols) | 0, c = i - r * cols;
    for (let k = 0; k < m; k++) {
      const j = S.n++;
      S.px[j] = (c + 0.05 + 0.9 * rand()) * dx; S.py[j] = (r + 0.05 + 0.9 * rand()) * dy;
      S.pv[j] = vol; S.ph[j] = vol * S.aD; V0 += vol;
    }
  }

  const R = newRasters(N);
  const frames = [];
  rasterize(S); updateRasters(S, R, 0);
  frames.push({ t: 0, h: Float32Array.from(S.gh) });
  report(0);

  const srcCum = new Float64Array(sources.length), srcAcc = new Float64Array(sources.length);
  const srcCtr = new Int32Array(sources.length);
  let t = 0, steps = 0, dtMin = Infinity, dtMax = 0, vIn = 0, peak = S.n, pairSum = 0, nSum = 0;
  let nextFrame = frameInterval, nextRaster = rasterInterval;

  while (t < duration - 1e-6) {
    let dt = DT_CAP;
    if (S.n > 0) {
      sortParticles(S);
      pairSum += pairPass(S);
      nSum += S.n;
      bedPass(S);
      if (S.smax > 0) dt = Math.min(dt, cfl * ell / S.smax);
      if (S.amax > 0) dt = Math.min(dt, 0.25 * Math.sqrt(ell / S.amax));
    }
    const dtFree = dt;
    let hitFrame = false;
    if (t + dt >= nextFrame - 1e-6 && nextFrame <= duration + 1e-6) { dt = nextFrame - t; hitFrame = true; }
    if (t + dt > duration) dt = duration - t;
    if (dt <= 0) break;
    if (S.n > 0) integrate(S, dt);

    // Inject particles following the hydrographs (round-robin over source cells, small jitter)
    const tn = hitFrame ? nextFrame : t + dt;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      const cumNew = s.hyd.cum(tn);
      const vol = cumNew - srcCum[k];
      srcCum[k] = cumNew;
      if (!(vol > 0)) continue;
      vIn += vol; srcAcc[k] += vol;
      const nc = s.cells.length;
      while (srcAcc[k] >= Vp && S.n < cap) {
        srcAcc[k] -= Vp;
        const ci = s.cells[srcCtr[k]++ % nc];
        const r = (ci / cols) | 0, c = ci - r * cols;
        const j = S.n++;
        S.px[j] = (c + 0.5 + 0.6 * (rand() - 0.5)) * dx;
        S.py[j] = (r + 0.5 + 0.6 * (rand() - 0.5)) * dy;
        S.vx[j] = s.speed * s.ex; S.vy[j] = s.speed * s.ey;
        S.pv[j] = Vp; S.ph[j] = Vp * S.aD;
      }
    }
    if (S.n > peak) peak = S.n;

    t = tn; steps++;
    if (dtFree < dtMin) dtMin = dtFree;
    if (dt > dtMax) dtMax = dt;
    if (hitFrame || t >= nextRaster || t >= duration - 1e-6) {
      rasterize(S); updateRasters(S, R, t);
      nextRaster = t + rasterInterval;
    }
    if (hitFrame) {
      frames.push({ t: nextFrame, h: Float32Array.from(S.gh) });
      nextFrame += frameInterval;
    }
    report(duration > 0 ? t / duration : 1, 't=' + Math.round(t) + 's n=' + S.n);
  }
  if (S.tLastRaster < t) { rasterize(S); updateRasters(S, R, t); }

  let vFinal = 0, pending = 0, vRaster = 0;
  for (let i = 0; i < S.n; i++) vFinal += S.pv[i];
  for (let k = 0; k < sources.length; k++) pending += srcAcc[k];
  for (let k = 0; k < N; k++) vRaster += S.gh[k];
  vRaster *= A;
  const ref = Math.max(V0 + vIn, 1e-9);
  report(1);
  return {
    dmax: R.dmax, vmax: R.vmax, arr: R.arr, tblk: R.tblk, dur: R.dur, frames,
    stats: {
      engine: 'sph-swe', scheme: 'SPH-SWE, Wendland C2, variational pressure force, Monaghan AV, semi-implicit Manning',
      steps, runtimeMs: Date.now() - T0, simTime: t,
      volumeInitial: V0, volumeIn: vIn, volumeOut: S.vOut, volumeFinal: vFinal, volumePending: pending,
      volumeOutEdges: { north: S.edgeOut[0], south: S.edgeOut[1], east: S.edgeOut[2], west: S.edgeOut[3] },
      massErrorPct: 100 * (vFinal + pending - (V0 + vIn - S.vOut)) / ref,
      volumeRaster: vRaster,
      rasterVolumeErrorPct: vFinal > 0 ? 100 * (vRaster - vFinal) / vFinal : 0,
      dtMin: steps ? dtMin : 0, dtMax,
      particles: peak, particlesFinal: S.n, particleVolume: Vp, smoothingLength: ell, kernelSupport: Rk,
      meanNeighbours: nSum ? 2 * pairSum / nSum : 0,
      wallReflections: S.reflections, rasterInterval,
    },
  };
}

module.exports = { run };
