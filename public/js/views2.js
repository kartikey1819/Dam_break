/* FloodSim HADR — page views (part 2). */
(function () {
  const A = FS.analysis, D = FS.data, F = FS.fmt, U = FS.ui, V = FS.views;
  const st = () => FS.state;
  const T = (k) => FS.t(k);
  const gpLabel = () => (FS.app.isLive() ? 'Group' : 'Panchayat');

  // ---------- IMPACT ANALYSIS ----------
  V.impact = function (view) {
    const s = st(), scn = s.scn, { ana, M } = FS.app.cur(), K = ana.kpi, dmg = K.damage;
    const f = (s.impactFilter = s.impactFilter || { type: 'all', risk: 'all', gp: 'all' });
    const usedSZ = new Set(ana.villages.filter((v) => v.affected && v.safeZone).map((v) => v.safeZone));
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_impact')}</h1><p>Village, ${gpLabel().toLowerCase()} and infrastructure impact from the active model (${F.esc(M.name)}).</p></div>${U.demo()}</div>
    <div class="kpis mb">${[
      U.kpi(T('population'), F.n(K.population), '', 'amber'), U.kpi(T('villages'), K.villages, `/ ${scn.features.villages.length}`, 'amber'), U.kpi(FS.app.isLive() ? 'Affected groups' : T('panchayats'), K.panchayats, `/ ${scn.features.groups.length}`),
      U.kpi(T('roads'), K.roads, `seg · ${F.n(K.roadKm)} km`, 'red'), U.kpi(T('bridges'), K.bridges, '', 'red'), U.kpi(T('agri'), F.n(K.agriArea), 'km²', 'green'),
      U.kpi(T('infra'), K.infra, '', 'red'), U.kpi('Evacuation zones in use', usedSZ.size, `/ ${scn.features.safeZones.length}`, 'green')].join('')}</div>
    <div class="card mb"><h3>Loss &amp; damage estimate <span class="tag tag-sim">INDICATIVE</span></h3>
      <div class="kpis">${U.kpi('Households exposed', F.n(dmg.houses), '', 'amber')}${U.kpi('Households damaged', F.n(dmg.housesDamaged), '', 'red')}${U.kpi('Building loss', F.inr(dmg.buildingLossINR), '', 'red')}${U.kpi('Flooded cropland', F.n(dmg.cropHa), 'ha', 'green')}${U.kpi('Crop loss', F.inr(dmg.cropLossINR), '', 'amber')}</div>
      <div class="dim" style="font-size:11px;margin-top:6px">${F.esc(dmg.method)}. Assumptions: ${dmg.assumptions.personsPerHousehold} persons/household, ₹${F.n(dmg.assumptions.valuePerHouseINR)} per house, ₹${F.n(dmg.assumptions.cropValuePerHaINR)}/ha crop value, ${Math.round(dmg.assumptions.cropFraction * 100)}% of flooded land assumed cropland. ${FS.app.isLive() ? 'Population from OSM tags where present, otherwise place-type defaults.' : 'Synthetic demo population.'}</div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      <div class="card"><h3>Ranked impact register</h3>
        <div class="row wrap mb" style="gap:8px"><div class="seg" id="ftype">${[['all', 'All'], ['village', 'Villages'], ['panchayat', gpLabel() + 's'], ['road', 'Roads'], ['bridge', 'Bridges'], ['infra', 'Infrastructure']].map(([k, l]) => `<button data-v="${k}" class="${f.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <select id="frisk" style="width:auto">${['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((r) => `<option value="${r}" ${f.risk === r ? 'selected' : ''}>${r === 'all' ? 'All risk levels' : r}</option>`).join('')}</select>
        <select id="fgp" style="width:auto"><option value="all">All ${gpLabel().toLowerCase()}s</option>${scn.features.groups.map((p) => `<option value="${p.id}" ${f.gp === p.id ? 'selected' : ''}>${F.esc(p.name)}</option>`).join('')}</select></div>
        <div class="tbl-wrap" style="max-height:470px"><table class="tbl" id="reg"></table></div></div>
      <div class="card" id="vdet"></div>
    </div>
    <div class="card mt"><h3>${gpLabel()}-level summary ${U.demo()}</h3>${FS.app.isLive() ? '<div class="dim mb" style="font-size:11px">Gram Panchayat boundaries are not available in open data; settlements are grouped by nearest town. Connect LGD / Bhuvan panchayat boundaries in production.</div>' : ''}<div class="tbl-wrap"><table class="tbl" id="gpt"></table></div></div>`;
    const assets = [];
    ana.villages.forEach((v) => assets.push({ kind: 'village', id: v.id, name: v.name, sub: v.place ? v.place[0].toUpperCase() + v.place.slice(1) : 'Village', gp: v.group, dist: v.distRiver, depth: v.depth, arr: v.arrival, risk: v.risk }));
    ana.panchayats.forEach((g) => g.villages.length && assets.push({ kind: 'panchayat', id: g.id, name: g.name, sub: g.kind || gpLabel(), gp: g.id, dist: Math.min(...g.villages.map((v) => v.distRiver ?? 1e9)), depth: Math.max(...g.villages.map((v) => v.depth)), arr: Math.min(...g.villages.map((v) => v.arrival)), risk: g.risk }));
    ana.infra.forEach((x) => assets.push({ kind: 'infra', id: x.id, name: x.name, sub: FS.mapkit.INFRA_NAME[x.type] || x.type, gp: x.group, dist: x.distRiver, depth: x.depth, arr: x.arrival, risk: x.risk }));
    ana.bridges.forEach((b) => assets.push({ kind: 'bridge', id: b.id, name: b.name, sub: b.status, gp: b.group, dist: b.distRiver, depth: b.depth, arr: b.arrival, risk: b.risk === 'LOW' ? 'NONE' : b.risk }));
    scn.features.roads.edges.forEach((e) => { const ev = ana.roadEval[e.id]; if (e.crossing || e.cls === 'village' || !(ev.maxDepth > 0.05)) return; assets.push({ kind: 'road', id: e.id, name: e.name, sub: `${ev.status} · ${e.len.toFixed(1)} km`, gp: null, dist: null, depth: ev.maxDepth, arr: ev.arrival, risk: ev.blocked ? (ev.maxDepth > 1 ? 'CRITICAL' : 'HIGH') : 'MEDIUM' }); });
    const drawReg = () => {
      const rows = assets.filter((a) => (f.type === 'all' || a.kind === f.type) && (f.risk === 'all' || a.risk === f.risk) && (f.gp === 'all' || a.gp === f.gp) && a.risk !== 'NONE').sort((a, b) => A.RISK_ORDER[b.risk] - A.RISK_ORDER[a.risk] || a.arr - b.arr);
      view.querySelector('#reg').innerHTML = `<tr><th>Asset</th><th>Type</th><th class="num">Dist. river</th><th class="num">Depth</th><th class="num">Arrival</th><th>Risk</th></tr>` +
        (rows.slice(0, 400).map((a) => `<tr class="${a.kind === 'village' ? 'click' : ''} ${s.selVillage === a.id ? 'sel' : ''}" data-v="${a.kind === 'village' ? a.id : ''}"><td>${F.esc(a.name)}</td><td class="muted">${F.esc(a.sub)}</td><td class="num">${F.km(a.dist)}</td><td class="num">${F.m(a.depth)}</td><td class="num">${isFinite(a.arr) ? Math.round(a.arr) + ' min' : '—'}</td><td>${U.risk(a.risk)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No affected assets match the filter.</td></tr>');
    };
    const drawVillage = () => {
      const v = ana.villages.find((x) => x.id === s.selVillage) || ana.villages.filter((x) => x.affected).sort((a, b) => b.score - a.score)[0] || ana.villages[0];
      if (!v) { view.querySelector('#vdet').innerHTML = '<h3>Village-level flood impact</h3><div class="muted">No settlements in the model domain.</div>'; return; }
      s.selVillage = v.id;
      const sz = scn.features.safeZones.find((z) => z.id === v.safeZone);
      view.querySelector('#vdet').innerHTML = `<h3>Village-level flood impact ${v.popSource === 'DEMO' ? U.demo('DEMO') : '<span class="tag tag-real">OSM</span>'}</h3>
        <div class="row between"><div><div style="font-size:18px;font-weight:700">${F.esc(v.name)}</div><div class="muted">${F.esc(U.groupName(v.group))}</div></div>${U.risk(v.risk)}</div>
        <div class="kpis mt" style="grid-template-columns:1fr 1fr">${U.kpi('Flood depth', v.depth.toFixed(2), 'm', 'red')}${U.kpi('Arrival time', v.affected ? Math.round(v.arrival) : '—', 'min', 'red')}${U.kpi('Flood duration', v.affected ? F.min(v.duration) : '—', '')}${U.kpi('Population', F.n(v.pop), v.popSource === 'ESTIMATE' ? 'est.' : '', 'amber')}${U.kpi('Distance from river', v.distRiver != null ? v.distRiver.toFixed(1) : '—', 'km')}${U.kpi('Distance from dam', v.distDam != null ? v.distDam.toFixed(0) : '—', 'km')}</div>
        <div class="mt"><div class="muted" style="font-size:12px">Nearby safe location</div><div style="font-weight:600">${sz ? F.esc(sz.name) : v.affected ? 'No road route before flood arrival — vertical evacuation / shelter advised' : 'Not affected'}</div>
        ${v.evac.recommended ? `<div class="muted" style="font-size:12px">${v.evac.recommended.len.toFixed(1)} km · ~${Math.round(v.evac.recommended.time)} min by vehicle · route risk ${U.risk(v.evac.recommended.risk)}</div>` : ''}</div>
        <div class="mt"><div class="muted" style="font-size:12px">Critical assets near the village</div>${v.infra.length ? v.infra.map((x) => `<div class="row between" style="font-size:12.5px;padding:3px 0"><span>${F.esc(x.name)}</span>${U.risk(x.risk)}</div>`).join('') : '<div class="dim">None recorded</div>'}</div>
        <div class="row mt" style="gap:6px"><button class="btn btn-sm" data-act="evac" data-id="${v.id}">Plan evacuation</button><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>
        <div class="dim mt" style="font-size:11px">HADR priority ${U.risk(v.priority)} (${v.score.toFixed(0)}/100) · hazard rating ${v.hazard.toFixed(2)}</div>`;
    };
    view.querySelector('#gpt').innerHTML = `<tr><th>${gpLabel()}</th><th class="num">Affected villages</th><th class="num">Population</th><th class="num">Schools</th><th class="num">Health</th><th class="num">Roads</th><th class="num">Bridges</th><th class="num">Flood area</th><th>Risk</th><th>HADR priority</th></tr>` +
      ana.panchayats.filter((g) => g.villages.length).sort((a, b) => b.priorityScore - a.priorityScore).map((g) => `<tr class="click" data-gp="${g.id}"><td>${F.esc(g.name)}</td><td class="num">${g.affectedVillages} / ${g.villages.length}</td><td class="num">${F.n(g.population)}</td><td class="num">${g.schools}</td><td class="num">${g.health}</td><td class="num">${g.roads}</td><td class="num">${g.bridges}</td><td class="num">${g.area.toFixed(1)} km²</td><td>${U.risk(g.risk)}</td><td>${U.risk(g.priority)}</td></tr>`).join('');
    view.querySelector('#gpt').onclick = (e) => { const r = e.target.closest('[data-gp]'); if (r) { f.gp = r.dataset.gp; V.impact(view); } };
    view.querySelector('#ftype').onclick = (e) => { const b = e.target.closest('button'); if (b) { f.type = b.dataset.v; view.querySelectorAll('#ftype button').forEach((x) => x.classList.toggle('on', x === b)); drawReg(); } };
    view.querySelector('#frisk').onchange = (e) => { f.risk = e.target.value; drawReg(); };
    view.querySelector('#fgp').onchange = (e) => { f.gp = e.target.value; drawReg(); };
    view.querySelector('#reg').onclick = (e) => { const r = e.target.closest('tr[data-v]'); if (r && r.dataset.v) { s.selVillage = r.dataset.v; drawReg(); drawVillage(); } };
    drawReg(); drawVillage();
  };

  // ---------- NEAR-REAL-TIME ANALYSIS ----------
  const GIBS = { modis721: ['MODIS_Terra_CorrectedReflectance_Bands721', 'MODIS Terra 7-2-1 (water = dark blue/black)'], modistc: ['MODIS_Terra_CorrectedReflectance_TrueColor', 'MODIS Terra true colour'], viirs: ['VIIRS_SNPP_CorrectedReflectance_TrueColor', 'VIIRS SNPP true colour'] };
  const gibsUrl = (layer, date) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
  // MODIS 7-2-1 water detection on a grid (browser, CORS-enabled GIBS tiles)
  async function detectWater(scn, date) {
    const g = scn.grid, z = 9, TS = 256, n = 2 ** z;
    const px = (lat, lng) => [((lng + 180) / 360) * n * TS, ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n * TS];
    const [x0, y0] = px(g.north, g.west), [x1, y1] = px(g.north - g.rows * g.dLat, g.west + g.cols * g.dLng);
    const tx0 = Math.floor(x0 / TS), tx1 = Math.floor(x1 / TS), ty0 = Math.floor(y0 / TS), ty1 = Math.floor(y1 / TS);
    const cv = document.createElement('canvas'); cv.width = (tx1 - tx0 + 1) * TS; cv.height = (ty1 - ty0 + 1) * TS;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const tiles = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) tiles.push(new Promise((ok, bad) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { cx.drawImage(im, (tx - tx0) * TS, (ty - ty0) * TS); ok(); }; im.onerror = () => bad(new Error('GIBS tile unavailable')); im.src = gibsUrl(GIBS.modis721[0], date).replace('{z}', z).replace('{x}', tx).replace('{y}', ty); }));
    await Promise.all(tiles);
    const data = cx.getImageData(0, 0, cv.width, cv.height).data;
    const obs = new Uint8Array(g.n); let cloud = 0, water = 0, valid = 0;
    for (let i = 0; i < g.n; i++) {
      const [la, ln] = A.cellCenter(g, i), [X, Y] = px(la, ln);
      const o = (Math.floor(Y - ty0 * TS) * cv.width + Math.floor(X - tx0 * TS)) * 4;
      const r = data[o], gg = data[o + 1], b = data[o + 2];
      if (r + gg + b < 8) continue; // no data
      valid++;
      if ((b > 150 && gg > 150) || (r > 170 && gg > 170 && b > 170)) { cloud++; continue; }
      if (r < 55 && gg < 75 && b >= r - 5) { obs[i] = 1; water++; }
    }
    return { obs, cloudPct: valid ? (cloud / valid) * 100 : 100, waterKm2: water * g.cellArea, tiles: tiles.length };
  }
  V.nrt = function (view) {
    const s = st(), scn = s.scn, { M } = FS.app.cur(), live = FS.app.isLive();
    const nrt = (s.nrt = s.nrt || { before: '', after: '', layer: 'modis721' });
    const ev = new Date(scn.config.eventDate || Date.now());
    if (!nrt.before) { nrt.after = (scn.config.eventDate || new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)); nrt.before = new Date(ev.getTime() - 30 * 864e5).toISOString().slice(0, 10); }
    view.innerHTML = `<div class="page-head"><div><h1>NEAR-REAL-TIME FLOOD ANALYSIS</h1><p>Real date-specific satellite imagery (NASA GIBS, MODIS/VIIRS), water detection, change detection and simulation-vs-observation comparison.</p></div><span class="tag tag-real">NASA GIBS · OPEN DATA</span></div>
    <div class="note info mb">Imagery is real (NASA EOSDIS GIBS, daily MODIS/VIIRS, 250–500 m). Water detection runs in your browser on the MODIS 7-2-1 composite (dark SWIR+NIR = water, clouds excluded). Google Earth Engine is <b>not connected</b>; a ready-to-run Sentinel-1 GEE script is generated for each live scenario. Simulated floods are hypothetical, so overlap with observed water is only meaningful for real event dates.</div>
    <div class="card mb"><div class="row wrap" style="gap:10px">
      <div class="field" style="margin:0"><label>Before date</label><input type="text" id="nb" value="${nrt.before}" style="width:130px"/></div>
      <div class="field" style="margin:0"><label>After date</label><input type="text" id="na" value="${nrt.after}" style="width:130px"/></div>
      <div class="field" style="margin:0"><label>Product</label><select id="nl">${Object.entries(GIBS).map(([k, v]) => `<option value="${k}" ${nrt.layer === k ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Historic event presets</label><select id="np"><option value="">—</option><option value="2008-08-01|2008-08-28">Kosi embankment breach, Aug 2008</option><option value="2021-01-25|2021-02-08">Rishi Ganga / Chamoli flash flood, Feb 2021</option><option value="2014-08-20|2014-09-10">Kashmir valley floods, Sep 2014</option><option value="2023-10-01|2023-10-05">Teesta / South Lhonak GLOF, Oct 2023</option></select></div>
      <button class="btn" id="napply">Load imagery</button><button class="btn btn-primary" id="ndetect">Detect water (MODIS 7-2-1)</button>
      <div class="seg" id="nmode"><button data-v="ba" class="on">Before / After</button><button data-v="sim">Simulation vs Observation</button><button data-v="chg">Change detection</button></div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px">
      <div class="map-wrap" id="nmap" style="height:560px"></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="card"><h3>Detected water</h3><div id="nstat" class="muted" style="font-size:12px">Run "Detect water" to classify the before and after images over the model domain.</div></div>
        <div class="card"><h3>Simulation vs observation</h3><div id="nval" class="muted" style="font-size:12px">Metrics appear after detection. They compare the ${F.esc(M.short)} simulated extent with water observed on the after date.</div></div>
        <div class="card"><h3>Data sources</h3><table class="tbl">${[['NASA GIBS MODIS / VIIRS imagery', 'REAL'], ['Browser water classification (7-2-1)', 'DERIVED'], ['Sentinel-1 SAR via Google Earth Engine', 'SCRIPT'], ['Landsat 8/9 via GEE', 'NC'], ['Rainfall (IMD / GPM IMERG)', 'NC']].map(([a, b]) => `<tr><td>${a}</td><td>${{ REAL: '<span class="tag tag-real">REAL</span>', DERIVED: '<span class="tag tag-sim">DERIVED</span>', SCRIPT: '<span class="tag tag-demo">SCRIPT GENERATED</span>', NC: '<span class="tag tag-nc">NOT CONNECTED</span>' }[b]}</td></tr>`).join('')}</table></div>
      </div>
    </div>
    <div class="card mt"><h3>Google Earth Engine pipeline — Sentinel-1 SAR flood mapping ${live ? '<a class="btn btn-sm" href="' + FS.api.exportUrl(scn.id, 'gee') + '">Download script</a>' : ''}</h3><textarea rows="12" readonly id="gee">${live ? 'Loading…' : '// Run a live scenario on the backend to generate a GEE script for its model domain and event date.'}</textarea></div>`;
    if (live) FS.api.get(`/api/scenarios/${scn.id}/export/gee`).then((t) => (view.querySelector('#gee').value = t)).catch(() => {});
    const wrap = view.querySelector('#nmap');
    const mv = U.mountMap(wrap, { tools: true, modes: false, legend: false, basemap: 'dark', layers: { river: true, dam: true, villages: true, labels: true } });
    mv.update({ scn, M: null, ana: null, t: 0 });
    const map = mv.map;
    const beforePane = map.createPane('beforePane'); beforePane.style.zIndex = 300;
    const pane = map.createPane('afterPane'); pane.style.zIndex = 420;
    const grpB = L.layerGroup().addTo(map), grp = L.layerGroup().addTo(map);
    let ratio = 0.5, mode = 'ba', det = null;
    const handle = document.createElement('div'); handle.className = 'curtain-handle'; wrap.appendChild(handle);
    const lblL = document.createElement('div'); lblL.className = 'curtain-lbl'; lblL.style.left = '60px'; wrap.appendChild(lblL);
    const lblR = document.createElement('div'); lblR.className = 'curtain-lbl'; lblR.style.right = '10px'; lblR.style.top = '52px'; wrap.appendChild(lblR);
    const clip = () => {
      const size = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
      const x = map.containerPointToLayerPoint([size.x * ratio, 0]).x;
      pane.style.clip = mode === 'ba' ? `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)` : 'auto';
      handle.style.left = `calc(${ratio * 100}% - 1px)`; handle.style.display = mode === 'ba' ? '' : 'none';
    };
    const B = FS.mapkit.gridBounds(scn.grid);
    const draw = () => {
      grpB.clearLayers(); grp.clearLayers();
      const lay = GIBS[nrt.layer][0];
      if (s.online) L.tileLayer(gibsUrl(lay, nrt.before), { pane: 'beforePane', maxNativeZoom: 9, maxZoom: 14, attribution: 'NASA EOSDIS GIBS' }).addTo(grpB);
      if (mode === 'ba') {
        if (s.online) L.tileLayer(gibsUrl(lay, nrt.after), { pane: 'afterPane', maxNativeZoom: 9, maxZoom: 14 }).addTo(grp);
        if (det) L.imageOverlay(FS.mapkit.renderCats(scn, (i) => (det.after.obs[i] ? [34, 211, 238, 170] : null)), B, { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = `BEFORE · ${nrt.before}`; lblR.textContent = `AFTER · ${nrt.after}${det ? ' · detected water' : ''}`;
      } else if (mode === 'sim') {
        const obs = det ? det.after.obs : null;
        L.imageOverlay(FS.mapkit.renderCats(scn, (i) => { const a = M.dmax[i] > 0.05 && !(scn.channel && scn.channel[i]), b = obs && obs[i]; return a && b ? [34, 197, 94, 185] : a ? [249, 115, 22, 185] : b ? [232, 121, 249, 185] : null; }), B, { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = '■ green both  ■ orange simulated only  ■ pink observed only'; lblR.textContent = obs ? `SIMULATED vs OBSERVED (${nrt.after})` : 'SIMULATED EXTENT (run detection for observed)';
      } else {
        if (det) L.imageOverlay(FS.mapkit.renderCats(scn, (i) => (det.before.obs[i] && det.after.obs[i] ? [59, 130, 246, 200] : det.after.obs[i] ? [239, 68, 68, 190] : det.before.obs[i] ? [148, 163, 184, 150] : null)), B, { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = '■ blue persistent water  ■ red new water  ■ grey receded'; lblR.textContent = det ? 'CHANGE DETECTION (MODIS)' : 'Run detection first';
      }
      clip();
    };
    map.on('move zoom resize', clip);
    let drag = false;
    handle.addEventListener('pointerdown', (e) => { drag = true; handle.setPointerCapture(e.pointerId); L.DomEvent.stop(e); map.dragging.disable(); });
    handle.addEventListener('pointermove', (e) => { if (!drag) return; const r = wrap.getBoundingClientRect(); ratio = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); clip(); });
    handle.addEventListener('pointerup', () => { drag = false; map.dragging.enable(); });
    view.querySelector('#nmode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v; view.querySelectorAll('#nmode button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    view.querySelector('#np').onchange = (e) => { if (!e.target.value) return; const [a, b] = e.target.value.split('|'); view.querySelector('#nb').value = a; view.querySelector('#na').value = b; };
    view.querySelector('#napply').onclick = () => { nrt.before = view.querySelector('#nb').value.trim(); nrt.after = view.querySelector('#na').value.trim(); nrt.layer = view.querySelector('#nl').value; det = null; draw(); };
    view.querySelector('#ndetect').onclick = async () => {
      nrt.before = view.querySelector('#nb').value.trim(); nrt.after = view.querySelector('#na').value.trim();
      if (!s.online) return FS.app.toast('Imagery requires an internet connection');
      view.querySelector('#nstat').textContent = 'Downloading MODIS tiles and classifying…';
      try {
        const [b, a] = await Promise.all([detectWater(scn, nrt.before), detectWater(scn, nrt.after)]);
        det = { before: b, after: a };
        let neww = 0, perm = 0; for (let i = 0; i < scn.grid.n; i++) { if (a.obs[i] && !b.obs[i]) neww++; if (a.obs[i] && b.obs[i]) perm++; }
        view.querySelector('#nstat').innerHTML = `<div class="kpis" style="grid-template-columns:1fr 1fr">${U.kpi('Water before', F.n(b.waterKm2), 'km²', 'cyan')}${U.kpi('Water after', F.n(a.waterKm2), 'km²', 'cyan')}${U.kpi('New water (change)', F.n(neww * scn.grid.cellArea), 'km²', 'red')}${U.kpi('Persistent water', F.n(perm * scn.grid.cellArea), 'km²')}${U.kpi('Cloud (before)', b.cloudPct.toFixed(0), '%')}${U.kpi('Cloud (after)', a.cloudPct.toFixed(0), '%', a.cloudPct > 40 ? 'amber' : '')}</div><div class="dim" style="font-size:11px;margin-top:6px">MODIS 250–500 m; cloud-covered pixels are excluded, so cloudy dates under-report water.</div>`;
        const cmp = A.compareMasks(scn, M, a.obs);
        view.querySelector('#nval').innerHTML = `<div class="kpis" style="grid-template-columns:1fr 1fr">${U.kpi('IoU', cmp.iou.toFixed(2), '', 'cyan')}${U.kpi('Overlap (of observed)', (cmp.overlap * 100).toFixed(0), '%')}${U.kpi('Simulated area', F.n(cmp.simArea), 'km²')}${U.kpi('Area difference', (cmp.diff > 0 ? '+' : '') + F.n(cmp.diff), 'km²', 'amber')}</div><div class="note mt">Real observation vs hypothetical simulation: metrics indicate validation only when the after date corresponds to an actual release/breach on this river.</div>`;
        draw();
      } catch (e) { view.querySelector('#nstat').textContent = 'Detection failed: ' + e.message + ' (imagery may not exist for that date).'; }
    };
    draw();
    setTimeout(() => { if (!mv.dead) { map.invalidateSize(); clip(); } }, 80);
    return () => mv.destroy();
  };

  // ---------- EVACUATION INTELLIGENCE ----------
  V.evac = function (view) {
    const s = st(), ev = s.evac, scn = s.scn;
    view.classList.add('fill');
    const vs = scn.features.villages.slice().sort((a, b) => a.name.localeCompare(b.name));
    view.innerHTML = `<div class="dash" style="grid-template-columns:370px minmax(0,1fr)">
      <div class="dash-side">
        <div class="card"><h3>Evacuation route planner</h3>
          <div class="field"><label>Start location (village)</label><select id="es">${vs.map((v) => `<option value="${v.id}" ${ev.start === v.id ? 'selected' : ''}>${F.esc(v.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Destination</label><select id="ed"><option value="auto">Nearest reachable safe zone (auto)</option>${scn.features.safeZones.map((z) => `<option value="${z.id}" ${ev.dest === z.id ? 'selected' : ''}>${F.esc(z.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Travel mode</label><div class="seg" id="em"><button data-v="vehicle" class="${ev.mode === 'vehicle' ? 'on' : ''}">Vehicle</button><button data-v="foot" class="${ev.mode === 'foot' ? 'on' : ''}">On foot</button></div></div>
          <div class="field"><label>Departure after breach (warning + mobilisation) <b id="t0v">${s.t0} min</b></label><input type="range" id="t0" min="0" max="90" step="5" value="${s.t0}"/></div>
          <div class="dim" style="font-size:11px">Time-aware routing on the ${FS.app.isLive() ? 'OpenStreetMap' : 'synthetic demo'} road network: a segment is used only if it can be cleared ≥ ${A.ROUTE_MARGIN} min before simulated water on it exceeds ${s.roadThreshold} m.</div>
        </div>
        <div class="card" id="eres"></div>
        <div class="note">SIMULATED EVACUATION DECISION SUPPORT — not officially approved evacuation routes; safe zones are ${FS.app.isLive() ? 'auto-selected high-ground candidates' : 'illustrative'}. Must be validated by the district administration.</div>
      </div>
      <div class="dash-map"><div class="map-wrap" id="emap"></div></div></div>`;
    const mv = U.mountMap(view.querySelector('#emap'), { mode: 'evac', layers: { river: true, dam: true, extent: true, villages: true, labels: true, roads: true, bridges: true, safe: true } });
    const { M, ana } = FS.app.cur();
    mv.update({ scn, M, ana, t: scn.config.duration });
    const run = () => {
      if (!ev.start) { view.querySelector('#eres').innerHTML = '<div class="muted">No settlements in this scenario.</div>'; return; }
      const plan = A.planEvacuation(scn, ana.roadEval, ev.start, ev.dest, { mode: ev.mode, t0: s.t0 });
      const v = ana.villages.find((x) => x.id === ev.start);
      const r = plan.recommended, z = scn.features.safeZones.find((x) => x.id === plan.dest);
      const block = (rt, title, col) => `<div style="border-left:3px solid ${col};padding-left:10px;margin-top:10px"><div style="font-weight:600">${title}</div>
        <div class="pop-grid" style="font-size:12.5px"><span>Distance</span><span>${rt.len.toFixed(1)} km</span><span>Travel time</span><span>~${Math.round(rt.time)} min</span><span>Flood risk on route</span><span>${U.risk(rt.risk)}</span><span>Min. safety margin</span><span>${isFinite(rt.minMargin) ? Math.round(rt.minMargin) + ' min' : 'never floods'}</span></div>
        <div class="dim" style="font-size:11px;margin-top:3px">${rt.edges.filter((e) => e.cls !== 'village').map((e) => F.esc(e.name)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 6).join(' → ')}</div></div>`;
      view.querySelector('#eres').innerHTML = `<h3>Route result ${U.demo('SIMULATED')}</h3>
        <div style="text-align:center;font-size:13px;line-height:1.7"><div><span class="risk risk-${v.risk}">${F.esc(v.name)}</span> <span class="dim">(${v.affected ? 'floods T+' + Math.round(v.arrival) + ' min, ' + v.depth.toFixed(1) + ' m' : 'not flooded'})</span></div>
          <div class="dim">↓</div><div>${r ? `Safe road · ${r.edges.length} segments · ${r.len.toFixed(1)} km` : '<span class="risk risk-UNSAFE">NO SAFE ROAD ROUTE</span>'}</div><div class="dim">↓</div>
          <div>${z ? `<span class="risk risk-LOW">${F.esc(z.name)}</span>` : '<span class="muted">Shelter in place / vertical evacuation</span>'}</div></div>
        ${r ? block(r, 'Recommended route', '#22c55e') : `<div class="note mt">${T('shelter')}</div>`}
        ${plan.alternative ? block(plan.alternative, 'Alternative route', '#facc15') : r ? '<div class="dim mt" style="font-size:12px">No distinct alternative route found.</div>' : ''}
        ${plan.naive ? `<div class="mt" style="border-left:3px solid #ef4444;padding-left:10px"><div style="font-weight:600">Flooded / blocked roads on the shortest (flood-unaware) path</div><div style="font-size:12.5px">${plan.naive.blocked.slice(0, 6).map((e) => `${F.esc(e.name)} — impassable from T+${Math.round(ana.roadEval[e.id].blockTime)} min`).join('<br>')}</div></div>` : ''}
        <div class="row mt" style="gap:6px"><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>`;
      mv.focusRoute(plan, ana.villages);
    };
    view.querySelector('#es').onchange = (e) => { ev.start = e.target.value; run(); };
    view.querySelector('#ed').onchange = (e) => { ev.dest = e.target.value; run(); };
    view.querySelector('#em').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ev.mode = b.dataset.v; view.querySelectorAll('#em button').forEach((x) => x.classList.toggle('on', x === b)); run(); };
    view.querySelector('#t0').oninput = (e) => { s.t0 = +e.target.value; view.querySelector('#t0v').textContent = s.t0 + ' min'; run(); };
    view.querySelector('#t0').onchange = () => FS.app.recomputeAnalysis();
    setTimeout(() => { if (!mv.dead) { mv.map.invalidateSize(); run(); } }, 80);
    return () => mv.destroy();
  };

  // ---------- HADR PRIORITY ----------
  const FACTORS = [['population', 'Population', 'Village population ÷ largest village population'], ['depth', 'Flood depth', 'Max depth ÷ 4 m (capped at 1)'], ['arrival', 'Arrival time', '1 − arrival ÷ 240 min (earlier = higher)'], ['infrastructure', 'Critical infra', 'Schools + health facilities near village ÷ 3'], ['accessibility', 'Accessibility', 'Evacuation travel time ÷ 60 min; 1 if no safe route'], ['roads', 'Road availability', 'Share of village access roads flooded']];
  const accTag = (a) => `<span class="risk risk-${{ GOOD: 'LOW', MODERATE: 'MEDIUM', LOW: 'HIGH', NONE: 'UNSAFE' }[a]}">${a === 'NONE' ? 'NO ROUTE' : a}</span>`;
  V.priority = function (view) {
    const s = st();
    s.priFilter = s.priFilter || 'all';
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_priority')}</h1><p>Transparent, rule-based and configurable priority scoring for HADR response. No machine-learning prediction is used.</p></div>${U.demo('PROTOTYPE DECISION-SUPPORT OUTPUT')}</div>
    <div class="grid" style="grid-template-columns:280px minmax(0,1fr) 360px">
      <div class="card"><h3>Scoring weights</h3><div id="wts"></div><button class="btn btn-sm mt" id="wreset">Reset weights</button>
        <div class="dim mt" style="font-size:11px">Score = Σ (weightᵢ × factorᵢ) ÷ Σ weights × 100. HIGH ≥ 55, MEDIUM ≥ 35, else LOW. Unaffected locations score 0.</div></div>
      <div class="card"><h3>Ranked HADR response table <div class="seg" id="pf">${['all', 'HIGH', 'MEDIUM', 'LOW'].map((p) => `<button data-v="${p}" class="${s.priFilter === p ? 'on' : ''}">${p === 'all' ? 'All' : p}</button>`).join('')}</div></h3><div class="tbl-wrap" style="max-height:620px"><table class="tbl" id="pt"></table></div></div>
      <div><div class="card" id="pex"></div></div>
    </div>
    <div class="note mt">Priority scores, risk classes and alerts are prototype decision-support outputs from simulated scenarios. They must be validated by authorised disaster-management authorities before operational use.</div>`;
    const drawW = () => (view.querySelector('#wts').innerHTML = FACTORS.map(([k, l, d]) => `<div class="field" title="${d}"><label>${l} <b>${s.weights[k]}</b></label><input type="range" min="0" max="50" step="5" value="${s.weights[k]}" data-k="${k}"/></div>`).join(''));
    const draw = () => {
      const { ana } = FS.app.cur();
      const list = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score);
      if (!s.priSel || !list.find((v) => v.id === s.priSel)) s.priSel = list[0] && list[0].id;
      view.querySelector('#pt').innerHTML = `<tr><th>#</th><th>Priority</th><th>Location</th><th class="num">Population</th><th class="num">Depth</th><th class="num">Arrival</th><th class="num">Infra</th><th>Accessibility</th><th class="num">Score</th></tr>` +
        (list.map((v, i) => ({ v, i })).filter(({ v }) => s.priFilter === 'all' || v.priority === s.priFilter).slice(0, 300).map(({ v, i }) => `<tr class="click ${s.priSel === v.id ? 'sel' : ''}" data-id="${v.id}"><td>${i + 1}</td><td>${U.risk(v.priority)}</td><td>${F.esc(v.name)}<div class="dim" style="font-size:11px">${F.esc(U.groupName(v.group))}</div></td><td class="num">${F.n(v.pop)}</td><td class="num">${v.depth.toFixed(1)} m</td><td class="num">${Math.round(v.arrival)} min</td><td class="num">${v.infra.filter((f) => f.type === 'school' || f.type === 'health').length}</td><td>${accTag(v.accessLabel)}</td><td class="num"><b>${v.score.toFixed(0)}</b></td></tr>`).join('') || '<tr><td colspan="9" class="muted">No affected locations.</td></tr>');
      const v = list.find((x) => x.id === s.priSel);
      if (!v) { view.querySelector('#pex').innerHTML = '<h3>Explanation</h3><div class="muted">No affected locations.</div>'; return; }
      view.querySelector('#pex').innerHTML = `<h3>Why this priority?</h3>
        <div class="row between"><div style="font-size:17px;font-weight:700">${F.esc(v.name)}</div>${U.risk(v.priority)}</div><div class="muted mb" style="font-size:12px">Score ${v.score.toFixed(1)} / 100</div>
        <div class="pop-grid mb" style="font-size:12.5px"><span>Population</span><span>${F.n(v.pop)}</span><span>Depth</span><span>${v.depth.toFixed(2)} m</span><span>Arrival</span><span>${Math.round(v.arrival)} min</span><span>Critical infrastructure</span><span>${v.infra.filter((f) => f.type === 'school' || f.type === 'health').length}</span><span>Road accessibility</span><span>${accTag(v.accessLabel)}</span></div>
        <div class="muted" style="font-size:11px;margin-bottom:4px">Factor value (0–1) → contribution to score</div>
        ${FACTORS.map(([k, l, d]) => `<div class="factor" title="${d}"><span>${l}</span><div class="bar"><i style="width:${(v.factors[k] * 100).toFixed(0)}%"></i></div><span class="mono" style="text-align:right">+${v.contrib[k].toFixed(1)}</span></div>`).join('')}
        <div class="muted mt" style="font-size:12px">Recommended action</div><div style="font-size:12.5px">${v.evac.recommended ? `Evacuate to ${F.esc(v.safeZone)} (~${Math.round(v.evac.recommended.time)} min, ${v.evac.recommended.len.toFixed(1)} km).` : T('shelter')}${v.evac.avoidIds.length ? ` Avoid ${v.evac.avoidIds.slice(0, 3).join(', ')}.` : ''}</div>
        <div class="row mt wrap" style="gap:6px"><button class="btn btn-sm btn-primary" data-act="alert" data-id="${v.id}">Generate emergency alert</button><button class="btn btn-sm" data-act="evac" data-id="${v.id}">View route</button></div>`;
    };
    drawW(); draw();
    let tmr;
    view.querySelector('#wts').oninput = (e) => { const k = e.target.dataset.k; if (!k) return; s.weights[k] = +e.target.value; e.target.previousElementSibling.querySelector('b').textContent = e.target.value; clearTimeout(tmr); tmr = setTimeout(() => { FS.app.recomputeAnalysis(); draw(); FS.app.renderStatus(); }, 150); };
    view.querySelector('#wreset').onclick = () => { Object.assign(s.weights, A.DEFAULT_WEIGHTS); FS.app.recomputeAnalysis(); drawW(); draw(); };
    view.querySelector('#pf').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; s.priFilter = b.dataset.v; view.querySelectorAll('#pf button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    view.querySelector('#pt').onclick = (e) => { const r = e.target.closest('tr[data-id]'); if (r) { s.priSel = r.dataset.id; draw(); } };
  };

  // ---------- ALERT MODAL ----------
  V.alertModal = function (vid) {
    const s = st(), { ana } = FS.app.cur(), scn = s.scn;
    const v = ana.villages.find((x) => x.id === vid);
    if (!v || !v.affected) { FS.app.modal('Emergency alert', `<p>${F.esc(v ? v.name : 'This location')} is not inundated in the current simulated scenario. No alert generated.</p>`); return; }
    let kind = 'sms', lang = s.lang;
    FS.app.modal(`Emergency alert — ${v.name}`, `<div class="row between mb wrap"><div class="seg" id="ak"><button data-v="sms" class="on">SMS-style</button><button data-v="wa">WhatsApp-style</button><button data-v="brief">Printable brief</button></div>
      <div class="seg" id="al"><button data-v="en" class="${lang === 'en' ? 'on' : ''}">EN</button><button data-v="hi" class="${lang === 'hi' ? 'on' : ''}">हिन्दी</button></div></div>
      <div id="aout"></div>
      <div class="row mt" style="justify-content:space-between"><span class="dim" style="font-size:11px" id="alen"></span><div class="row" style="gap:6px"><button class="btn btn-sm" id="acopy">Copy text</button><button class="btn btn-sm" id="aprint">Print</button></div></div>
      <div class="note mt">Text generated only — <b>no SMS / WhatsApp gateway is connected and nothing has been sent</b>. Alerts are prototype outputs from a simulated scenario and must be validated and issued by authorised authorities.</div>`, (b) => {
      const text = () => (kind === 'sms' ? FS.exporter.sms(scn, v, ana, lang) : kind === 'wa' ? FS.exporter.whatsapp(scn, v, ana, lang) : FS.exporter.brief(scn, v, ana, lang));
      const draw = () => {
        const t = text();
        b.querySelector('#aout').innerHTML = kind === 'wa' ? `<div class="wa"><div class="wa-bubble">${F.esc(t).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>')}</div></div>` : `<div class="alert-box">${F.esc(t)}</div>`;
        b.querySelector('#alen').textContent = kind === 'sms' ? `${t.length} characters${lang === 'hi' ? ' (Unicode SMS: 70 chars/segment)' : ' (GSM: 160 chars/segment)'}` : '';
      };
      b.querySelector('#ak').onclick = (e) => { const x = e.target.closest('button'); if (!x) return; kind = x.dataset.v; b.querySelectorAll('#ak button').forEach((y) => y.classList.toggle('on', y === x)); draw(); };
      b.querySelector('#al').onclick = (e) => { const x = e.target.closest('button'); if (!x) return; lang = x.dataset.v; b.querySelectorAll('#al button').forEach((y) => y.classList.toggle('on', y === x)); draw(); };
      b.querySelector('#acopy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(text()).then(() => FS.app.toast('Alert text copied (not sent)'));
      b.querySelector('#aprint').onclick = () => { const w = window.open('', '_blank'); w.document.write(`<pre style="font:14px/1.5 monospace;white-space:pre-wrap">${F.esc(text())}</pre>`); w.document.close(); w.print(); };
      draw();
    });
  };

  // ---------- SCENARIO COMPARISON (WHAT-IF) ----------
  V.whatif = function (view) {
    const s = st();
    if (FS.app.isLive() || s.backend.online) return liveWhatIf(view);
    demoWhatIf(view);
  };
  function renderWhatIf(view, rows, note) {
    const cols = ['#22c55e', '#f59e0b', '#ef4444', '#22d3ee', '#a78bfa', '#f472b6'];
    view.querySelector('#wtab').innerHTML = `<tr><th>Scenario</th><th class="num">Breach width</th><th class="num">Breach depth / head</th><th class="num">Storage</th><th class="num">Formation</th><th class="num">Peak Q</th><th class="num">Flood area</th><th class="num">Max depth</th><th class="num">First arrival</th><th class="num">Villages</th><th class="num">Assets</th><th class="num">Bridges</th><th class="num">Population</th><th class="num">Est. loss</th></tr>` +
      rows.map((r) => `<tr><td><b>${F.esc(r.name)}</b> · ${F.esc(r.label)}</td><td class="num">${F.n(r.cfg.breachWidth)} m</td><td class="num">${F.n(r.cfg.waterLevel ?? r.cfg.heightM)} m</td><td class="num">${F.n(r.cfg.storage ?? r.cfg.storageMCM)} MCM</td><td class="num">${F.n(r.cfg.breachTime)} min</td><td class="num">${F.n(r.K.peakQ)} m³/s</td><td class="num">${F.n(r.K.area, 1)} km²</td><td class="num">${r.K.maxDepth.toFixed(2)} m</td><td class="num">${F.min(r.K.firstArrival)}</td><td class="num">${r.K.villages}</td><td class="num">${r.K.infra}</td><td class="num">${r.K.bridges}</td><td class="num">${F.n(r.K.population)}</td><td class="num">${r.K.damage ? F.inr(r.K.damage.buildingLossINR + r.K.damage.cropLossINR) : '—'}</td></tr>`).join('');
    view.querySelector('#wnote').textContent = note || '';
    const ch = [];
    ch.push(new Chart(view.querySelector('#w1'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Flood area (km²)', data: rows.map((r) => +r.K.area.toFixed(1)), backgroundColor: rows.map((_, i) => cols[i % 6]), yAxisID: 'y' }, { type: 'line', label: 'Peak discharge (m³/s)', data: rows.map((r) => Math.round(r.K.peakQ)), borderColor: '#e2e8f0', yAxisID: 'y1' }] }, options: { maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'km²' } }, y1: { position: 'right', grid: { drawOnChartArea: false } } } } }));
    ch.push(new Chart(view.querySelector('#w2'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Villages', data: rows.map((r) => r.K.villages), backgroundColor: '#f59e0b' }, { label: 'Critical assets', data: rows.map((r) => r.K.infra), backgroundColor: '#ef4444' }, { label: 'Bridges', data: rows.map((r) => r.K.bridges), backgroundColor: '#8b5cf6' }] }, options: { maintainAspectRatio: false } }));
    ch.push(new Chart(view.querySelector('#w3'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Max depth (m)', data: rows.map((r) => +r.K.maxDepth.toFixed(2)), backgroundColor: '#38bdf8' }, { label: 'First arrival (min)', data: rows.map((r) => (isFinite(r.K.firstArrival) ? Math.round(r.K.firstArrival) : null)), backgroundColor: '#f97316' }] }, options: { maintainAspectRatio: false } }));
    return ch;
  }
  const whatIfShell = (sub, extra) => `<div class="page-head"><div><h1>${T('nav_whatif')} — What-if simulator</h1><p>${sub}</p></div>${U.demo()}</div>${extra || ''}
    <div class="card mb"><h3>Scenario comparison table</h3><div class="tbl-wrap" style="max-height:none"><table class="tbl" id="wtab"></table></div><div class="dim" style="font-size:11px;margin-top:6px" id="wnote"></div></div>
    <div class="grid g3"><div class="card"><h3>Flooded area &amp; peak discharge</h3><div style="height:260px"><canvas id="w1"></canvas></div></div><div class="card"><h3>Affected villages &amp; assets</h3><div style="height:260px"><canvas id="w2"></canvas></div></div><div class="card"><h3>Max depth &amp; first arrival</h3><div style="height:260px"><canvas id="w3"></canvas></div></div></div>`;
  function demoWhatIf(view) {
    const s = st();
    const key = JSON.stringify([s.cfg, s.activeModel, s.weights]);
    if (!s.whatIf || s.whatIf.key !== key) {
      const mk = (name, label, cfg) => { const c = Object.assign({}, s.cfg, cfg, { peakDischarge: cfg.peakDischarge || 0 }); const scn = FS.demo.buildScenario(c); return { name, label, cfg: c, K: A.analyse(scn, s.activeModel, { weights: s.weights, t0: s.t0 }).kpi }; };
      s.whatIf = { key, rows: [mk('A', 'Small breach', D.presets.small), mk('B', 'Medium breach', D.presets.medium), mk('C', 'Severe breach', D.presets.severe), mk('D', 'Current configuration', FS.app.effectiveCfg())] };
    }
    view.innerHTML = whatIfShell('Offline demo: small / medium / severe breaches of the Kosi demo dam (browser surrogate).');
    const ch = renderWhatIf(view, s.whatIf.rows, 'Breach depth is taken as the head above the breach invert. Start the backend to compare real solver runs for any dam.');
    return () => ch.forEach((c) => c.destroy());
  }
  function liveWhatIf(view) {
    const s = st();
    view.innerHTML = whatIfShell('Compare stored backend scenarios (numerical solver results), or queue small / medium / severe variants for the current dam.',
      `<div class="card mb"><h3>Stored scenarios <button class="btn btn-sm" id="wq">Queue Small / Medium / Severe for current dam</button></h3><div class="tbl-wrap" style="max-height:220px"><table class="tbl" id="wlist"><tr><td class="muted">Loading…</td></tr></table></div><div id="wjobs" class="dim mt" style="font-size:12px"></div></div>`);
    let charts = [], list = [], timer;
    const sel = (s.wiSel = s.wiSel || new Set());
    const draw = () => {
      charts.forEach((c) => c.destroy());
      const rows = list.filter((m) => sel.has(m.id)).slice(0, 6).map((m, i) => ({ name: String.fromCharCode(65 + i), label: `${m.dam.name} · ${m.config.preset || m.config.type}`, cfg: m.config, K: m.kpi[s.activeModel] || m.kpi.delft3d }));
      view.querySelector('#wtab').innerHTML = '';
      charts = rows.length ? renderWhatIf(view, rows, `Model shown: ${s.activeModel === 'sph' ? 'SPH' : 'Delft3D-class SWE'} (switch on the Dashboard). Values from backend runs; losses indicative.`) : [];
      if (!rows.length) view.querySelector('#wtab').innerHTML = '<tr><td class="muted">Tick scenarios above to compare them.</td></tr>';
    };
    const load = async () => {
      try { list = await FS.api.get('/api/scenarios'); } catch (e) { list = []; }
      if (!sel.size) list.slice(0, 3).forEach((m) => sel.add(m.id));
      view.querySelector('#wlist').innerHTML = `<tr><th></th><th>Scenario</th><th>Created</th><th class="num">Breach W</th><th class="num">Storage</th><th class="num">Grid</th><th class="num">Runtime</th><th></th></tr>` + (list.map((m) => `<tr><td><input type="checkbox" data-id="${m.id}" ${sel.has(m.id) ? 'checked' : ''}/></td><td>${F.esc(m.name)} <span class="dim">(${F.esc(m.config.preset || '')})</span></td><td class="muted">${new Date(m.createdAt).toLocaleString('en-IN')}</td><td class="num">${F.n(m.config.breachWidth)} m</td><td class="num">${F.n(m.config.storage)} MCM</td><td class="num">${m.grid.cols}×${m.grid.rows}</td><td class="num">${F.n(m.runtimeSec)} s</td><td><button class="btn btn-sm" data-load="${m.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No stored scenarios yet — run one from the Scenario Builder (Live).</td></tr>');
      draw();
    };
    const pollJobs = async () => {
      try { const js = (await FS.api.get('/api/jobs')).filter((j) => j.status === 'queued' || j.status === 'running'); view.querySelector('#wjobs').textContent = js.length ? js.map((j) => `${j.dam}: ${j.status} ${Math.round(j.progress * 100)}% — ${j.stepName}`).join(' · ') : ''; if (!js.length && timer) { clearInterval(timer); timer = null; load(); } } catch (e) {}
    };
    view.querySelector('#wlist').onchange = (e) => { const id = e.target.dataset.id; if (!id) return; e.target.checked ? sel.add(id) : sel.delete(id); draw(); };
    view.querySelector('#wlist').onclick = async (e) => { const b = e.target.closest('[data-load]'); if (b) { await FS.app.loadLive(b.dataset.load); FS.app.go('dashboard'); } };
    view.querySelector('#wq').onclick = async () => {
      if (!FS.app.isLive()) return FS.app.toast('Open or run a live scenario first');
      const scn = s.scn, base = scn.config;
      const variants = [['small', 0.5, 0.6, 1.5], ['medium', 1, 1, 1], ['severe', 1, 1.5, 0.6]];
      for (const [p, sf, wm, tm] of variants) {
        const bw = scn.breach ? scn.breach.breachWidthM * wm : base.breachWidth * wm, bt = scn.breach ? scn.breach.failureTimeMin * tm : base.breachTime * tm;
        await FS.api.post('/api/jobs', { dam: scn.dam, config: Object.assign({}, base, { preset: p, storageMCM: scn.dam.storageMCM * sf, heightM: scn.dam.heightM, breachWidth: Math.round(bw), breachTime: Math.round(bt), peakDischarge: 0, hydrographCsv: null }) });
      }
      FS.app.toast('3 scenario jobs queued on the backend');
      timer = setInterval(pollJobs, 2000); pollJobs();
    };
    load();
    return () => { charts.forEach((c) => c.destroy()); clearInterval(timer); };
  }

  // ---------- EXPORT & REPORTS ----------
  V.export = function (view) {
    const s = st(), scn = s.scn, live = FS.app.isLive();
    s.exportLog = s.exportLog || [];
    let mkey = s.activeModel;
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_export')}</h1><p>Export inundation results to GIS formats (.shp / .kml / GeoJSON / ASCII grid), model decks and reports, and generate emergency messages.</p></div>${U.demo()}</div>
    <div class="grid g2">
      <div class="card"><h3>GIS &amp; report exports ${live ? '<span class="tag tag-sim">SERVED BY BACKEND</span>' : '<span class="tag tag-demo">GENERATED IN BROWSER</span>'}</h3>
        <div class="field"><label>Model result to export</label><div class="seg" id="xm"><button data-v="sph">SPH</button><button data-v="delft3d">${live ? 'Delft3D-class SWE' : 'Delft3D'}</button></div></div>
        <div class="grid g2">
          <button class="btn btn-lg" data-x="kml">⤓ Export KML</button><button class="btn btn-lg" data-x="shp">⤓ Export SHP (zip)</button>
          <button class="btn btn-lg" data-x="geojson">⤓ Export GeoJSON</button><button class="btn btn-lg" data-x="asc">⤓ Raster grids (.asc)</button>
          <button class="btn btn-lg" data-x="png">⤓ Download Flood Map</button><button class="btn btn-lg btn-primary" data-x="pdf">Generate PDF Report</button>
          ${live ? `<button class="btn btn-lg" data-x="delft3d">⤓ Delft3D-FLOW input deck</button><button class="btn btn-lg" data-x="gee">⤓ GEE flood-mapping script</button>` : ''}
        </div>
        <div class="dim mt" style="font-size:11px">Polygons are the exact raster footprint: maximum extent, depth classes (0.05–0.5, 0.5–1, 1–2, 2–5, &gt;5 m) and arrival-time zones. SHP: WGS84 with .prj. Rasters: ESRI ASCII grids of max depth, velocity, arrival, duration and DEM. PDF: opens a print-ready report — choose "Save as PDF".</div>
        <h3 class="mt">Export log</h3><ul class="steps" id="xlog"></ul></div>
      <div class="card"><h3>Report contents</h3><ul class="steps">${['Scenario, river, dam, scenario type, input datasets', 'Simulation time, model engines & solver diagnostics', 'Max depth, velocity, inundated area, arrival time', 'Affected settlements & group/panchayat impact', 'Infrastructure impact (schools, health, bridges, roads)', 'Loss & damage estimate (indicative)', 'Evacuation analysis (simulated routes)', 'HADR priority ranking with weights', 'SPH vs Delft3D-class comparison', 'Map snapshot & data sources'].map((x) => `<li class="ok"><span class="si">✓</span>${x}</li>`).join('')}</ul></div>
    </div>
    <div class="card mt"><h3>Emergency alert export</h3>
      <div class="row wrap" style="gap:8px"><select id="av" style="width:auto">${FS.app.cur().ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score).slice(0, 300).map((v) => `<option value="${v.id}">${F.esc(v.name)} — ${v.priority}</option>`).join('')}</select>
      <button class="btn" data-a="sms">Generate SMS Alert</button><button class="btn" data-a="wa">Generate WhatsApp-Style Alert</button><button class="btn" data-a="brief">Print Emergency Brief</button><button class="btn" data-a="all">Download all alerts (.txt)</button></div>
      <div class="note mt">Alerts are generated as text only. No SMS / WhatsApp messaging backend is connected; nothing is delivered.</div></div>`;
    const seg = () => view.querySelectorAll('#xm button').forEach((b) => b.classList.toggle('on', b.dataset.v === mkey));
    seg();
    view.querySelector('#xm').onclick = (e) => { const b = e.target.closest('button'); if (b) { mkey = b.dataset.v; seg(); } };
    const drawLog = () => (view.querySelector('#xlog').innerHTML = s.exportLog.slice(0, 8).map((x) => `<li class="ok"><span class="si">✓</span>${F.esc(x)}</li>`).join('') || '<li>No exports yet.</li>');
    const log = (m) => { s.exportLog.unshift(`${new Date().toLocaleTimeString('en-IN')} · ${m}`); drawLog(); };
    drawLog();
    const X = FS.exporter, G = FS.geoexport, name = () => `floodsim_${scn.id}_${mkey}`;
    const link = (url) => { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };
    view.onclick = async (e) => {
      const b = e.target.closest('[data-x]');
      if (b) {
        const M = scn.models[mkey], ana = s.ana[mkey], fx = b.dataset.x;
        try {
          if (live && ['kml', 'shp', 'geojson', 'asc', 'delft3d', 'gee'].includes(fx)) { link(FS.api.exportUrl(scn.id, fx, mkey)); log(`${fx.toUpperCase()} downloaded from backend (${M.short})`); return; }
          if (fx === 'kml') { X.download(name() + '.kml', G.kml(scn, M, ana, FS.app.scenarioName()), 'application/vnd.google-earth.kml+xml'); log(`KML exported (${M.short})`); }
          if (fx === 'geojson') { X.download(name() + '.geojson', JSON.stringify(G.geojson(scn, M, ana)), 'application/geo+json'); log(`GeoJSON exported (${M.short})`); }
          if (fx === 'shp') { X.download(name() + '_shp.zip', new Blob([G.shapefileZip(scn, M, FS.app.scenarioName())], { type: 'application/zip' })); log(`Shapefile exported (${M.short})`); }
          if (fx === 'asc') { X.download(name() + '_max_depth.asc', G.asciiGrid(scn, M.dmax, -9999)); log('Max-depth ASCII grid exported'); }
          if (fx === 'png') { const url = await X.mapSnapshot(scn, M, ana, scn.config.duration, `${FS.app.scenarioName()} — ${M.name} — max depth`); const a = document.createElement('a'); a.href = url; a.download = name() + '.png'; a.click(); log('Flood map PNG downloaded'); }
          if (fx === 'pdf') {
            const ok = mkey === 'sph' ? 'delft3d' : 'sph';
            const img = await X.mapSnapshot(scn, M, ana, scn.config.duration, `${FS.app.scenarioName()} — ${M.name}`);
            const html = X.report({ st: s, scn, M, ana, other: scn.models[ok], otherAna: s.ana[ok], img, name: FS.app.scenarioName() });
            const w = window.open('', '_blank');
            if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 700); } else X.download(name() + '_report.html', html, 'text/html');
            log('Report generated successfully'); FS.app.toast('Report generated successfully');
          }
        } catch (err) { FS.app.toast('Export failed: ' + err.message); }
      }
      const a = e.target.closest('[data-a]');
      if (a) {
        const vid = view.querySelector('#av').value;
        if (!vid) return FS.app.toast('No affected settlements');
        if (a.dataset.a === 'all') {
          const { ana } = FS.app.cur();
          X.download(`floodsim_alerts_${X.stamp()}.txt`, ana.villages.filter((v) => v.affected).sort((x, y) => y.score - x.score).map((v) => X.brief(scn, v, ana, s.lang)).join('\n\n\n'));
          log('All alert briefs downloaded (text only)');
        } else {
          V.alertModal(vid);
          setTimeout(() => { const t = document.querySelector(`#ak [data-v="${a.dataset.a}"]`); t && t.click(); }, 0);
          log(`${a.dataset.a.toUpperCase()} alert text generated (not sent)`);
        }
      }
    };
    return () => { view.onclick = null; };
  };

  // ---------- DATA SOURCES ----------
  V.data = function (view) {
    const s = st(), live = FS.app.isLive(), on = s.backend.online;
    const tag = (x) => ({ REAL: '<span class="tag tag-real">REAL DATA</span>', DEMO: '<span class="tag tag-demo">DEMO DATA</span>', SIM: '<span class="tag tag-sim">SIMULATED</span>', DERIVED: '<span class="tag tag-sim">DERIVED</span>', ESTIMATE: '<span class="tag tag-demo">ESTIMATE</span>', USER: '<span class="tag tag-sim">USER INPUT</span>', NC: '<span class="tag tag-nc">NOT CONNECTED</span>', 'NOT CONNECTED': '<span class="tag tag-nc">NOT CONNECTED</span>' }[x] || x);
    const sec = [
      ['Terrain', [['DEM — SRTM (AWS Terrain Tiles, Terrarium)', 'Mapzen/AWS Open Data (SRTM, GMTED, ETOPO)', on ? 'REAL' : 'NC', on ? 'Fetched per run, cached' : '—', 'Solver bathymetry / terrain'], ['DEM — user upload (ESRI ASCII)', 'Any DEM (e.g. CartoDEM, ALOS, ASTER export)', on ? 'USER' : 'NC', 'On upload', 'Alternative terrain input'], ['ASTER GDEM v3', 'NASA / METI (direct API)', 'NC', '—', 'Use upload path'], ['DEM Demo Dataset', 'Procedural (offline demo only)', 'DEMO', 'Bundled', 'Offline Kosi demo']]],
      ['Remote Sensing', [['MODIS / VIIRS daily imagery', 'NASA EOSDIS GIBS (WMTS)', s.online ? 'REAL' : 'NC', 'Daily', 'NRT before/after, water detection'], ['Sentinel-1 SAR / Sentinel-2', 'ESA Copernicus via Google Earth Engine', 'NC', 'Script generated per run', 'SAR flood mapping'], ['Landsat 8/9', 'USGS via Google Earth Engine', 'NC', '—', 'Optical flood mapping'], ['Basemap imagery', 'Esri World Imagery (tiles)', s.online ? 'REAL' : 'NC', 'Live tiles', 'Visual context only']]],
      ['Hydrology', [['Dam catalogue (location, height, capacity)', 'Wikidata (CC0) snapshot', on ? 'REAL' : 'NC', 'Snapshot in repo', 'Dam selection, breach inputs'], ['Breach parameters', 'Froehlich 2008 / Froehlich 1995 / MacDonald & Langridge-Monopolis 1984', on ? 'DERIVED' : 'NC', 'Per run', 'Breach hydrograph'], ['Custom hydrograph', 'User CSV (time_min, Q)', on ? 'USER' : 'NC', 'On upload', 'Gauge / release data'], ['River discharge & water level', 'CWC / India-WRIS', 'NC', '—', 'Calibration, baseflow'], ['Rainfall', 'IMD / GPM IMERG', 'NC', '—', 'Antecedent conditions'], ['River course', 'D8 flow path on DEM (+ OSM rivers)', on ? 'DERIVED' : 'NC', 'Per run', 'Model geometry']]],
      ['GIS', [['Villages / towns (+ population tag)', 'OpenStreetMap via Overpass (ODbL)', on ? 'REAL' : 'NC', 'Per run, cached', 'Impact analysis'], ['Roads & bridges', 'OpenStreetMap via Overpass (ODbL)', on ? 'REAL' : 'NC', 'Per run, cached', 'Routing, impact'], ['Schools, hospitals, police, fire, shelters', 'OpenStreetMap via Overpass (ODbL)', on ? 'REAL' : 'NC', 'Per run, cached', 'Critical infrastructure'], ['Gram Panchayat boundaries', 'LGD / Bhuvan (not integrated)', 'NC', '—', 'Proxy: nearest-town groups'], ['Population where OSM tag missing', 'Place-type defaults', 'ESTIMATE', '—', 'Impact, priority'], ['Safe zones', 'Auto-selected high ground outside flood', on ? 'DERIVED' : 'NC', 'Per run', 'Evacuation']]],
      ['Models', [['SPH-SWE particle solver', 'In-house (server/solvers/sph.js)', on ? 'SIM' : 'NC', 'Per run', 'Flood simulation'], ['2D SWE finite-volume solver (Delft3D-class)', 'In-house (server/solvers/swe.js)', on ? 'SIM' : 'NC', 'Per run', 'Flood simulation'], ['Delft3D-FLOW', 'Deltares (external)', s.backend.health && s.backend.health.engines.delft3d.available ? 'REAL' : 'NC', 'Input deck generated per run', 'Reference model'], ['Offline surrogate', 'Browser (demo.js)', 'DEMO', '—', 'Offline demo only']]]
    ];
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_data')}</h1><p>Datasets used or expected by the system and their connection status.</p></div></div>
    <div class="row wrap mb" style="gap:14px;font-size:12px">${tag('REAL')} Live third-party open data ${tag('DERIVED')} Computed from real inputs ${tag('SIM')} Solver outputs ${tag('ESTIMATE')} Documented assumption ${tag('DEMO')} Synthetic demo ${tag('NC')} Not integrated</div>
    ${live && s.scn.sources ? `<div class="card mb"><h3>This scenario's inputs — ${F.esc(s.scn.name)}</h3><table class="tbl"><tr><th>Input</th><th>Source</th><th>Status</th></tr>${s.scn.sources.map((r) => `<tr><td>${F.esc(r[0])}</td><td class="muted">${F.esc(r[1])}</td><td>${tag(r[2])}</td></tr>`).join('')}</table></div>` : ''}
    ${sec.map(([t, rows]) => `<div class="card mb"><h3>${t}</h3><table class="tbl"><tr><th>Data type</th><th>Source</th><th>Status</th><th>Last updated</th><th>Used for</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td class="muted">${r[1]}</td><td>${tag(r[2])}</td><td class="muted">${r[3]}</td><td class="muted">${r[4]}</td></tr>`).join('')}</table></div>`).join('')}`;
  };

  // ---------- SYSTEM ARCHITECTURE ----------
  V.arch = function (view) {
    const box = (x, y, w, t, sub, col) => `<g><rect x="${x}" y="${y}" width="${w}" height="${sub ? 46 : 34}" rx="6" fill="#0e1828" stroke="${col || '#273a57'}" stroke-width="1.5"/><text x="${x + w / 2}" y="${y + (sub ? 20 : 22)}" fill="#e6edf6" font-size="12.5" font-weight="600" text-anchor="middle">${t}</text>${sub ? `<text x="${x + w / 2}" y="${y + 36}" fill="#8ea0b8" font-size="10.5" text-anchor="middle">${sub}</text>` : ''}</g>`;
    const ar = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4b6488" stroke-width="1.5" marker-end="url(#ah)"/>`;
    const defs = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#4b6488"/></marker></defs>';
    const X = 150, W = 260, g = 62; let y = 10, m = defs;
    [['Data Sources', 'Wikidata dams · SRTM DEM · OSM · NASA GIBS', '#22d3ee'], ['Data Preprocessing', 'tile mosaic, resampling, flow path, OSM graph'], ['DEM + Hydrological + Satellite Data', 'grid, reservoir mask, Froehlich hydrograph']].forEach((b) => { m += box(X, y, W, b[0], b[1], b[2]); m += ar(X + W / 2, y + 46, X + W / 2, y + g - 2); y += g; });
    m += box(X, y, W, 'Hydrodynamic Modelling Engine', 'Node.js worker threads (job queue)', '#f59e0b'); const yE = y; y += g + 6;
    m += box(20, y, 190, 'SPH', 'SPH-SWE particle solver', '#f97316') + box(350, y, 190, 'Delft3D', '2D SWE FV solver + FLOW deck', '#38bdf8');
    m += ar(X + W / 2 - 40, yE + 46, 115, y - 2) + ar(X + W / 2 + 40, yE + 46, 445, y - 2);
    const yM = y; y += g + 10;
    m += box(560, yM + 6, 180, 'Scenario Comparison', 'SPH vs Delft3D-class', '#8b5cf6') + ar(540, yM + 23, 558, yM + 29);
    m += `<path d="M210,${yM + 23} C 300,${yM - 10} 470,${yM - 20} 560,${yM + 18}" stroke="#4b6488" fill="none" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    m += ar(115, yM + 46, X + W / 2 - 30, y - 2) + ar(445, yM + 46, X + W / 2 + 30, y - 2);
    const rest = [['Flood Inundation Engine', 'depth · velocity · arrival · duration · hazard'], ['GIS Visualization', 'Leaflet dashboard, layers, timeline'], ['Impact & Loss Analysis', 'villages · groups · infrastructure · damage'], ['Evacuation Intelligence', 'time-aware Dijkstra on OSM roads'], ['HADR Priority Engine', 'transparent weighted scoring'], ['KML / SHP / PDF', 'GeoJSON, ASCII grids, Delft3D deck'], ['HADR Decision Support', 'DDMA / SDMA / NDRF', '#22c55e']];
    rest.forEach((b, i) => { m += box(X, y, W, b[0], b[1], b[2]); if (i < rest.length - 1) m += ar(X + W / 2, y + 46, X + W / 2, y + g - 2); y += g; });
    const H1 = y;
    const flow = (items) => { let yy = 10, s2 = defs; items.forEach((b, i, a) => { s2 += box(20, yy, 250, b[0], b[1], b[2]); if (i < a.length - 1) s2 += ar(145, yy + 46, 145, yy + g - 2); yy += g; }); return [s2, yy]; };
    const [s2, y2] = flow([['Satellite Data', 'MODIS/VIIRS (GIBS) · Sentinel-1', '#22d3ee'], ['Google Earth Engine', 'script generated (not connected)', '#f59e0b'], ['Flood Detection', 'MODIS 7-2-1 in browser · S1 in GEE'], ['Near-Real-Time Analysis', 'observed vs simulated, IoU', '#22c55e']]);
    const [s3, y3] = flow([['Flood Simulation', 'SPH / 2D SWE', '#22d3ee'], ['Village / Panchayat Impact', 'depth, arrival, duration, population'], ['Infrastructure Analysis', 'schools, health, roads, bridges'], ['Evacuation Route Analysis', 'flood-aware routing'], ['Emergency Alert Generation', 'SMS / WhatsApp-style / print (text only)', '#22c55e']]);
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_architecture') !== 'nav_architecture' ? '' : ''}${T('nav_arch')}</h1><p>End-to-end data and modelling flow of the implemented system.</p></div></div>
    <div class="grid arch" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="card"><h3>Modelling &amp; decision-support pipeline</h3><svg viewBox="0 0 760 ${H1}" width="100%">${m}</svg></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card"><h3>Near-real-time remote sensing path</h3><svg viewBox="0 0 290 ${y2}" width="100%" style="max-height:300px">${s2}</svg></div>
        <div class="card"><h3>HADR response path</h3><svg viewBox="0 0 290 ${y3}" width="100%" style="max-height:360px">${s3}</svg></div>
        <div class="card"><h3>Implementation</h3><div style="font-size:12.5px;line-height:1.7">Backend: Node.js (built-in modules only) — <span class="mono">server/</span><br>Solvers: <span class="mono">server/solvers/sph.js</span>, <span class="mono">swe.js</span> (worker threads)<br>Data: <span class="mono">server/data/</span> (DEM tiles, OSM, Wikidata, hydrology)<br>Delft3D deck + GEE script: <span class="mono">server/delft3d.js</span>, <span class="mono">gee.js</span><br>Shared analysis/exports: <span class="mono">public/js/analysis.js</span>, <span class="mono">geoexport.js</span><br>Frontend: HTML/CSS/JS + Leaflet + Chart.js · Storage: files (no database)</div></div>
      </div></div>`;
  };

  // ---------- SETTINGS ----------
  V.settings = function (view) {
    const s = st(), h = s.backend.health;
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_settings')}</h1><p>Language, connectivity, analysis thresholds and backend status.</p></div></div>
    <div class="grid g2">
      <div class="card"><h3>Backend</h3>
        <div class="row between mb"><div>Status</div><span class="chip ${h ? '' : 'warn'}"><span class="led"></span><b>${h ? 'CONNECTED · v' + h.version : 'NOT RUNNING'}</b></span></div>
        ${h ? `<div class="row between"><span>SPH-SWE solver</span><span class="tag tag-real">AVAILABLE</span></div><div class="row between mt"><span>2D SWE solver (Delft3D-class)</span><span class="tag tag-real">AVAILABLE</span></div>
        <div class="row between mt"><span>Delft3D 4 executable</span>${h.engines.delft3d.available ? '<span class="tag tag-real">FOUND</span>' : '<span class="tag tag-nc">NOT INSTALLED</span>'}</div><div class="dim" style="font-size:11px">${F.esc(h.engines.delft3d.reason)}</div>
        <div class="row between mt"><span>Google Earth Engine</span><span class="tag tag-nc">NOT CONNECTED</span></div><div class="row between mt"><span>SMS / WhatsApp gateway</span><span class="tag tag-nc">NOT CONNECTED</span></div>
        <div class="row between mt"><span>Jobs</span><span class="mono">${h.jobs.running ? 'running ' + h.jobs.running : 'idle'} · ${h.jobs.queued} queued</span></div>` : '<div class="alert-box" style="min-height:0">npm run dev   →   http://localhost:8080</div><div class="dim mt" style="font-size:11px">No installation needed: the backend uses only built-in Node.js modules.</div>'}
        <button class="btn btn-sm mt" id="rh">Re-check backend</button></div>
      <div class="card"><h3>Language</h3><div class="field"><label>Interface language</label><select id="lang">${Object.entries(FS.i18n.langs).map(([k, l]) => `<option value="${k}" ${s.lang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="dim" style="font-size:11px">Strings live in <span class="mono">public/js/i18n.js</span>. Add a regional language by adding a dictionary with the same keys; missing keys fall back to English.</div>
        <h3 class="mt">Connectivity</h3>
        <div class="row between mb"><div>Current mode</div><span class="chip ${s.online ? '' : 'warn'}"><span class="led"></span><b>${s.online ? 'ONLINE MODE' : 'OFFLINE / CACHED MODE'}</b></span></div>
        <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="off" ${s.forceOffline ? 'checked' : ''}/> Low-connectivity mode (DEM hillshade basemap, no tile downloads)</label>
        <div class="dim mt" style="font-size:11px">Scenario results are held in the browser and on the backend's local disk; DEM tiles and OSM extracts are cached under data/cache so repeated runs work without re-downloading.</div>
        <button class="btn btn-sm mt" id="clr">Clear browser cache</button></div>
      <div class="card"><h3>Analysis thresholds</h3>
        <div class="field"><label>Road impassable above water depth <b id="rtv">${s.roadThreshold} m</b></label><input type="range" id="rt" min="0.1" max="1" step="0.05" value="${s.roadThreshold}"/></div>
        <div class="field"><label>Default evacuation departure (after breach) <b id="t0v">${s.t0} min</b></label><input type="range" id="t0" min="0" max="90" step="5" value="${s.t0}"/></div>
        <button class="btn btn-sm" id="apply">Apply &amp; recompute</button></div>
      <div class="card"><h3>Scenario</h3><div class="pop-grid" style="font-size:12.5px"><span>Loaded</span><span>${F.esc(s.scn.name)}</span><span>Mode</span><span>${s.scn.mode}</span><span>Grid</span><span>${s.scn.grid.cols} × ${s.scn.grid.rows}</span><span>Created</span><span>${new Date(s.scn.createdAt).toLocaleString('en-IN')}</span></div>
        <button class="btn btn-sm mt" id="demo">Load offline Kosi demo</button></div>
    </div>`;
    view.querySelector('#rh').onclick = async () => { const hh = await FS.api.health(); s.backend = { online: !!hh, health: hh }; FS.app.renderStatus(); FS.app.go('settings'); };
    view.querySelector('#lang').onchange = (e) => { s.lang = e.target.value; FS.app.save(); FS.app.go('settings'); };
    view.querySelector('#off').onchange = (e) => { s.forceOffline = e.target.checked; FS.app.save(); FS.app.renderStatus(); FS.app.toast(s.online ? 'ONLINE MODE' : 'OFFLINE / CACHED MODE enabled'); FS.app.go('settings'); };
    view.querySelector('#clr').onclick = () => { try { localStorage.clear(); } catch (e) {} FS.app.toast('Browser cache cleared'); };
    view.querySelector('#rt').oninput = (e) => (view.querySelector('#rtv').textContent = e.target.value + ' m');
    view.querySelector('#t0').oninput = (e) => (view.querySelector('#t0v').textContent = e.target.value + ' min');
    view.querySelector('#apply').onclick = () => { s.roadThreshold = +view.querySelector('#rt').value; s.t0 = +view.querySelector('#t0').value; FS.app.recomputeAnalysis(); FS.app.renderStatus(); FS.app.toast('Thresholds applied — analysis recomputed'); };
    view.querySelector('#demo').onclick = () => { FS.app.loadDemo(); FS.app.go('dashboard'); };
  };
})();
