/* FloodSim HADR — exports (KML, SHP, GeoJSON, PNG, printable report) and alert text generation.
 * All outputs carry SIMULATED DEMO labels. Alerts are TEXT ONLY — no messaging backend is connected. */
(function () {
  const E = FS.engine, D = FS.data;
  const DEMO = 'SIMULATED DEMO RESULT - prototype decision-support output; not for operational use without validation';

  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');

  // ---------- GeoJSON ----------
  function geojson(res, ana) {
    const ring = E.envelope(res, null) || [];
    const feats = [{ type: 'Feature', properties: { layer: 'inundation_extent', model: res.model.short, max_depth_m: +ana.kpi.maxDepth.toFixed(2), area_km2: +ana.kpi.area.toFixed(1), note: DEMO }, geometry: { type: 'Polygon', coordinates: [ring.map((p) => [+p[1].toFixed(6), +p[0].toFixed(6)])] } }];
    ana.villages.forEach((v) => feats.push({ type: 'Feature', properties: { layer: 'village', id: v.id, name: v.name, panchayat: v.gp, depth_m: +v.depth.toFixed(2), arrival_min: isFinite(v.arrival) ? Math.round(v.arrival) : null, risk: v.risk, priority: v.priority, pop_est_demo: v.pop, safe_zone: v.safeZone, note: 'DEMO' }, geometry: { type: 'Point', coordinates: [+v.lng.toFixed(6), +v.lat.toFixed(6)] } }));
    ana.villages.filter((v) => v.evac.recommended).forEach((v) => feats.push({ type: 'Feature', properties: { layer: 'evacuation_route_simulated', village: v.name, to: v.safeZone, length_km: +v.evac.recommended.len.toFixed(1), note: 'Simulated decision-support route - not an officially approved evacuation route' }, geometry: { type: 'LineString', coordinates: v.evac.recommended.coords.map((p) => [+p[1].toFixed(6), +p[0].toFixed(6)]) } }));
    return { type: 'FeatureCollection', name: 'floodsim_hadr_demo', features: feats };
  }

  // ---------- KML ----------
  function kml(res, ana, scen) {
    const ring = E.envelope(res, null) || [];
    const coords = ring.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)},0`).join(' ');
    const esc = FS.fmt.esc;
    const pm = ana.villages.map((v) => `<Placemark><name>${esc(v.name)} (${v.risk})</name><styleUrl>#v${v.risk}</styleUrl><description>${esc(`Depth ${v.depth.toFixed(2)} m; arrival ${isFinite(v.arrival) ? Math.round(v.arrival) + ' min' : 'n/a'}; pop (demo) ${v.pop}; priority ${v.priority}. DEMO`)}</description><Point><coordinates>${v.lng.toFixed(6)},${v.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n');
    const col = { CRITICAL: 'ff4444ef', HIGH: 'ff1673f9', MEDIUM: 'ff0b9ef5', LOW: 'ff5ec522', NONE: 'ff8b7464' };
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>FloodSim HADR - ${esc(scen)} (${res.model.short})</name>
<description>${DEMO}</description>
<Style id="ext"><LineStyle><color>ffeed322</color><width>2</width></LineStyle><PolyStyle><color>66eed322</color></PolyStyle></Style>
${Object.keys(col).map((k) => `<Style id="v${k}"><IconStyle><color>${col[k]}</color><scale>1.0</scale></IconStyle></Style>`).join('')}
<Placemark><name>Simulated maximum inundation extent (${res.model.short})</name><styleUrl>#ext</styleUrl><description>Area ${ana.kpi.area.toFixed(1)} km2; max depth ${ana.kpi.maxDepth.toFixed(2)} m. ${DEMO}</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Folder><name>Villages (demo)</name>${pm}</Folder>
</Document></kml>`;
  }

  // ---------- Shapefile (polygon) writer ----------
  function shpPolygon(rings, attrs, fields) {
    // rings: array of [[lng,lat],...] closed; one record per ring
    let xmin = 1e9, ymin = 1e9, xmax = -1e9, ymax = -1e9;
    rings.forEach((r) => r.forEach(([x, y]) => { xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y); }));
    const recLens = rings.map((r) => 44 + 4 + 16 * r.length); // content bytes
    const shpLen = 100 + recLens.reduce((a, l) => a + 8 + l, 0);
    const shp = new DataView(new ArrayBuffer(shpLen)), shx = new DataView(new ArrayBuffer(100 + 8 * rings.length));
    const header = (dv, len) => {
      dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, 5, true);
      [xmin, ymin, xmax, ymax].forEach((v, i) => dv.setFloat64(36 + i * 8, v, true));
    };
    header(shp, shpLen); header(shx, 100 + 8 * rings.length);
    let off = 100;
    rings.forEach((r, i) => {
      // shapefile outer rings must be clockwise
      let area = 0; for (let k = 0; k < r.length - 1; k++) area += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1];
      if (area > 0) r = r.slice().reverse();
      shx.setInt32(100 + i * 8, off / 2, false); shx.setInt32(104 + i * 8, recLens[i] / 2, false);
      shp.setInt32(off, i + 1, false); shp.setInt32(off + 4, recLens[i] / 2, false);
      let o = off + 8;
      shp.setInt32(o, 5, true);
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      r.forEach(([x, y]) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); });
      [bx0, by0, bx1, by1].forEach((v, k) => shp.setFloat64(o + 4 + k * 8, v, true));
      shp.setInt32(o + 36, 1, true); shp.setInt32(o + 40, r.length, true); shp.setInt32(o + 44, 0, true);
      r.forEach(([x, y], k) => { shp.setFloat64(o + 48 + k * 16, x, true); shp.setFloat64(o + 56 + k * 16, y, true); });
      off += 8 + recLens[i];
    });
    // DBF
    const recSize = 1 + fields.reduce((a, f) => a + f.len, 0);
    const hdrSize = 32 + 32 * fields.length + 1;
    const dbf = new Uint8Array(hdrSize + recSize * attrs.length + 1);
    const dv = new DataView(dbf.buffer);
    const now = new Date();
    dbf[0] = 3; dbf[1] = now.getFullYear() - 1900; dbf[2] = now.getMonth() + 1; dbf[3] = now.getDate();
    dv.setUint32(4, attrs.length, true); dv.setUint16(8, hdrSize, true); dv.setUint16(10, recSize, true);
    fields.forEach((f, i) => {
      const b = 32 + i * 32;
      for (let k = 0; k < Math.min(10, f.name.length); k++) dbf[b + k] = f.name.charCodeAt(k);
      dbf[b + 11] = f.type.charCodeAt(0); dbf[b + 16] = f.len; dbf[b + 17] = f.dec || 0;
    });
    dbf[hdrSize - 1] = 0x0d;
    attrs.forEach((a, r) => {
      let o = hdrSize + r * recSize;
      dbf[o++] = 0x20;
      fields.forEach((f) => {
        let s = a[f.name] == null ? '' : f.type === 'N' ? Number(a[f.name]).toFixed(f.dec || 0) : String(a[f.name]).replace(/[^\x20-\x7e]/g, '-');
        s = f.type === 'N' ? s.padStart(f.len).slice(-f.len) : s.padEnd(f.len).slice(0, f.len);
        for (let k = 0; k < f.len; k++) dbf[o + k] = s.charCodeAt(k);
        o += f.len;
      });
    });
    dbf[dbf.length - 1] = 0x1a;
    const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    return { shp: shp.buffer, shx: shx.buffer, dbf: dbf.buffer, prj };
  }
  async function shpZip(res, ana, scen) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded (offline?). Use KML/GeoJSON export instead.');
    const ring = (E.envelope(res, null) || []).map((p) => [p[1], p[0]]);
    const files = shpPolygon([ring], [{ SCENARIO: scen, MODEL: res.model.short, AREA_KM2: ana.kpi.area, MAXDEPTH: ana.kpi.maxDepth, STATUS: 'SIMULATED DEMO' }],
      [{ name: 'SCENARIO', type: 'C', len: 40 }, { name: 'MODEL', type: 'C', len: 10 }, { name: 'AREA_KM2', type: 'N', len: 10, dec: 2 }, { name: 'MAXDEPTH', type: 'N', len: 8, dec: 2 }, { name: 'STATUS', type: 'C', len: 20 }]);
    const zip = new JSZip();
    const base = `floodsim_inundation_${res.model.key}`;
    zip.file(base + '.shp', files.shp); zip.file(base + '.shx', files.shx); zip.file(base + '.dbf', files.dbf); zip.file(base + '.prj', files.prj);
    zip.file('README.txt', `FloodSim HADR - simulated inundation boundary\n${DEMO}\nCRS: WGS84 (EPSG:4326)\n`);
    return zip.generateAsync({ type: 'blob' });
  }

  // ---------- PNG map snapshot (fully local rendering, no tile CORS issues) ----------
  function mapSnapshot(res, ana, t, title) {
    const S = 4, G = E.G, W = G.cols * S, H = G.rows * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H + 70;
    const x = c.getContext('2d');
    x.fillStyle = '#0b1424'; x.fillRect(0, 0, c.width, c.height);
    const draw = (url) => new Promise((ok) => { const im = new Image(); im.onload = () => { x.imageSmoothingEnabled = true; x.drawImage(im, 0, 0, W, H); ok(); }; im.src = url; });
    const px = (lat, lng) => [((lng - G.west) / G.dLng) * S, ((G.north - lat) / G.dLat) * S];
    return draw(FS.mapkit.renderHillshade().url).then(() => draw(FS.mapkit.renderRaster(res, 'depth', t, 0.85))).then(() => {
      x.strokeStyle = '#67e8f9'; x.lineWidth = 3; x.beginPath();
      D.river.forEach((p, i) => { const [a, b] = px(p[0], p[1]); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke();
      x.font = '600 13px Inter, sans-serif';
      ana.villages.forEach((v) => {
        const [a, b] = px(v.lat, v.lng);
        x.fillStyle = FS.mapkit.RISK_COL[v.risk]; x.beginPath(); x.arc(a, b, 6, 0, 7); x.fill();
        x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke();
        x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 3; x.fillText(v.name, a + 9, b + 4); x.shadowBlur = 0;
      });
      const [da, db] = px(D.dam.lat, D.dam.lng);
      x.fillStyle = '#fff'; x.fillRect(da - 8, db - 8, 16, 16); x.strokeStyle = '#ef4444'; x.strokeRect(da - 8, db - 8, 16, 16);
      x.fillStyle = '#0e1828'; x.fillRect(0, H, W, 70);
      x.fillStyle = '#fff'; x.font = '700 16px Inter, sans-serif'; x.fillText(title, 12, H + 22);
      x.font = '12px Inter, sans-serif'; x.fillStyle = '#f5c46b';
      x.fillText('SIMULATED DEMO DATA - parametric surrogate, synthetic DEM & settlements. Not for operational use.', 12, H + 42);
      FS.mapkit.PAL.depth.colors.forEach((col, i) => { x.fillStyle = col; x.fillRect(12 + i * 92, H + 52, 14, 10); x.fillStyle = '#cbd5e1'; x.fillText(FS.mapkit.PAL.depth.labels[i], 30 + i * 92, H + 62); });
      return c.toDataURL('image/png');
    });
  }

  // ---------- alerts (TEXT ONLY) ----------
  function alertData(v, ana) {
    const route = v.evac.recommended;
    const avoid = (v.evac.naive ? v.evac.naive.blocked : route ? route.blocked : []).map((e) => e.id);
    const avoidAll = avoid.length ? avoid : Object.entries(ana.roadEval).filter(([id, ev]) => ev.blocked && E.ROADS.edges.find((e) => e.id === id && (e.a === v.id || e.b === v.id))).map(([id]) => id);
    const sz = D.safeZones.find((z) => z.id === v.safeZone);
    return { v, sz, route, avoid: avoidAll.slice(0, 3) };
  }
  function sms(v, ana, lang) {
    const t = (k) => FS.t(k, lang), a = alertData(v, ana);
    const act = a.sz ? `${t('moveTo')} ${a.sz.id}${a.avoid.length ? '. ' + t('avoid') + ' ' + a.avoid.join(',') : ''}` : t('shelter');
    return `[DEMO] ${t('alertTitle')}: ${v.name}. ${t('arrival')} ~${Math.round(v.arrival)} ${t('minutes')}, ${t('depth')} ${v.depth.toFixed(1)}m, ${t('risk')} ${v.risk}. ${act}. -FloodSim(sim)`;
  }
  function whatsapp(v, ana, lang) {
    const t = (k) => FS.t(k, lang), a = alertData(v, ana);
    const gp = D.panchayats.find((p) => p.id === v.gp);
    let s = `*🚨 ${t('alertTitle')}*\n\n*${t('village')}:* ${v.name} (${gp.name})\n*${t('arrival')}:* ~${Math.round(v.arrival)} ${t('minutes')}\n*${t('depth')}:* ${v.depth.toFixed(1)} m\n*${t('risk')}:* ${v.risk}\n\n*${t('action')}:*\n`;
    if (a.sz) s += `➡️ ${t('moveTo')} *${a.sz.name}*\n` + (a.route ? `🛣️ ${a.route.edges.map((e) => e.id).join(' → ')} (${a.route.len.toFixed(1)} km, ~${Math.round(a.route.time)} ${t('minutes')})\n` : '') + (a.avoid.length ? `⛔ ${t('avoid')}: ${a.avoid.join(', ')}\n` : '');
    else s += `⚠️ ${t('shelter')}\n`;
    return s + `\n_${t('demoAlert')}_`;
  }
  function brief(v, ana, lang) {
    const a = alertData(v, ana), gp = D.panchayats.find((p) => p.id === v.gp);
    const t = (k) => FS.t(k, lang);
    return `EMERGENCY BRIEF — ${t('alertTitle')} (SIMULATED DEMO)
==================================================
${t('village')}           : ${v.name}
Gram Panchayat     : ${gp.name} (${gp.block})
Population (est.)  : ${v.pop.toLocaleString('en-IN')}  [DEMO]
${t('arrival')}      : T+${Math.round(v.arrival)} min after breach initiation
${t('depth')}      : ${v.depth.toFixed(2)} m
Flood duration     : ${Math.round(v.duration)} min
${t('risk')}               : ${v.risk}     HADR priority: ${v.priority} (${v.score.toFixed(0)}/100)
Critical assets    : ${v.infra.map((f) => f.name).join('; ') || 'none recorded'}

${t('action')}:
${a.sz ? `- ${t('moveTo')}: ${a.sz.name}\n- Route: ${a.route ? a.route.edges.map((e) => e.name).join(' -> ') : 'n/a'}\n- Distance ${a.route ? a.route.len.toFixed(1) : '-'} km, travel ~${a.route ? Math.round(a.route.time) : '-'} min (vehicle)` : '- ' + t('shelter')}
${a.avoid.length ? `- ${t('avoid')}: ${a.avoid.join(', ')}` : ''}

NOTE: Prototype decision-support output generated from a SIMULATED scenario.
Not an official warning. To be validated and issued only by authorised
disaster-management authorities (DDMA/SDMA).`;
  }

  // ---------- printable report ----------
  function report(ctx) {
    const { st, res, ana, other, otherAna, img, scen } = ctx;
    const K = ana.kpi, F = FS.fmt;
    const rows = (arr, cols) => arr.map((r) => `<tr>${cols.map((c) => `<td>${c(r)}</td>`).join('')}</tr>`).join('');
    const pri = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>FloodSim HADR Report</title>
<style>body{font:12px/1.45 Arial,sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0}h2{font-size:14px;border-bottom:2px solid #0e7490;padding-bottom:3px;margin-top:22px}
table{border-collapse:collapse;width:100%;margin-top:6px}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#e8eef5}
.demo{background:#fff4d6;border:1px solid #e0a100;padding:8px;margin:10px 0;font-weight:bold}.kv td:first-child{width:220px;color:#444}img{max-width:100%;border:1px solid #999}
@media print{.noprint{display:none}}</style></head><body>
<button class="noprint" onclick="print()">Print / Save as PDF</button>
<h1>FloodSim HADR — Dam Break Inundation Scenario Report</h1>
<div>Generated ${new Date().toLocaleString('en-IN')} · SIH26161 prototype</div>
<div class="demo">SIMULATED DEMO RESULTS — produced by a browser-side parametric surrogate using a synthetic DEM and synthetic settlement data. No SPH / Delft3D / Google Earth Engine computation was performed. Not for operational use without validation by authorised agencies.</div>
<h2>1. Scenario</h2><table class="kv">
<tr><td>Scenario name</td><td>${scen}</td></tr><tr><td>River</td><td>Kosi (OSM centreline, ~81 km demo reach)</td></tr><tr><td>Dam</td><td>${D.dam.name}</td></tr>
<tr><td>Scenario type</td><td>${st.cfg.type}</td></tr><tr><td>Simulation time</td><td>${st.lastRun ? st.lastRun.toLocaleString('en-IN') : '—'} · duration ${st.cfg.duration} min</td></tr>
<tr><td>Model used</td><td>${st.cfg.model === 'both' ? 'SPH + Delft3D (comparison) — report primary: ' + res.model.name : res.model.name} (surrogate outputs)</td></tr>
<tr><td>Initial water level / breach width / formation time</td><td>${st.cfg.waterLevel} m / ${st.cfg.breachWidth} m / ${st.cfg.breachTime} min</td></tr>
<tr><td>Peak discharge (est.)</td><td>${F.n(res.Qp)} m³/s</td></tr><tr><td>DEM used</td><td>${st.cfg.terrain} → DEM Demo Dataset (synthetic)</td></tr><tr><td>Satellite source</td><td>${st.cfg.satellite} → Demo dataset</td></tr></table>
<h2>2. Key results</h2><table class="kv">
<tr><td>Maximum flood depth</td><td>${K.maxDepth.toFixed(2)} m</td></tr><tr><td>Maximum velocity</td><td>${K.maxVel.toFixed(2)} m/s</td></tr><tr><td>Inundated area</td><td>${K.area.toFixed(1)} km²</td></tr>
<tr><td>First flood arrival at a settlement</td><td>${F.min(K.firstArrival)}</td></tr><tr><td>Affected settlements / population (est.)</td><td>${K.villages} / ${F.n(K.population)}</td></tr>
<tr><td>Roads flooded / bridges at risk / critical assets</td><td>${K.roads} / ${K.bridges} / ${K.infra}</td></tr></table>
<h2>3. Map snapshot</h2><img src="${img}"/>
<h2>4. Affected settlements</h2><table><tr><th>Village</th><th>Panchayat</th><th>Depth</th><th>Arrival</th><th>Duration</th><th>Pop. (demo)</th><th>Risk</th><th>Safe zone</th></tr>
${rows(ana.villages.filter((v) => v.affected), [(v) => v.name, (v) => v.gp, (v) => v.depth.toFixed(2) + ' m', (v) => F.min(v.arrival), (v) => F.min(v.duration), (v) => F.n(v.pop), (v) => v.risk, (v) => v.safeZone || 'No safe route'])}</table>
<h2>5. Panchayat impact</h2><table><tr><th>Panchayat</th><th>Villages</th><th>Population</th><th>Area km²</th><th>Schools</th><th>PHCs</th><th>Roads</th><th>Bridges</th><th>Risk</th></tr>
${rows(ana.panchayats, [(g) => g.name, (g) => g.affectedVillages, (g) => F.n(g.population), (g) => g.area.toFixed(1), (g) => g.schools, (g) => g.health, (g) => g.roads, (g) => g.bridges, (g) => g.risk])}</table>
<h2>6. Infrastructure impact</h2><table><tr><th>Asset</th><th>Type</th><th>Depth</th><th>Arrival</th><th>Risk</th></tr>
${rows(ana.infra.filter((f) => f.depth > 0.05).concat(ana.bridges.filter((b) => b.risk !== 'LOW')), [(f) => f.name, (f) => f.type || 'bridge', (f) => F.m(f.depth), (f) => F.min(f.arrival), (f) => f.risk])}</table>
<h2>7. Evacuation analysis (simulated)</h2><table><tr><th>Village</th><th>Safe zone</th><th>Distance</th><th>Travel time</th><th>Route risk</th><th>Avoid</th></tr>
${rows(ana.villages.filter((v) => v.affected), [(v) => v.name, (v) => v.safeZone || '—', (v) => (v.evac.recommended ? v.evac.recommended.len.toFixed(1) + ' km' : '—'), (v) => (v.evac.recommended ? Math.round(v.evac.recommended.time) + ' min' : 'Shelter in place'), (v) => (v.evac.recommended ? v.evac.recommended.risk : 'NO ROUTE'), (v) => v.evac.avoidIds.join(', ') || '—'])}</table>
<p>Routes are simulated decision-support results, not officially approved evacuation routes.</p>
<h2>8. HADR priority (rule-based, weights: ${Object.entries(st.weights).map(([k, w]) => k + ' ' + w).join(', ')})</h2><table><tr><th>#</th><th>Location</th><th>Score</th><th>Priority</th><th>Population</th><th>Depth</th><th>Arrival</th></tr>
${rows(pri.map((v, i) => Object.assign({ rank: i + 1 }, v)), [(v) => v.rank, (v) => v.name, (v) => v.score.toFixed(0), (v) => v.priority, (v) => F.n(v.pop), (v) => v.depth.toFixed(2) + ' m', (v) => F.min(v.arrival)])}</table>
<h2>9. Model comparison (surrogate outputs)</h2><table><tr><th>Metric</th><th>${res.model.short}</th><th>${other.model.short}</th></tr>
<tr><td>Inundated area (km²)</td><td>${K.area.toFixed(1)}</td><td>${otherAna.kpi.area.toFixed(1)}</td></tr><tr><td>Max depth (m)</td><td>${K.maxDepth.toFixed(2)}</td><td>${otherAna.kpi.maxDepth.toFixed(2)}</td></tr>
<tr><td>Peak velocity (m/s)</td><td>${K.maxVel.toFixed(2)}</td><td>${otherAna.kpi.maxVel.toFixed(2)}</td></tr><tr><td>First arrival</td><td>${F.min(K.firstArrival)}</td><td>${F.min(otherAna.kpi.firstArrival)}</td></tr>
<tr><td>Affected villages</td><td>${K.villages}</td><td>${otherAna.kpi.villages}</td></tr></table>
<h2>10. Data sources</h2><p>Terrain: synthetic demo DEM (SRTM/ASTER not connected). River centreline: OpenStreetMap (ODbL), simplified. Settlements, panchayats, roads, bridges, infrastructure and safe zones: synthetic demo layers. Satellite: demo only (Sentinel/Landsat/GEE not connected). Basemaps: Esri tiles (Esri, HERE, Garmin, Maxar, © OpenStreetMap contributors).</p>
</body></html>`;
    return html;
  }

  FS.exporter = { download, stamp, geojson, kml, shpZip, mapSnapshot, sms, whatsapp, brief, report, DEMO };
})();
