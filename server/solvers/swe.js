'use strict';
// 2D depth-averaged shallow-water solver (grid model).
// First-order Godunov finite volumes on a Cartesian grid, HLL Riemann solver with upwinded
// tangential momentum, hydrostatic reconstruction (Audusse et al. 2004) for well-balanced
// wet/dry fronts over DEM terrain, semi-implicit Manning friction, adaptive CFL time step.
// Internal y axis follows row index (south-positive); only speed magnitudes are exported.

const { G, prepare, newRasters, progressReporter } = require('./common');

const DRY = 1e-3;     // m, velocity zeroed below this depth
const HTRACK = 1e-6;  // m, depth that keeps a cell inside the active bounding box
const VCAP = 25;      // m/s, safety cap on depth-averaged speed
const DT_CAP = 30;    // s
const VMIN_DEPTH = 0.01; // m, minimum depth for vmax statistics

// HLL flux across a face. Normal velocity u, tangential v. Writes [mass, normal mom, tangential mom].
function hll(hL, uL, vL, hR, uR, vR, out) {
  const cL = Math.sqrt(G * hL), cR = Math.sqrt(G * hR);
  let sL, sR;
  if (hL <= 0) { sL = uR - 2 * cR; sR = uR + cR; }
  else if (hR <= 0) { sL = uL - cL; sR = uL + 2 * cL; }
  else {
    const us = 0.5 * (uL + uR) + cL - cR;
    const cs = 0.5 * (cL + cR) + 0.25 * (uL - uR);
    sL = Math.min(uL - cL, us - cs);
    sR = Math.max(uR + cR, us + cs);
  }
  const qL = hL * uL, qR = hR * uR;
  const fL = qL * uL + 0.5 * G * hL * hL, fR = qR * uR + 0.5 * G * hR * hR;
  let f0, f1;
  if (sL >= 0) { f0 = qL; f1 = fL; }
  else if (sR <= 0) { f0 = qR; f1 = fR; }
  else {
    const inv = 1 / (sR - sL);
    f0 = (sR * qL - sL * qR + sL * sR * (hR - hL)) * inv;
    f1 = (sR * fL - sL * fR + sL * sR * (qR - qL)) * inv;
  }
  out[0] = f0; out[1] = f1; out[2] = f0 > 0 ? f0 * vL : f0 * vR;
}

function run(input, onProgress) {
  const T0 = Date.now();
  const P = prepare(input);
  const { rows, cols, dx, dy, N, z, act, gn2, sources, duration, frameInterval, wet, block } = P;
  const A = dx * dy;
  const cfl = input.cfl > 0 ? Math.min(+input.cfl, 0.9) : 0.45;
  const minD = Math.min(dx, dy);
  const idx = 1 / dx, idy = 1 / dy, halfG = 0.5 * G;

  const h = new Float64Array(N), qx = new Float64Array(N), qy = new Float64Array(N);
  const u = new Float64Array(N), v = new Float64Array(N);
  const dh = new Float64Array(N), dqx = new Float64Array(N), dqy = new Float64Array(N);
  const R = newRasters(N);
  const { dmax, vmax, arr, tblk, dur } = R;
  const frames = [];
  const out = new Float64Array(3);
  const report = progressReporter(onProgress, 'SWE');

  // Initial state and wet bounding box
  let wr0 = rows, wr1 = -1, wc0 = cols, wc1 = -1;
  let V0 = 0;
  for (let i = 0; i < N; i++) {
    const d = P.h0[i];
    if (d <= 0) continue;
    h[i] = d; V0 += d * A;
    dmax[i] = d;
    if (d >= wet) arr[i] = 0;
    if (d >= block) tblk[i] = 0;
    const r = (i / cols) | 0, c = i - r * cols;
    if (r < wr0) wr0 = r; if (r > wr1) wr1 = r; if (c < wc0) wc0 = c; if (c > wc1) wc1 = c;
  }
  // Source cells always stay in the computational window
  let sr0 = rows, sr1 = -1, sc0 = cols, sc1 = -1;
  for (const s of sources) for (const i of s.cells) {
    const r = (i / cols) | 0, c = i - r * cols;
    if (r < sr0) sr0 = r; if (r > sr1) sr1 = r; if (c < sc0) sc0 = c; if (c > sc1) sc1 = c;
  }
  const srcCum = new Float64Array(sources.length);

  let t = 0, steps = 0, dtMin = Infinity, dtMax = 0;
  let vIn = 0, vOut = 0, vNeg = 0;
  const edgeOut = new Float64Array(4); // north, south, east, west
  let nextFrame = frameInterval;
  frames.push({ t: 0, h: Float32Array.from(h) });
  report(0);

  while (t < duration - 1e-6) {
    // Computational window = wet box (+ sources) grown by one cell
    let r0 = Math.min(wr0, sr0) - 1, r1 = Math.max(wr1, sr1) + 1;
    let c0 = Math.min(wc0, sc0) - 1, c1 = Math.max(wc1, sc1) + 1;
    if (r0 < 0) r0 = 0; if (c0 < 0) c0 = 0;
    if (r1 > rows - 1) r1 = rows - 1; if (c1 > cols - 1) c1 = cols - 1;

    // 1) velocities, max wave speed, reset accumulators
    let smax = 0;
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let i = base + c0, e = base + c1; i <= e; i++) {
        if (!act[i]) continue;
        dh[i] = 0; dqx[i] = 0; dqy[i] = 0;
        const hi = h[i];
        if (hi > DRY) {
          let ui = qx[i] / hi, vi = qy[i] / hi;
          const sp2 = ui * ui + vi * vi;
          if (sp2 > VCAP * VCAP) {
            const f = VCAP / Math.sqrt(sp2);
            ui *= f; vi *= f; qx[i] = ui * hi; qy[i] = vi * hi;
          }
          u[i] = ui; v[i] = vi;
          const s = (ui > 0 ? ui : -ui) + (vi > 0 ? vi : -vi) + Math.sqrt(G * hi);
          if (s > smax) smax = s;
        } else {
          u[i] = 0; v[i] = 0; qx[i] = 0; qy[i] = 0;
          if (hi > 0) { const s = Math.sqrt(G * hi); if (s > smax) smax = s; }
        }
      }
    }
    // |u|+|v|+c bounds the 2D unsplit Courant sum (per-axis speeds <= this)
    let dt = smax > 0 ? cfl * minD / smax : DT_CAP;
    if (dt > DT_CAP) dt = DT_CAP;
    const dtFree = dt;
    let hitFrame = false;
    if (t + dt >= nextFrame - 1e-6 && nextFrame <= duration + 1e-6) { dt = nextFrame - t; hitFrame = true; }
    if (t + dt > duration) dt = duration - t;
    if (dt <= 0) break;

    // 2) x-faces (between columns c-1 and c)
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let c = c0; c <= c1 + 1; c++) {
        if (c === 0) { // west open boundary
          const i = base;
          if (!act[i] || h[i] <= 0) continue;
          const hi = h[i], un = u[i] < 0 ? u[i] : 0;
          const f0 = hi * un;
          dh[i] += f0 * idx;
          dqx[i] += (f0 * un + halfG * hi * hi) * idx;
          dqy[i] += f0 * v[i] * idx;
          edgeOut[3] -= f0 * dy * dt;
          continue;
        }
        if (c === cols) { // east open boundary
          const i = base + cols - 1;
          if (!act[i] || h[i] <= 0) continue;
          const hi = h[i], un = u[i] > 0 ? u[i] : 0;
          const f0 = hi * un;
          dh[i] -= f0 * idx;
          dqx[i] -= (f0 * un + halfG * hi * hi) * idx;
          dqy[i] -= f0 * v[i] * idx;
          edgeOut[2] += f0 * dy * dt;
          continue;
        }
        if (c === c0 || c === c1 + 1) continue; // face leads outside the window
        const iL = base + c - 1, iR = iL + 1;
        const aL = act[iL], aR = act[iR];
        const hL = h[iL], hR = h[iR];
        if (aL && aR) {
          if (hL <= 0 && hR <= 0) continue;
          const zL = z[iL], zR = z[iR], zf = zL > zR ? zL : zR;
          let hLs = hL + zL - zf; if (hLs < 0) hLs = 0;
          let hRs = hR + zR - zf; if (hRs < 0) hRs = 0;
          if (hLs > 0 || hRs > 0) {
            hll(hLs, u[iL], v[iL], hRs, u[iR], v[iR], out);
          } else { out[0] = 0; out[1] = 0; out[2] = 0; }
          const f0 = out[0] * idx, f1 = out[1] * idx, f2 = out[2] * idx;
          dh[iL] -= f0; dh[iR] += f0;
          dqx[iL] -= f1 + halfG * (hL * hL - hLs * hLs) * idx;
          dqx[iR] += f1 + halfG * (hR * hR - hRs * hRs) * idx;
          dqy[iL] -= f2; dqy[iR] += f2;
        } else if (aL) { // reflective wall east of L
          if (hL <= 0) continue;
          hll(hL, u[iL], v[iL], hL, -u[iL], v[iL], out);
          dqx[iL] -= out[1] * idx;
        } else if (aR) { // reflective wall west of R
          if (hR <= 0) continue;
          hll(hR, -u[iR], v[iR], hR, u[iR], v[iR], out);
          dqx[iR] += out[1] * idx;
        }
      }
    }

    // 3) y-faces (between rows r-1 [north] and r [south]); normal = qy, tangential = qx
    for (let r = r0; r <= r1 + 1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r === 0) { // north open boundary
          const i = c;
          if (!act[i] || h[i] <= 0) continue;
          const hi = h[i], un = v[i] < 0 ? v[i] : 0;
          const f0 = hi * un;
          dh[i] += f0 * idy;
          dqy[i] += (f0 * un + halfG * hi * hi) * idy;
          dqx[i] += f0 * u[i] * idy;
          edgeOut[0] -= f0 * dx * dt;
          continue;
        }
        if (r === rows) { // south open boundary
          const i = (rows - 1) * cols + c;
          if (!act[i] || h[i] <= 0) continue;
          const hi = h[i], un = v[i] > 0 ? v[i] : 0;
          const f0 = hi * un;
          dh[i] -= f0 * idy;
          dqy[i] -= (f0 * un + halfG * hi * hi) * idy;
          dqx[i] -= f0 * u[i] * idy;
          edgeOut[1] += f0 * dx * dt;
          continue;
        }
        if (r === r0 || r === r1 + 1) continue;
        const iL = (r - 1) * cols + c, iR = iL + cols;
        const aL = act[iL], aR = act[iR];
        const hL = h[iL], hR = h[iR];
        if (aL && aR) {
          if (hL <= 0 && hR <= 0) continue;
          const zL = z[iL], zR = z[iR], zf = zL > zR ? zL : zR;
          let hLs = hL + zL - zf; if (hLs < 0) hLs = 0;
          let hRs = hR + zR - zf; if (hRs < 0) hRs = 0;
          if (hLs > 0 || hRs > 0) {
            hll(hLs, v[iL], u[iL], hRs, v[iR], u[iR], out);
          } else { out[0] = 0; out[1] = 0; out[2] = 0; }
          const f0 = out[0] * idy, f1 = out[1] * idy, f2 = out[2] * idy;
          dh[iL] -= f0; dh[iR] += f0;
          dqy[iL] -= f1 + halfG * (hL * hL - hLs * hLs) * idy;
          dqy[iR] += f1 + halfG * (hR * hR - hRs * hRs) * idy;
          dqx[iL] -= f2; dqx[iR] += f2;
        } else if (aL) {
          if (hL <= 0) continue;
          hll(hL, v[iL], u[iL], hL, -v[iL], u[iL], out);
          dqy[iL] -= out[1] * idy;
        } else if (aR) {
          if (hR <= 0) continue;
          hll(hR, -v[iR], u[iR], hR, v[iR], u[iR], out);
          dqy[iR] += out[1] * idy;
        }
      }
    }

    // 4) inflow sources (exact hydrograph integral over [t, t+dt])
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      const cumNew = s.hyd.cum(t + dt);
      const vol = cumNew - srcCum[k];
      srcCum[k] = cumNew;
      if (!(vol > 0)) continue;
      vIn += vol;
      const rate = vol / (s.cells.length * A * dt); // m/s depth rate per cell
      const mx = rate * s.speed * s.ex, my = rate * s.speed * s.ey;
      for (let j = 0; j < s.cells.length; j++) {
        const i = s.cells[j];
        dh[i] += rate; dqx[i] += mx; dqy[i] += my;
      }
    }

    // 5) update, friction, statistics, new wet box
    const tn = hitFrame ? nextFrame : t + dt;
    let nr0 = rows, nr1 = -1, nc0 = cols, nc1 = -1;
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let c = c0; c <= c1; c++) {
        const i = base + c;
        if (!act[i]) continue;
        let hn = h[i] + dt * dh[i];
        if (hn <= 0) {
          if (hn < 0) vNeg -= hn * A;
          h[i] = 0; qx[i] = 0; qy[i] = 0;
          continue;
        }
        let qxn = qx[i] + dt * dqx[i], qyn = qy[i] + dt * dqy[i];
        let sp = 0;
        if (hn > DRY) {
          sp = Math.sqrt(qxn * qxn + qyn * qyn) / hn;
          const f = 1 / (1 + dt * gn2[i] * sp / (hn * Math.cbrt(hn)));
          qxn *= f; qyn *= f; sp *= f;
        } else { qxn = 0; qyn = 0; }
        h[i] = hn; qx[i] = qxn; qy[i] = qyn;
        if (hn > HTRACK) {
          if (r < nr0) nr0 = r; if (r > nr1) nr1 = r;
          if (c < nc0) nc0 = c; if (c > nc1) nc1 = c;
        }
        if (hn > dmax[i]) dmax[i] = hn;
        if (hn >= VMIN_DEPTH && sp > vmax[i]) vmax[i] = sp;
        if (hn >= wet) {
          dur[i] += dt;
          if (arr[i] < 0) arr[i] = tn;
          if (hn >= block && tblk[i] < 0) tblk[i] = tn;
        }
      }
    }
    wr0 = nr0; wr1 = nr1; wc0 = nc0; wc1 = nc1;

    t = tn; steps++;
    if (dtFree < dtMin) dtMin = dtFree;
    if (dt > dtMax) dtMax = dt;
    if (hitFrame) {
      frames.push({ t: nextFrame, h: Float32Array.from(h) });
      nextFrame += frameInterval;
    }
    report(duration > 0 ? t / duration : 1, 't=' + Math.round(t) + 's');
  }

  vOut = edgeOut[0] + edgeOut[1] + edgeOut[2] + edgeOut[3];
  let vFinal = 0;
  for (let i = 0; i < N; i++) vFinal += h[i];
  vFinal *= A;
  const ref = Math.max(V0 + vIn, 1e-9);
  const massErrorPct = 100 * (vFinal - (V0 + vIn - vOut)) / ref;
  report(1);
  return {
    dmax, vmax, arr, tblk, dur, frames,
    stats: {
      engine: 'swe-fv-hll', scheme: 'Godunov FV, HLL + hydrostatic reconstruction, semi-implicit Manning',
      steps, runtimeMs: Date.now() - T0, simTime: t,
      volumeInitial: V0, volumeIn: vIn, volumeOut: vOut, volumeFinal: vFinal,
      volumeOutEdges: { north: edgeOut[0], south: edgeOut[1], east: edgeOut[2], west: edgeOut[3] },
      volumeClipped: vNeg, massErrorPct,
      dtMin: steps ? dtMin : 0, dtMax, cfl, dryThreshold: DRY,
    },
  };
}

module.exports = { run };
