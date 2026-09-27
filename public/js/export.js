/* FloodSim HADR — browser exports: PNG map snapshot, printable report, alert text (TEXT ONLY — nothing is sent). */
(function () {
  const A = FS.analysis;

  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');

  // ---------- PNG map snapshot (rendered locally from the scenario grid) ----------
  function mapSnapshot(scn, M, ana, t, title) {
    const g = scn.grid, S = Math.max(1, Math.min(4, Math.floor(1100 / g.cols))), W = g.cols * S, H = g.rows * S;
    const c = document.createElement('canvas'); c.width = W; c.height = H + 70;
    const x = c.getContext('2d');
    x.fillStyle = '#0b1424'; x.fillRect(0, 0, c.width, c.height);
    const draw = (url) => new Promise((ok) => { if (!url) return ok(); const im = new Image(); im.onload = () => { x.drawImage(im, 0, 0, W, H); ok(); }; im.src = url; });
    const px = (lat, lng) => [((lng - g.west) / g.dLng) * S, ((g.north - lat) / g.dLat) * S];
    const hs = FS.mapkit.renderHillshade(scn);
    return draw(hs && hs.url).then(() => draw(FS.mapkit.renderRaster(scn, M, 'depth', t, 0.85))).then(() => {
      x.strokeStyle = '#67e8f9'; x.lineWidth = 3; x.beginPath();
      scn.river.forEach((p, i) => { const [a, b] = px(p[0], p[1]); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.stroke();
      x.font = '600 12px Inter, sans-serif';
      ana.villages.filter((v) => v.affected || ana.villages.length < 60).forEach((v) => {
        const [a, b] = px(v.lat, v.lng);
        x.fillStyle = FS.mapkit.RISK_COL[v.risk]; x.beginPath(); x.arc(a, b, 5, 0, 7); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1.5; x.stroke();
        x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 3; x.fillText(v.name, a + 8, b + 4); x.shadowBlur = 0;
      });
      const [da, db] = px(scn.dam.lat, scn.dam.lng);
      x.fillStyle = '#fff'; x.fillRect(da - 7, db - 7, 14, 14); x.strokeStyle = '#ef4444'; x.lineWidth = 2; x.strokeRect(da - 7, db - 7, 14, 14);
      x.fillStyle = '#0e1828'; x.fillRect(0, H, W, 70);
      x.fillStyle = '#fff'; x.font = '700 15px Inter, sans-serif'; x.fillText(title, 12, H + 22);
      x.font = '11px Inter, sans-serif'; x.fillStyle = '#f5c46b';
      x.fillText(scn.mode === 'live' ? `SIMULATED (${M.engine}) on ${scn.grid.demSource}. Hypothetical scenario — validate before use.` : 'SIMULATED DEMO DATA — browser surrogate, synthetic DEM & settlements. Not for operational use.', 12, H + 40);
      FS.mapkit.PAL.depth.colors.forEach((col, i) => { x.fillStyle = col; x.fillRect(12 + i * 90, H + 50, 14, 10); x.fillStyle = '#cbd5e1'; x.fillText(FS.mapkit.PAL.depth.labels[i], 30 + i * 90, H + 60); });
      return c.toDataURL('image/png');
    });
  }

  // ---------- alerts ----------
  function alertData(scn, v) {
    const route = v.evac.recommended;
    const avoid = (v.evac.naive ? v.evac.naive.blocked : route ? route.blocked : []).map((e) => e.ref || e.id);
    return { sz: scn.features.safeZones.find((z) => z.id === v.safeZone), route, avoid: [...new Set(avoid)].slice(0, 3) };
  }
  const gname = (scn, v) => (scn.features.groups.find((p) => p.id === v.group) || { name: '—' }).name;
  function sms(scn, v, ana, lang) {
    const t = (k) => FS.t(k, lang), a = alertData(scn, v);
    const act = a.sz ? `${t('moveTo')} ${a.sz.id}${a.avoid.length ? '. ' + t('avoid') + ' ' + a.avoid.join(',') : ''}` : t('shelter');
    return `[${scn.mode === 'live' ? 'SIM' : 'DEMO'}] ${t('alertTitle')}: ${v.name}. ${t('arrival')} ~${Math.round(v.arrival)} ${t('minutes')}, ${t('depth')} ${v.depth.toFixed(1)}m, ${t('risk')} ${v.risk}. ${act}. -FloodSim(sim)`;
  }
  function whatsapp(scn, v, ana, lang) {
    const t = (k) => FS.t(k, lang), a = alertData(scn, v);
    let s = `*🚨 ${t('alertTitle')}*\n\n*${t('village')}:* ${v.name} (${gname(scn, v)})\n*${t('arrival')}:* ~${Math.round(v.arrival)} ${t('minutes')}\n*${t('depth')}:* ${v.depth.toFixed(1)} m\n*${t('risk')}:* ${v.risk}\n\n*${t('action')}:*\n`;
    if (a.sz) s += `➡️ ${t('moveTo')} *${a.sz.name}*\n` + (a.route ? `🛣️ ${a.route.len.toFixed(1)} km, ~${Math.round(a.route.time)} ${t('minutes')}\n` : '') + (a.avoid.length ? `⛔ ${t('avoid')}: ${a.avoid.join(', ')}\n` : '');
    else s += `⚠️ ${t('shelter')}\n`;
    return s + `\n_${t('demoAlert')}_`;
  }
  function brief(scn, v, ana, lang) {
    const a = alertData(scn, v), t = (k) => FS.t(k, lang);
    const roads = a.route ? [...new Set(a.route.edges.filter((e) => e.cls !== 'village').map((e) => e.name))].join(' -> ') : 'n/a';
    return `EMERGENCY BRIEF — ${t('alertTitle')} (SIMULATED SCENARIO)
==================================================
Scenario           : ${scn.name}
${t('village')}           : ${v.name}
Group / Panchayat  : ${gname(scn, v)}
Population         : ${(v.pop || 0).toLocaleString('en-IN')}  [${v.popSource}]
${t('arrival')}      : T+${Math.round(v.arrival)} min after breach initiation
${t('depth')}      : ${v.depth.toFixed(2)} m
Flood duration     : ${Math.round(v.duration)} min
${t('risk')}               : ${v.risk}     HADR priority: ${v.priority} (${v.score.toFixed(0)}/100)
Critical assets    : ${v.infra.map((f) => f.name).join('; ') || 'none recorded'}

${t('action')}:
${a.sz ? `- ${t('moveTo')}: ${a.sz.name}\n- Route: ${roads}\n- Distance ${a.route ? a.route.len.toFixed(1) : '-'} km, travel ~${a.route ? Math.round(a.route.time) : '-'} min (vehicle)` : '- ' + t('shelter')}
${a.avoid.length ? `- ${t('avoid')}: ${a.avoid.join(', ')}` : ''}

NOTE: Prototype decision-support output generated from a SIMULATED scenario.
Not an official warning. To be validated and issued only by authorised
disaster-management authorities (DDMA/SDMA).`;
  }

  // ---------- printable report ----------
  function report(ctx) {
    const { st, scn, M, ana, other, otherAna, img, name } = ctx;
    const K = ana.kpi, F = FS.fmt, Ko = otherAna.kpi, d = scn.dam, dmg = K.damage;
    const rows = (arr, cols) => arr.map((r) => `<tr>${cols.map((c) => `<td>${c(r)}</td>`).join('')}</tr>`).join('');
    const pri = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score);
    const live = scn.mode === 'live';
    const esc = F.esc;
    return `<!doctype html><html><head><meta charset="utf-8"><title>FloodSim HADR Report</title>
<style>body{font:12px/1.45 Arial,sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0}h2{font-size:14px;border-bottom:2px solid #0e7490;padding-bottom:3px;margin-top:22px}
table{border-collapse:collapse;width:100%;margin-top:6px}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#e8eef5}
.demo{background:#fff4d6;border:1px solid #e0a100;padding:8px;margin:10px 0;font-weight:bold}.kv td:first-child{width:240px;color:#444}img{max-width:100%;border:1px solid #999}
@media print{.noprint{display:none}}</style></head><body>
<button class="noprint" onclick="print()">Print / Save as PDF</button>
<h1>FloodSim HADR — Dam Break Inundation Scenario Report</h1>
<div>Generated ${new Date().toLocaleString('en-IN')} · SIH26161 prototype</div>
<div class="demo">${live ? 'SIMULATED SCENARIO — computed by in-house numerical solvers (SPH-SWE particle model and 2D finite-volume shallow-water model) on SRTM-derived terrain with OpenStreetMap exposure data. The dam failure is hypothetical and breach parameters are empirical estimates. Not for operational use without validation by authorised agencies.' : 'SIMULATED DEMO RESULTS — produced by a browser-side parametric surrogate using a synthetic DEM and synthetic settlement data. No numerical solver was run.'}</div>
<h2>1. Scenario</h2><table class="kv">
<tr><td>Scenario name</td><td>${esc(name)}</td></tr><tr><td>River</td><td>${esc(d.river || '—')} (${esc(scn.riverSource || '')})</td></tr><tr><td>Dam</td><td>${esc(d.name)} ${d.qid ? '(Wikidata ' + d.qid + ')' : ''} — ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}</td></tr>
<tr><td>Scenario type</td><td>${esc(scn.config.type)}</td></tr><tr><td>Simulation time</td><td>${new Date(scn.createdAt).toLocaleString('en-IN')} · duration ${scn.config.duration} min</td></tr>
<tr><td>Model used (this report)</td><td>${esc(M.name)} — ${esc(M.engine)}</td></tr>
<tr><td>Head / storage released</td><td>${F.n(scn.config.waterLevel ?? d.heightM)} m / ${F.n(scn.config.storage)} MCM</td></tr>
<tr><td>Breach width / formation time / peak Q</td><td>${F.n(scn.config.breachWidth)} m / ${F.n(scn.config.breachTime)} min / ${F.n(M.Qp)} m³/s</td></tr>
<tr><td>Grid</td><td>${scn.grid.cols} × ${scn.grid.rows} cells, ${Math.round(scn.grid.dx)} × ${Math.round(scn.grid.dy)} m</td></tr>
<tr><td>DEM used</td><td>${esc(scn.grid.demSource)}</td></tr><tr><td>Satellite source</td><td>${live ? 'NASA GIBS MODIS/VIIRS (NRT page); Sentinel-1 GEE script generated' : 'Demo'}</td></tr></table>
<h2>2. Key results</h2><table class="kv">
<tr><td>Maximum flood depth</td><td>${K.maxDepth.toFixed(2)} m</td></tr><tr><td>Maximum velocity</td><td>${K.maxVel.toFixed(2)} m/s</td></tr><tr><td>Inundated area</td><td>${K.area.toFixed(1)} km²</td></tr>
<tr><td>First flood arrival at a settlement</td><td>${F.min(K.firstArrival)}</td></tr><tr><td>Affected settlements / population</td><td>${K.villages} / ${F.n(K.population)}</td></tr>
<tr><td>Roads flooded / bridges at risk / critical assets</td><td>${K.roads} / ${K.bridges} / ${K.infra}</td></tr>
<tr><td>Indicative loss (buildings + crops)</td><td>${F.inr(dmg.buildingLossINR)} + ${F.inr(dmg.cropLossINR)} — ${esc(dmg.method)}</td></tr></table>
<h2>3. Map snapshot</h2><img src="${img}"/>
<h2>4. Affected settlements</h2><table><tr><th>Village</th><th>Group</th><th>Depth</th><th>Arrival</th><th>Duration</th><th>Population</th><th>Risk</th><th>Safe zone</th></tr>
${rows(ana.villages.filter((v) => v.affected).slice(0, 200), [(v) => esc(v.name), (v) => esc(gname(scn, v)), (v) => v.depth.toFixed(2) + ' m', (v) => F.min(v.arrival), (v) => F.min(v.duration), (v) => F.n(v.pop) + ' (' + v.popSource + ')', (v) => v.risk, (v) => esc(v.safeZone || 'No safe route')])}</table>
<h2>5. Group / panchayat impact</h2><table><tr><th>Group</th><th>Villages</th><th>Population</th><th>Area km²</th><th>Schools</th><th>Health</th><th>Roads</th><th>Bridges</th><th>Risk</th></tr>
${rows(ana.panchayats.filter((g) => g.affectedVillages), [(g) => esc(g.name), (g) => g.affectedVillages, (g) => F.n(g.population), (g) => g.area.toFixed(1), (g) => g.schools, (g) => g.health, (g) => g.roads, (g) => g.bridges, (g) => g.risk])}</table>
<h2>6. Infrastructure impact</h2><table><tr><th>Asset</th><th>Type</th><th>Depth</th><th>Arrival</th><th>Risk</th></tr>
${rows(ana.infra.filter((f) => f.depth > 0.05).concat(ana.bridges.filter((b) => b.risk !== 'LOW')).slice(0, 200), [(f) => esc(f.name), (f) => f.type || 'bridge', (f) => F.m(f.depth), (f) => F.min(f.arrival), (f) => f.risk])}</table>
<h2>7. Evacuation analysis (simulated)</h2><table><tr><th>Village</th><th>Safe zone</th><th>Distance</th><th>Travel time</th><th>Route risk</th></tr>
${rows(ana.villages.filter((v) => v.affected).slice(0, 200), [(v) => esc(v.name), (v) => esc(v.safeZone || '—'), (v) => (v.evac.recommended ? v.evac.recommended.len.toFixed(1) + ' km' : '—'), (v) => (v.evac.recommended ? Math.round(v.evac.recommended.time) + ' min' : 'Shelter in place'), (v) => (v.evac.recommended ? v.evac.recommended.risk : 'NO ROUTE')])}</table>
<p>Routes are simulated decision-support results, not officially approved evacuation routes.</p>
<h2>8. HADR priority (weights: ${Object.entries(st.weights).map(([k, w]) => k + ' ' + w).join(', ')})</h2><table><tr><th>#</th><th>Location</th><th>Score</th><th>Priority</th><th>Population</th><th>Depth</th><th>Arrival</th></tr>
${rows(pri.slice(0, 100).map((v, i) => Object.assign({ rank: i + 1 }, v)), [(v) => v.rank, (v) => esc(v.name), (v) => v.score.toFixed(0), (v) => v.priority, (v) => F.n(v.pop), (v) => v.depth.toFixed(2) + ' m', (v) => F.min(v.arrival)])}</table>
<h2>9. Model comparison</h2><table><tr><th>Metric</th><th>${esc(M.short)}</th><th>${esc(other.short)}</th></tr>
<tr><td>Inundated area (km²)</td><td>${K.area.toFixed(1)}</td><td>${Ko.area.toFixed(1)}</td></tr><tr><td>Max depth (m)</td><td>${K.maxDepth.toFixed(2)}</td><td>${Ko.maxDepth.toFixed(2)}</td></tr>
<tr><td>Peak velocity (m/s)</td><td>${K.maxVel.toFixed(2)}</td><td>${Ko.maxVel.toFixed(2)}</td></tr><tr><td>First arrival</td><td>${F.min(K.firstArrival)}</td><td>${F.min(Ko.firstArrival)}</td></tr>
<tr><td>Affected villages</td><td>${K.villages}</td><td>${Ko.villages}</td></tr>
${live ? `<tr><td>Solver runtime / mass error</td><td>${(M.stats.runtimeMs / 1000).toFixed(1)} s / ${(+M.stats.massErrorPct).toFixed(2)} %</td><td>${(other.stats.runtimeMs / 1000).toFixed(1)} s / ${(+other.stats.massErrorPct).toFixed(2)} %</td></tr>` : ''}</table>
<h2>10. Data sources</h2><table><tr><th>Input</th><th>Source</th><th>Status</th></tr>${(scn.sources || []).map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>
<p>Basemaps: Esri tiles (Esri, HERE, Garmin, Maxar, © OpenStreetMap contributors). OpenStreetMap data © OpenStreetMap contributors (ODbL). Wikidata (CC0). NASA EOSDIS GIBS.</p>
</body></html>`;
  }

  FS.exporter = { download, stamp, mapSnapshot, sms, whatsapp, brief, report };
})();
