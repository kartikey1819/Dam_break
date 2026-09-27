/* FloodSim HADR — GIS exports (isomorphic: browser + Node). KML, ESRI Shapefile, GeoJSON, ESRI ASCII grid, ZIP.
 * Polygons are the exact raster footprint of the simulated grid (cells merged into rectangles). */
(function (root, factory) {
  const m = factory(typeof module === 'object' && module.exports ? require('./analysis.js') : root.FS.analysis);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.FS.geoexport = m;
})(typeof self !== 'undefined' ? self : this, function (A) {
  'use strict';
  const NOTE = 'SIMULATED RESULT - prototype decision-support output; validate before operational use';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DEPTH_CLASSES = [[0.05, 0.5], [0.5, 1], [1, 2], [2, 5], [5, 1e9]];
  const ARR_CLASSES = [[0, 15], [15, 30], [30, 60], [60, 120], [120, 1e9]];

  function layers(scn, M) {
    const g = scn.grid, ch = scn.channel;
    const ok = (i) => !(ch && ch[i]);
    const out = [{ name: 'Maximum inundation extent', kind: 'extent', cls: '', rings: A.maskRects(g, (i) => ok(i) && M.dmax[i] > 0.05) }];
    DEPTH_CLASSES.forEach(([a, b]) => out.push({ name: `Max depth ${a}-${b > 1e8 ? '+' : b} m`, kind: 'depth', cls: `${a}-${b > 1e8 ? '' : b}`, min: a, max: b, rings: A.maskRects(g, (i) => ok(i) && M.dmax[i] >= a && M.dmax[i] < b) }));
    ARR_CLASSES.forEach(([a, b]) => out.push({ name: `Arrival ${a}-${b > 1e8 ? '+' : b} min`, kind: 'arrival', cls: `${a}-${b > 1e8 ? '' : b}`, min: a, max: b, rings: A.maskRects(g, (i) => ok(i) && M.dmax[i] > 0.05 && M.arr[i] >= a && M.arr[i] < b) }));
    return out.filter((l) => l.rings.length);
  }

  // ---------- KML ----------
  const KCOL = { extent: '6622d3ee', depth: ['99fde07d', '99f8bd38', '99eb6325', '99167cf9', '992626dc'], arrival: ['992626dc', '99167cf9', '990b9ef5', '9915ccfa', '9935e5a3'] };
  const RCOL = { CRITICAL: 'ff4444ef', HIGH: 'ff1673f9', MEDIUM: 'ff0b9ef5', LOW: 'ff5ec522', NONE: 'ff8b7464' };
  function kml(scn, M, ana, title) {
    const L = layers(scn, M);
    let di = 0, ai = 0;
    const poly = (r) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${r.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)},0`).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    const styles = L.map((l, k) => `<Style id="s${k}"><LineStyle><color>${l.kind === 'extent' ? 'ffeed322' : '00000000'}</color><width>${l.kind === 'extent' ? 2 : 0}</width></LineStyle><PolyStyle><color>${l.kind === 'extent' ? KCOL.extent : l.kind === 'depth' ? KCOL.depth[di++] : KCOL.arrival[ai++]}</color></PolyStyle></Style>`).join('');
    const folders = ['extent', 'depth', 'arrival'].map((kind) => `<Folder><name>${kind === 'extent' ? 'Inundation extent' : kind === 'depth' ? 'Maximum depth classes' : 'Arrival-time zones'}</name>${L.map((l, k) => (l.kind === kind ? `<Placemark><name>${esc(l.name)}</name><styleUrl>#s${k}</styleUrl><description>${esc(NOTE)}</description><MultiGeometry>${l.rings.map(poly).join('')}</MultiGeometry></Placemark>` : '')).join('')}</Folder>`).join('');
    const vil = ana ? ana.villages.filter((v) => v.affected).map((v) => `<Placemark><name>${esc(v.name)} (${v.risk})</name><Style><IconStyle><color>${RCOL[v.risk]}</color></IconStyle></Style><description>${esc(`Depth ${v.depth.toFixed(2)} m; arrival ${Math.round(v.arrival)} min; duration ${Math.round(v.duration)} min; priority ${v.priority}; safe zone ${v.safeZone || 'none'}`)}</description><Point><coordinates>${v.lng.toFixed(6)},${v.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('') : '';
    const routes = ana ? ana.villages.filter((v) => v.affected && v.evac.recommended).map((v) => `<Placemark><name>Evacuation ${esc(v.name)} → ${esc(v.safeZone)}</name><Style><LineStyle><color>ff5ec522</color><width>3</width></LineStyle></Style><description>Simulated decision-support route — not an officially approved evacuation route</description><LineString><coordinates>${v.evac.recommended.coords.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)},0`).join(' ')}</coordinates></LineString></Placemark>`).join('') : '';
    const river = `<Placemark><name>River</name><Style><LineStyle><color>fff9e867</color><width>3</width></LineStyle></Style><LineString><coordinates>${scn.river.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)},0`).join(' ')}</coordinates></LineString></Placemark>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)} (${esc(M.short)})</name><description>${esc(NOTE + ' | model engine: ' + M.engine)}</description>${styles}${folders}<Folder><name>Affected settlements</name>${vil}</Folder><Folder><name>Evacuation routes (simulated)</name>${routes}</Folder>${river}</Document></kml>`;
  }

  // ---------- GeoJSON ----------
  function geojson(scn, M, ana) {
    const feats = layers(scn, M).map((l) => ({ type: 'Feature', properties: { layer: l.kind, name: l.name, min: l.min ?? null, max: l.max && l.max < 1e8 ? l.max : null, model: M.short, engine: M.engine, note: NOTE }, geometry: { type: 'MultiPolygon', coordinates: l.rings.map((r) => [r.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)])]) } }));
    if (ana) {
      ana.villages.forEach((v) => feats.push({ type: 'Feature', properties: { layer: 'village', id: v.id, name: v.name, group: v.group, depth_m: +v.depth.toFixed(2), arrival_min: isFinite(v.arrival) ? Math.round(v.arrival) : null, duration_min: Math.round(v.duration), risk: v.risk, priority: v.priority, score: +v.score.toFixed(1), population: v.pop, pop_source: v.popSource, safe_zone: v.safeZone }, geometry: { type: 'Point', coordinates: [+v.lng.toFixed(6), +v.lat.toFixed(6)] } }));
      ana.villages.filter((v) => v.affected && v.evac.recommended).forEach((v) => feats.push({ type: 'Feature', properties: { layer: 'evacuation_route_simulated', village: v.name, to: v.safeZone, length_km: +v.evac.recommended.len.toFixed(2), time_min: Math.round(v.evac.recommended.time) }, geometry: { type: 'LineString', coordinates: v.evac.recommended.coords.map((p) => [+p[1].toFixed(6), +p[0].toFixed(6)]) } }));
    }
    return { type: 'FeatureCollection', name: 'floodsim_hadr', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: feats };
  }

  // ---------- Shapefile (Polygon, multi-part records) ----------
  function shpPolygons(records, fields) {
    // records: [{ rings: [[[x,y],...closed cw]...], attrs: {...} }]
    let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
    const rec = records.map((r) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, np = 0;
      r.rings.forEach((ring) => { np += ring.length; ring.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); });
      X0 = Math.min(X0, x0); Y0 = Math.min(Y0, y0); X1 = Math.max(X1, x1); Y1 = Math.max(Y1, y1);
      return { r, box: [x0, y0, x1, y1], np, len: 44 + 4 * r.rings.length + 16 * np };
    });
    const shpLen = 100 + rec.reduce((a, q) => a + 8 + q.len, 0), shxLen = 100 + 8 * rec.length;
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(shxLen));
    [[shp, shpLen], [shx, shxLen]].forEach(([dv, len]) => { dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, 5, true); [X0, Y0, X1, Y1].forEach((v, i) => dv.setFloat64(36 + i * 8, v, true)); });
    let off = 100;
    rec.forEach((q, k) => {
      shx.setInt32(100 + k * 8, off / 2, false); shx.setInt32(104 + k * 8, q.len / 2, false);
      shp.setInt32(off, k + 1, false); shp.setInt32(off + 4, q.len / 2, false);
      let o = off + 8;
      shp.setInt32(o, 5, true); q.box.forEach((v, i) => shp.setFloat64(o + 4 + i * 8, v, true));
      shp.setInt32(o + 36, q.r.rings.length, true); shp.setInt32(o + 40, q.np, true);
      let p = o + 44, start = 0;
      q.r.rings.forEach((ring) => { shp.setInt32(p, start, true); p += 4; start += ring.length; });
      q.r.rings.forEach((ring) => ring.forEach(([x, y]) => { shp.setFloat64(p, x, true); shp.setFloat64(p + 8, y, true); p += 16; }));
      off += 8 + q.len;
    });
    const recSize = 1 + fields.reduce((a, f) => a + f.len, 0), hdr = 32 + 32 * fields.length + 1;
    const dbf = new Uint8Array(hdr + recSize * records.length + 1), dv = new DataView(dbf.buffer), now = new Date();
    dbf[0] = 3; dbf[1] = now.getFullYear() - 1900; dbf[2] = now.getMonth() + 1; dbf[3] = now.getDate();
    dv.setUint32(4, records.length, true); dv.setUint16(8, hdr, true); dv.setUint16(10, recSize, true);
    fields.forEach((f, i) => { const b = 32 + i * 32; for (let k = 0; k < Math.min(10, f.name.length); k++) dbf[b + k] = f.name.charCodeAt(k); dbf[b + 11] = f.type.charCodeAt(0); dbf[b + 16] = f.len; dbf[b + 17] = f.dec || 0; });
    dbf[hdr - 1] = 0x0d;
    records.forEach((r, k) => {
      let o = hdr + k * recSize; dbf[o++] = 0x20;
      fields.forEach((f) => {
        const v = r.attrs[f.name];
        let s = v == null ? '' : f.type === 'N' ? Number(v).toFixed(f.dec || 0) : String(v).replace(/[^\x20-\x7e]/g, '-');
        s = f.type === 'N' ? s.padStart(f.len).slice(-f.len) : s.padEnd(f.len).slice(0, f.len);
        for (let j = 0; j < f.len; j++) dbf[o + j] = s.charCodeAt(j);
        o += f.len;
      });
    });
    dbf[dbf.length - 1] = 0x1a;
    return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer), dbf };
  }
  const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  function shapefileZip(scn, M, title) {
    const L = layers(scn, M);
    const s = shpPolygons(L.map((l) => ({ rings: l.rings, attrs: { LAYER: l.kind, NAME: l.name, MIN: l.min ?? 0, MAX: l.max && l.max < 1e8 ? l.max : 0, MODEL: M.short, SCENARIO: title, STATUS: 'SIMULATED' } })),
      [{ name: 'LAYER', type: 'C', len: 10 }, { name: 'NAME', type: 'C', len: 40 }, { name: 'MIN', type: 'N', len: 10, dec: 2 }, { name: 'MAX', type: 'N', len: 10, dec: 2 }, { name: 'MODEL', type: 'C', len: 12 }, { name: 'SCENARIO', type: 'C', len: 60 }, { name: 'STATUS', type: 'C', len: 12 }]);
    const base = `floodsim_${M.key}`;
    return zip([{ name: base + '.shp', data: s.shp }, { name: base + '.shx', data: s.shx }, { name: base + '.dbf', data: s.dbf }, { name: base + '.prj', data: PRJ }, { name: base + '.cpg', data: 'ASCII' }, { name: 'README.txt', data: `FloodSim HADR inundation polygons (extent, depth classes, arrival zones)\nModel: ${M.name} — ${M.engine}\n${NOTE}\nCRS: WGS84 (EPSG:4326)\n` }]);
  }

  // ---------- ESRI ASCII grid ----------
  function asciiGrid(scn, arr, nodata) {
    const g = scn.grid;
    if (Math.abs(g.dLat - g.dLng) / g.dLat > 1e-6) {
      // non-square degrees: write dx/dy variant (supported by GDAL)
    }
    const lines = [`ncols ${g.cols}`, `nrows ${g.rows}`, `xllcorner ${g.west.toFixed(8)}`, `yllcorner ${(g.north - g.rows * g.dLat).toFixed(8)}`, `dx ${g.dLng.toFixed(10)}`, `dy ${g.dLat.toFixed(10)}`, `NODATA_value ${nodata ?? -9999}`];
    for (let r = 0; r < g.rows; r++) {
      const row = new Array(g.cols);
      for (let c = 0; c < g.cols; c++) { const v = arr[r * g.cols + c]; row[c] = isFinite(v) && v > 0 ? v.toFixed(2) : v === 0 ? '0' : String(nodata ?? -9999); }
      lines.push(row.join(' '));
    }
    return lines.join('\n') + '\n';
  }

  // ---------- ZIP (store method) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const enc = (s) => (typeof s === 'string' ? new TextEncoder().encode(s) : s);
  function zip(files) {
    const parts = [], central = []; let off = 0;
    files.forEach((f) => {
      const name = enc(f.name), data = enc(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    const csize = central.reduce((a, p) => a + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let p = 0; all.forEach((x) => { out.set(x, p); p += x.length; });
    return out;
  }

  return { kml, geojson, shapefileZip, asciiGrid, zip, crc32, layers, PRJ, NOTE };
});
