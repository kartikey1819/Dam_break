'use strict';
/* Delft3D-FLOW (Delft3D 4, 2DH) input-deck writer + optional runner.
 * Writes a spherical structured grid (.grd/.enc), depth (.dep), breach discharge source (.src/.dis),
 * master definition file (.mdf) and d_hydro config. Execution requires a local Delft3D 4 installation
 * (set DELFT3D_HOME). Result import (NEFIS trim-*.dat) is not implemented in this prototype — the
 * dashboard's "Delft3D-class" results come from the in-house SWE finite-volume solver. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const fmt = (v) => v.toExponential(10).replace(/e([+-])(\d)$/, 'e$10$2');

function gridFile(g) {
  const M = g.cols + 1, N = g.rows + 1, out = ['* Delft3D-FLOW grid written by FloodSim HADR (SIH26161 prototype)', 'Coordinate System = Spherical', 'Missing Value     =   -9.99999000000000024E+02', `${String(M).padStart(8)}${String(N).padStart(8)}`, ' 0 0 0'];
  const block = (fn) => {
    for (let n = 0; n < N; n++) {
      const vals = []; for (let m = 0; m < M; m++) vals.push(fn(m, n));
      for (let k = 0; k < vals.length; k += 5) out.push((k === 0 ? ` ETA=${String(n + 1).padStart(5)}` : '           ') + vals.slice(k, k + 5).map((v) => '   ' + fmt(v)).join(''));
    }
  };
  // n = 1 at the SOUTH edge (Delft3D convention: n increases northwards)
  const south = g.north - g.rows * g.dLat;
  block((m) => g.west + m * g.dLng);
  block((m, n) => south + n * g.dLat);
  return out.join('\n') + '\n';
}

function depthFile(g, z) {
  // depth at grid points (corners), positive downward relative to datum; dummy row/col = -999
  const M = g.cols + 2, N = g.rows + 2, lines = [];
  const zAt = (m, n) => { // corner average of surrounding cells (m,n are 0-based corner indices, n from south)
    let s = 0, k = 0;
    for (const [dm, dn] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const c = m + dm, rS = n + dn; if (c < 0 || c >= g.cols || rS < 0 || rS >= g.rows) continue;
      const r = g.rows - 1 - rS; s += z[r * g.cols + c]; k++;
    }
    return k ? s / k : 0;
  };
  for (let n = 0; n < N; n++) {
    const vals = [];
    for (let m = 0; m < M; m++) vals.push(m >= g.cols + 1 || n >= g.rows + 1 ? -999 : -zAt(m, n));
    for (let k = 0; k < vals.length; k += 12) lines.push(vals.slice(k, k + 12).map((v) => v.toFixed(3).padStart(10)).join(''));
  }
  return lines.join('\n') + '\n';
}

function writeDeck(dir, scn, input) {
  // input: { hydrograph:{t:[s], q:[]}, sourceCell, manning, durationMin }
  fs.mkdirSync(dir, { recursive: true });
  const g = scn.grid, M = g.cols + 1, N = g.rows + 1;
  const sc = input.sourceCell, sm = (sc % g.cols) + 1, sn = g.rows - Math.floor(sc / g.cols);
  const date = new Date().toISOString().slice(0, 10);
  const files = {
    'floodsim.grd': gridFile(g),
    'floodsim.enc': [[1, 1], [M, 1], [M, N], [1, N], [1, 1]].map(([a, b]) => `${String(a).padStart(6)}${String(b).padStart(6)}`).join('\n') + '\n',
    'floodsim.dep': depthFile(g, scn.dem),
    'floodsim.src': `Breach               Y ${String(sm).padStart(5)} ${String(sn).padStart(5)}     1 N\n`,
    'floodsim.dis': [
      "table-name           'Discharge : 1'", "contents             'inst'", "location             'Breach              '", "time-function        'non-equidistant'",
      `reference-time       ${date.replace(/-/g, '')}`, "time-unit            'minutes'", "interpolation        'linear'",
      "parameter            'time                '                     unit '[min]'", "parameter            'flux/discharge rate '                     unit '[m3/s]'",
      `records-in-table     ${input.hydrograph.t.length}`,
      ...input.hydrograph.t.map((t, k) => ` ${fmt(t / 60)}  ${fmt(input.hydrograph.q[k])}`)
    ].join('\n') + '\n',
    'floodsim.mdf': [
      'Ident  = #Delft3D-FLOW 3.59.01.57433#', `Runtxt = #FloodSim HADR dam-break: ${scn.dam.name}#`,
      'Filcco = #floodsim.grd#', 'Fmtcco = #FR#', 'Anglat = ' + ((g.north - (g.rows * g.dLat) / 2)).toFixed(4), 'Grdang = 0.0',
      'Filgrd = #floodsim.enc#', 'Fmtgrd = #FR#', `MNKmax = ${M + 1} ${N + 1} 1`, 'Thick  = 1.0000000e+002',
      'Fildep = #floodsim.dep#', 'Fmtdep = #FR#', `Itdate = #${date}#`, 'Tunit  = #M#', 'Tstart = 0.0', `Tstop  = ${input.durationMin.toFixed(1)}`, 'Dt     = 0.05', 'Tzone  = 0',
      'Sub1   = #    #', 'Sub2   = #   #', 'Wnsvwp = #N#', 'Wndint = #Y#', 'Zeta0  = -9.99e+01', 'Filsrc = #floodsim.src#', 'Fmtsrc = #FR#', 'Fildis = #floodsim.dis#', 'Fmtdis = #FR#',
      'Ag     = 9.81', 'Rhow   = 1000', 'Tempw  = 20', 'Salw   = 0', 'Roumet = #M#', `Ccofu  = ${input.manning}`, `Ccofv  = ${input.manning}`, 'Xlo    = 0', 'Vicouv = 1', 'Dicouv = 1', 'Htur2d = #N#', 'Irov   = 0',
      'Iter   = 2', 'Dryflp = #YES#', 'Dpsopt = #MAX#', 'Dpuopt = #MIN#', 'Dryflc = 0.05', 'Dco    = -999', 'Tlfsmo = 0', 'ThetQH = 0', 'Forfuv = #Y#', 'Forfww = #N#', 'Sigcor = #N#', 'Trasol = #Cyclic-method#', 'Momsol = #Flood#',
      `Flmap  = 0 15 ${input.durationMin}`, `Flhis  = 0 5 ${input.durationMin}`, 'Flpp   = 0 0 0', 'Flrst  = 0', 'Prmap  = 0', 'Prhis  = 0 0 0', 'Online = #N#', 'Waqmod = #N#', 'WaveOL = #N#'
    ].join('\n') + '\n',
    'config_d_hydro.xml': `<?xml version="1.0" encoding="iso-8859-1"?>\n<deltaresHydro xmlns="http://schemas.deltares.nl/deltaresHydro" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.deltares.nl/deltaresHydro http://content.oss.deltares.nl/schemas/d_hydro-1.00.xsd">\n  <documentation>FloodSim HADR dam-break deck</documentation>\n  <control><sequence><start>flow</start></sequence></control>\n  <flow2D name="flow"><library>flow2d3d</library><mdfFile>floodsim.mdf</mdfFile></flow2D>\n</deltaresHydro>\n`,
    'run_delft3d.bat': '@echo off\nrem Requires a Delft3D 4 installation. Set DELFT3D_HOME to the install folder.\ncall "%DELFT3D_HOME%\\x64\\dflow2d3d\\scripts\\run_dflow2d3d.bat" config_d_hydro.xml\n',
    'README.txt': [
      'FloodSim HADR — Delft3D-FLOW 2DH input deck (generated)', '',
      `Dam: ${scn.dam.name}   Grid: ${g.cols} x ${g.rows} cells (spherical, ${g.dLng.toFixed(6)} x ${g.dLat.toFixed(6)} deg)`,
      'Bathymetry: SRTM-derived DEM (AWS Terrain Tiles) — depth = −elevation (m).',
      'Breach inflow: discharge source "Breach" (floodsim.src/.dis) with the scenario breach hydrograph.',
      'Initial water level Zeta0 = −99 m (dry start). Outflow: add open boundaries at the downstream grid edge in RGFGRID/Delft3D-GUI before production runs.', '',
      'To run: install Delft3D 4 (open source, Deltares), set DELFT3D_HOME, run run_delft3d.bat. Results (trim-floodsim.dat) are NEFIS files',
      'readable with QUICKPLOT / Delft3D-MATLAB toolbox. Import back into FloodSim is not implemented in this prototype.'
    ].join('\n') + '\n'
  };
  Object.entries(files).forEach(([n, c]) => fs.writeFileSync(path.join(dir, n), c));
  return Object.keys(files);
}

function status() {
  const home = process.env.DELFT3D_HOME;
  const script = home && path.join(home, 'x64', 'dflow2d3d', 'scripts', 'run_dflow2d3d.bat');
  const available = !!(script && fs.existsSync(script));
  return { available, home: home || null, reason: available ? 'Delft3D 4 found' : 'Delft3D not installed (set DELFT3D_HOME). Input decks are still generated for every run.' };
}

function run(dir) {
  const st = status();
  if (!st.available) return { started: false, reason: st.reason };
  const p = spawn('cmd.exe', ['/c', 'run_delft3d.bat'], { cwd: dir, env: process.env, detached: true, stdio: 'ignore' });
  p.unref();
  return { started: true, pid: p.pid, note: 'Delft3D started in background; NEFIS output import not implemented.' };
}

module.exports = { writeDeck, status, run };
