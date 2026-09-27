'use strict';
// DEM acquisition on the shared equal-angle grid.
// Grid spec: { north, west, dLat, dLng, rows, cols, south, east }.
// Row 0 = north edge, col 0 = west edge, index i = r*cols + c.
// Sources: AWS Terrain Tiles (Terrarium PNG, SRTM-derived over India) or a
// user-supplied ESRI ASCII grid in geographic WGS84 degrees.

const fs = require('fs');
const path = require('path');
const { decodePNG } = require('./png');

const UA = 'FloodSimHADR/1.0 (SIH26161 prototype)';
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SOURCE = 'AWS Terrain Tiles (Terrarium; SRTM/GMTED-derived)';
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320;
const DEFAULT_CACHE = path.join(__dirname, '..', '..', 'data', 'cache');

// ---------- grid helpers ----------

function finishSpec(s) {
  s.south = s.north - s.rows * s.dLat;
  s.east = s.west + s.cols * s.dLng;
  const latMid = (s.north + s.south) / 2;
  s.dy = s.dLat * M_PER_DEG_LAT;
  s.dx = s.dLng * M_PER_DEG_LNG * Math.cos(latMid * Math.PI / 180);
  return s;
}

function makeGridSpec({ south, west, north, east }, resM) {
  if (!(north > south) || !(east > west)) throw new Error('makeGridSpec: invalid bbox');
  if (!(resM > 0)) throw new Error('makeGridSpec: resM must be > 0');
  const latMid = (north + south) / 2;
  const dLat = resM / M_PER_DEG_LAT;
  const dLng = resM / (M_PER_DEG_LNG * Math.cos(latMid * Math.PI / 180));
  const rows = Math.ceil((north - south) / dLat - 1e-9);
  const cols = Math.ceil((east - west) / dLng - 1e-9);
  return finishSpec({ north, west, dLat, dLng, rows, cols, resM });
}

const cellCenter = (spec, r, c) => [spec.north - (r + 0.5) * spec.dLat, spec.west + (c + 0.5) * spec.dLng];

// Returns [r, c] (may be outside the grid; caller checks)
const latLngToCell = (spec, lat, lng) => [
  Math.floor((spec.north - lat) / spec.dLat),
  Math.floor((lng - spec.west) / spec.dLng)
];

// ---------- Web-Mercator tile maths ----------

const lng2px = (lng, z) => ((lng + 180) / 360) * 256 * 2 ** z;
function lat2px(lat, z) {
  const phi = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * 256 * 2 ** z;
}
const pixelSizeM = (lat, z) => 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** z;

function tileRange(spec, z) {
  // pixel-centre sampling needs one extra pixel of margin on each side
  const x0 = Math.floor((lng2px(spec.west, z) - 1) / 256);
  const x1 = Math.floor((lng2px(spec.east, z) + 1) / 256);
  const y0 = Math.floor((lat2px(spec.north, z) - 1) / 256);
  const y1 = Math.floor((lat2px(spec.south, z) + 1) / 256);
  return { x0, x1, y0, y1, n: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

function chooseZoom(spec, maxTiles) {
  const latMid = (spec.north + spec.south) / 2;
  const cell = Math.min(spec.dLat * M_PER_DEG_LAT, spec.dLng * M_PER_DEG_LNG * Math.cos(latMid * Math.PI / 180));
  let z = 8;
  while (z < 12 && pixelSizeM(latMid, z) > cell) z++;
  while (z > 8 && tileRange(spec, z).n > maxTiles) z--;
  return z;
}

// ---------- fetching with cache ----------

async function fetchTile(z, x, y, cacheDir) {
  const file = path.join(cacheDir, 'terrarium', String(z), String(x), y + '.png');
  if (fs.existsSync(file)) {
    try {
      return { png: decodePNG(fs.readFileSync(file)), cached: true };
    } catch (e) {
      fs.unlinkSync(file); // corrupt cache entry: refetch
    }
  }
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const png = decodePNG(buf);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return { png, cached: false };
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error(`tile ${z}/${x}/${y}: ${lastErr && lastErr.message}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { ok: true, v: await fn(items[i]) }; } catch (e) { out[i] = { ok: false, e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function terrariumToElev(png) {
  const { width, height, channels, data } = png;
  const e = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const k = i * channels;
    e[i] = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
  }
  return e;
}

/**
 * Sample a DEM onto `spec` from AWS Terrarium tiles.
 * Values below -5 m are treated as sea and set to 0 (seaCells counts them);
 * genuine low-lying land between -5 and 0 m is kept.
 */
async function getDEMGrid(spec, { cacheDir = DEFAULT_CACHE, zoom, maxTiles = 400 } = {}) {
  const z = zoom != null ? Math.max(0, Math.min(15, zoom | 0)) : chooseZoom(spec, maxTiles);
  const tr = tileRange(spec, z);
  const n = 2 ** z;
  const list = [];
  for (let ty = tr.y0; ty <= tr.y1; ty++) {
    for (let tx = tr.x0; tx <= tr.x1; tx++) {
      if (ty >= 0 && ty < n) list.push([((tx % n) + n) % n, ty, tx]);
    }
  }
  const results = await mapLimit(list, 6, ([x, y]) => fetchTile(z, x, y, cacheDir));
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    throw new Error(`DEM: ${failed.length}/${list.length} Terrarium tiles could not be fetched and are not cached ` +
      `(${failed[0].e.message}). Check internet access or upload a DEM (ESRI ASCII grid).`);
  }
  const tiles = new Map();
  let cachedCount = 0;
  list.forEach(([, y, tx], i) => {
    tiles.set(tx + ',' + y, terrariumToElev(results[i].v.png));
    if (results[i].v.cached) cachedCount++;
  });

  // global pixel lookup (clamped to the fetched mosaic)
  const gx0 = tr.x0 * 256, gx1 = (tr.x1 + 1) * 256 - 1;
  const gy0 = Math.max(0, tr.y0) * 256, gy1 = Math.min(n - 1, tr.y1) * 256 + 255;
  const pix = (gx, gy) => {
    gx = gx < gx0 ? gx0 : gx > gx1 ? gx1 : gx;
    gy = gy < gy0 ? gy0 : gy > gy1 ? gy1 : gy;
    const t = tiles.get((gx >> 8) + ',' + (gy >> 8));
    return t[(gy & 255) * 256 + (gx & 255)];
  };

  const zArr = new Float32Array(spec.rows * spec.cols);
  let seaCells = 0;
  const colPx = new Float64Array(spec.cols);
  for (let c = 0; c < spec.cols; c++) colPx[c] = lng2px(spec.west + (c + 0.5) * spec.dLng, z) - 0.5;
  for (let r = 0; r < spec.rows; r++) {
    const py = lat2px(spec.north - (r + 0.5) * spec.dLat, z) - 0.5;
    const y0 = Math.floor(py), fy = py - y0;
    for (let c = 0; c < spec.cols; c++) {
      const px = colPx[c];
      const x0 = Math.floor(px), fx = px - x0;
      const v = (pix(x0, y0) * (1 - fx) + pix(x0 + 1, y0) * fx) * (1 - fy) +
                (pix(x0, y0 + 1) * (1 - fx) + pix(x0 + 1, y0 + 1) * fx) * fy;
      const i = r * spec.cols + c;
      if (v < -5) { zArr[i] = 0; seaCells++; } else zArr[i] = v;
    }
  }
  const latMid = (spec.north + spec.south) / 2;
  return {
    z: zArr,
    zoom: z,
    source: SOURCE,
    tiles: list.length,
    cached: cachedCount,
    seaCells,
    pixelSizeM: Math.round(pixelSizeM(latMid, z) * 10) / 10
  };
}

// ---------- ESRI ASCII grid ----------

function parseEsriAscii(text) {
  const lines = String(text).split(/\r?\n/);
  const hdr = {};
  let li = 0;
  for (; li < lines.length; li++) {
    const m = /^\s*([A-Za-z_]+)\s+(\S+)\s*$/.exec(lines[li]);
    if (!m) break;
    hdr[m[1].toLowerCase()] = Number(m[2]);
  }
  const ncols = hdr.ncols, nrows = hdr.nrows;
  const cs = hdr.cellsize != null ? hdr.cellsize : hdr.dx;
  const csy = hdr.cellsize != null ? hdr.cellsize : (hdr.dy != null ? hdr.dy : hdr.dx);
  if (!(ncols > 0 && nrows > 0 && cs > 0)) throw new Error('ESRI ASCII: missing ncols/nrows/cellsize header');
  let west, south;
  if (hdr.xllcorner != null) west = hdr.xllcorner;
  else if (hdr.xllcenter != null) west = hdr.xllcenter - cs / 2;
  if (hdr.yllcorner != null) south = hdr.yllcorner;
  else if (hdr.yllcenter != null) south = hdr.yllcenter - csy / 2;
  if (west == null || south == null) throw new Error('ESRI ASCII: missing xll/yll header');
  if (Math.abs(west) > 180 || Math.abs(south) > 90 || cs > 5) {
    throw new Error('ESRI ASCII: coordinates are not geographic degrees (WGS84 lat/lng required; reproject first)');
  }
  const nodata = hdr.nodata_value;
  const z = new Float32Array(ncols * nrows);
  const tokens = lines.slice(li).join(' ').trim().split(/\s+/);
  if (tokens.length < ncols * nrows) throw new Error(`ESRI ASCII: expected ${ncols * nrows} values, found ${tokens.length}`);
  for (let i = 0; i < ncols * nrows; i++) {
    const v = Number(tokens[i]);
    z[i] = !isFinite(v) || (nodata != null && v === nodata) ? NaN : v;
  }
  const spec = finishSpec({ north: south + nrows * csy, west, dLat: csy, dLng: cs, rows: nrows, cols: ncols });
  return { spec, z };
}

// Bilinear (NaN-aware) resampling between two grid specs.
function resampleToSpec(srcSpec, srcZ, dstSpec) {
  const out = new Float32Array(dstSpec.rows * dstSpec.cols);
  const R = srcSpec.rows, C = srcSpec.cols;
  const at = (r, c) => srcZ[Math.min(R - 1, Math.max(0, r)) * C + Math.min(C - 1, Math.max(0, c))];
  for (let r = 0; r < dstSpec.rows; r++) {
    const lat = dstSpec.north - (r + 0.5) * dstSpec.dLat;
    const fr = (srcSpec.north - lat) / srcSpec.dLat - 0.5;
    for (let c = 0; c < dstSpec.cols; c++) {
      const lng = dstSpec.west + (c + 0.5) * dstSpec.dLng;
      const fc = (lng - srcSpec.west) / srcSpec.dLng - 0.5;
      const i = r * dstSpec.cols + c;
      if (fr < -0.5 || fr > R - 0.5 || fc < -0.5 || fc > C - 0.5) { out[i] = NaN; continue; }
      const r0 = Math.floor(fr), c0 = Math.floor(fc), ty = fr - r0, tx = fc - c0;
      let sw = 0, sv = 0;
      const add = (v, w) => { if (w > 0 && !Number.isNaN(v)) { sv += v * w; sw += w; } };
      add(at(r0, c0), (1 - tx) * (1 - ty));
      add(at(r0, c0 + 1), tx * (1 - ty));
      add(at(r0 + 1, c0), (1 - tx) * ty);
      add(at(r0 + 1, c0 + 1), tx * ty);
      out[i] = sw > 0 ? sv / sw : NaN;
    }
  }
  return out;
}

module.exports = {
  makeGridSpec,
  getDEMGrid,
  parseEsriAscii,
  resampleToSpec,
  cellCenter,
  latLngToCell,
  pixelSizeM,
  SOURCE
};
