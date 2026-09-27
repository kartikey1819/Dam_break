'use strict';
// Integration test for server/data/* against the real open-data services.
// Run: node test/data.test.js   (cache: data/cache)

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { decodePNG } = require('../server/data/png');
const dem = require('../server/data/dem');
const hyd = require('../server/data/hydrology');
const osm = require('../server/data/osm');
const dams = require('../server/data/dams');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const TEHRI = { lat: 30.378, lng: 78.480 };
let failures = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok  ${name} (${Date.now() - t0} ms)\n`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${e.stack || e}\n`);
  }
}

const stats = arr => {
  let mn = Infinity, mx = -Infinity, s = 0, n = 0;
  for (const v of arr) { if (Number.isNaN(v)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; n++; }
  return { min: +mn.toFixed(1), max: +mx.toFixed(1), mean: +(s / n).toFixed(1), n };
};

// Build a tiny PNG exercising every filter type, to check the decoder offline
function synthPNG(width, height, colorType, ch, pixels, palette) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const ft = y % 5, stride = width * ch;
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    const out = Buffer.alloc(stride + 1);
    out[0] = ft;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][ft];
      out[x + 1] = (cur[x] - pred) & 255;
    }
    rows.push(out);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(tb) >>> 0);
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType;
  const idat = zlib.deflateSync(Buffer.concat(rows));
  const half = idat.length >> 1; // split into two IDAT chunks
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', palette)] : []),
    chunk('IDAT', idat.subarray(0, half)), chunk('IDAT', idat.subarray(half)), chunk('IEND', Buffer.alloc(0))
  ]);
}

(async () => {
  console.log('FloodSim HADR data-module tests\n');

  await step('PNG decoder: synthetic RGB/RGBA/grey/palette, all filters, split IDAT', () => {
    for (const [ct, ch] of [[2, 3], [6, 4], [0, 1], [4, 2]]) {
      const w = 7, h = 10, px = new Uint8Array(w * h * ch).map((_, i) => (i * 37 + (i >> 3) * 11) & 255);
      const img = decodePNG(synthPNG(w, h, ct, ch, px));
      assert.deepStrictEqual([img.width, img.height, img.channels], [w, h, ch]);
      assert.deepStrictEqual(Buffer.from(img.data), Buffer.from(px));
    }
    const pal = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const idx = new Uint8Array(20).map((_, i) => i % 3);
    const img = decodePNG(synthPNG(5, 4, 3, 1, idx, pal));
    assert.strictEqual(img.channels, 3);
    assert.deepStrictEqual([...img.data.subarray(0, 6)], [255, 0, 0, 0, 255, 0]);
    console.log('    decoded 5 synthetic PNG variants correctly');
  });

  await step('Terrarium tile decode (z10 tile containing Tehri)', async () => {
    const z = 10;
    const x = Math.floor((TEHRI.lng + 180) / 360 * 2 ** z);
    const la = TEHRI.lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * 2 ** z);
    const file = path.join(CACHE, 'terrarium', String(z), String(x), y + '.png');
    let buf;
    if (fs.existsSync(file)) buf = fs.readFileSync(file);
    else {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
        { headers: { 'User-Agent': 'FloodSimHADR/1.0 (SIH26161 prototype)' } });
      assert.ok(res.ok, 'HTTP ' + res.status);
      buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    }
    const img = decodePNG(buf);
    const e = new Float32Array(img.width * img.height);
    for (let i = 0; i < e.length; i++) {
      const k = i * img.channels;
      e[i] = img.data[k] * 256 + img.data[k + 1] + img.data[k + 2] / 256 - 32768;
    }
    const s = stats(e);
    console.log(`    tile ${z}/${x}/${y}: ${img.width}x${img.height}x${img.channels}, elevation m`, s);
    assert.ok(s.min > 200 && s.max < 5000, 'implausible Himalayan elevations');
  });

  let spec, grid;
  await step('getDEMGrid: Tehri bbox at 200 m', async () => {
    spec = dem.makeGridSpec({ south: 29.95, west: 78.2, north: 30.5, east: 78.75 }, 200);
    grid = await dem.getDEMGrid(spec, { cacheDir: CACHE });
    const s = stats(grid.z);
    console.log(`    grid ${spec.rows}x${spec.cols} (dx=${spec.dx.toFixed(0)} m, dy=${spec.dy.toFixed(0)} m); ` +
      `zoom ${grid.zoom}, ${grid.tiles} tiles (${grid.cached} cached), pixel ${grid.pixelSizeM} m`);
    console.log('    elevation m', s);
    assert.ok(s.min > 250 && s.min < 700 && s.max > 1800 && s.max < 3500, 'elevation range out of expectation');
  });

  await step('flowPath: 60 km downstream from Tehri Dam', () => {
    const fp = hyd.flowPath(spec, grid.z, TEHRI.lat, TEHRI.lng, 60);
    const a = fp.path[0], b = fp.path[fp.path.length - 1];
    console.log(`    ${fp.path.length} vertices, length ${fp.lengthKm} km, start [${a}] -> end [${b}]`);
    console.log(`    elevation ${fp.elev[0]} m -> ${fp.elev[fp.elev.length - 1]} m (drop ${(fp.elev[0] - fp.elev[fp.elev.length - 1]).toFixed(1)} m)`);
    const bi = fp.km.findIndex(k => k > 30);
    console.log(`    at ~30 km: [${fp.path[bi]}] (Devprayag confluence ≈ 30.146, 78.598)`);
    console.log('    initial bearing [E,N]', hyd.downstreamBearing(fp).map(v => +v.toFixed(3)));
    assert.ok(fp.lengthKm > 55, 'path too short');
    assert.ok(b[0] < a[0] - 0.2, 'path should head south');
    assert.ok(fp.elev[0] - fp.elev[fp.elev.length - 1] > 100, 'too little elevation drop');
  });

  await step('ESRI ASCII parse + resample', () => {
    const txt = 'ncols 3\nnrows 2\nxllcorner 78.0\nyllcorner 30.0\ncellsize 0.1\nNODATA_value -9999\n1 2 3\n4 -9999 6\n';
    const { spec: s, z } = dem.parseEsriAscii(txt);
    assert.strictEqual(s.north, 30.2);
    assert.strictEqual(z[0], 1);
    assert.ok(Number.isNaN(z[4]));
    const dst = dem.makeGridSpec({ south: 30.0, west: 78.0, north: 30.2, east: 78.3 }, 5000);
    const r = dem.resampleToSpec(s, z, dst);
    console.log(`    parsed 3x2 grid, resampled to ${dst.rows}x${dst.cols}:`, stats(r));
  });

  await step('getFeatures: OSM bbox downstream of Tehri (Devprayag)', async () => {
    const f = await osm.getFeatures({ south: 30.05, west: 78.45, north: 30.25, east: 78.65 }, { cacheDir: CACHE });
    console.log(`    ok=${f.ok} cached=${!!f.cached} source="${f.source}"${f.error ? ' error=' + f.error : ''}`);
    console.log(`    places ${f.places.length}, roads ${f.roads.length} (bridges ${f.roads.filter(r => r.bridge).length}), ` +
      `amenities ${f.amenities.length}, waterways ${f.waterways.length}; road classes ${(f.roadClasses || []).join(',')}`);
    assert.ok(f.ok, f.error);
    assert.ok(f.places.length > 10 && f.roads.length > 10);
    assert.ok(f.roads.every(r => r.geom.length === r.nodeIds.length), 'geom/nodeIds mismatch');
  });

  await step('breachParams + breachHydrograph (Tehri-like: 260.5 m, 3540 MCM)', () => {
    const bp = hyd.breachParams({ heightM: 260.5, storageMCM: 3540, mode: 'overtopping' });
    console.log(`    B=${bp.breachWidthM} m, tf=${bp.failureTimeMin} min, Qp Froehlich1995=${bp.peakQ_Froehlich1995} m3/s, ` +
      `Qp MLM1984=${bp.peakQ_MLM1984} m3/s`);
    bp.warnings.forEach(w => console.log('    warning:', w));
    const hg = hyd.breachHydrograph({ Qp: bp.peakQ_Froehlich1995, tfSec: bp.failureTimeSec, volumeM3: 3540e6 });
    console.log(`    hydrograph ${hg.t.length} steps over ${(hg.durationSec / 3600).toFixed(1)} h, ` +
      `volume ${(hg.volumeM3 / 1e6).toFixed(0)} MCM (target 3540), k=${hg.recessionK_s} s`);
    assert.ok(Math.abs(hg.volumeM3 / 3540e6 - 1) < 0.03);
    const pp = hyd.breachParams({ heightM: 30, storageMCM: 50, mode: 'piping' });
    console.log(`    piping 30 m / 50 MCM: B=${pp.breachWidthM} m, tf=${pp.failureTimeMin} min, Qp=${pp.peakQ_Froehlich1995} m3/s`);
  });

  await step('listDams (committed Wikidata snapshot)', () => {
    const d = dams.listDams();
    console.log(`    ${d.count} dams (generated ${d.generatedAt}); with height ${d.stats.withHeight}, ` +
      `capacity ${d.stats.withCapacity}, river ${d.stats.withRiver}`);
    const t = d.dams.find(x => x.qid === 'Q69091');
    console.log('    Tehri:', JSON.stringify(t));
    assert.ok(d.count > 500 && t);
  });

  console.log(failures ? `${failures} step(s) FAILED` : 'All steps passed');
  process.exit(failures ? 1 : 0);
})();
