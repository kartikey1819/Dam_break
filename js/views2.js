/* FloodSim HADR — page views (part 2). */
(function () {
  const E = FS.engine, D = FS.data, F = FS.fmt, U = FS.ui, V = FS.views;
  const st = () => FS.state;
  const T = (k) => FS.t(k);

  // ---------- EVACUATION INTELLIGENCE ----------
  V.evac = function (view) {
    const s = st(), ev = s.evac;
    view.classList.add('fill');
    view.innerHTML = `<div class="dash" style="grid-template-columns:370px minmax(0,1fr)">
      <div class="dash-side">
        <div class="card"><h3>Evacuation route planner</h3>
          <div class="field"><label>Start location (village)</label><select id="es">${D.villages.map((v) => `<option value="${v.id}" ${ev.start === v.id ? 'selected' : ''}>${v.name}</option>`).join('')}</select></div>
          <div class="field"><label>Destination</label><select id="ed"><option value="auto">Nearest reachable safe zone (auto)</option>${D.safeZones.map((z) => `<option value="${z.id}" ${ev.dest === z.id ? 'selected' : ''}>${z.name}</option>`).join('')}</select></div>
          <div class="field"><label>Travel mode</label><div class="seg" id="em"><button data-v="vehicle" class="${ev.mode === 'vehicle' ? 'on' : ''}">Vehicle</button><button data-v="foot" class="${ev.mode === 'foot' ? 'on' : ''}">On foot</button></div></div>
          <div class="field"><label>Departure after breach (warning + mobilisation) <b id="t0v">${s.t0} min</b></label><input type="range" id="t0" min="0" max="90" step="5" value="${s.t0}"/></div>
          <div class="dim" style="font-size:11px">Time-aware routing: a road segment is used only if it can be cleared ≥ ${E.ROUTE_MARGIN} min before simulated water on it exceeds ${s.roadThreshold} m.</div>
        </div>
        <div class="card" id="eres"></div>
        <div class="note">SIMULATED EVACUATION DECISION SUPPORT — routes are computed on a synthetic demo road network using simulated flood zones. They are not officially approved evacuation routes and must be validated by the district administration.</div>
      </div>
      <div class="dash-map"><div class="map-wrap" id="emap"></div></div></div>`;
    const mv = U.mountMap(view.querySelector('#emap'), { mode: 'evac', layers: { river: true, dam: true, arrows: false, extent: true, villages: true, labels: true, roads: true, bridges: true, infra: false, routes: false, safe: true } });
    const { res, ana } = FS.app.cur();
    mv.update({ res, ana, t: s.cfg.duration });
    const run = () => {
      const plan = E.planEvacuation(ev.start, ev.dest, ana.roadEval, { mode: ev.mode, t0: s.t0 });
      const v = ana.villages.find((x) => x.id === ev.start);
      const r = plan.recommended, z = D.safeZones.find((x) => x.id === plan.dest);
      const routeBlock = (rt, title, col) => `<div style="border-left:3px solid ${col};padding-left:10px;margin-top:10px"><div style="font-weight:600">${title}</div>
        <div class="pop-grid" style="font-size:12.5px"><span>Distance</span><span>${rt.len.toFixed(1)} km</span><span>Travel time</span><span>~${Math.round(rt.time)} min</span><span>Flood risk on route</span><span>${U.risk(rt.risk)}</span>
        <span>Min. safety margin</span><span>${isFinite(rt.minMargin) ? Math.round(rt.minMargin) + ' min' : 'never floods'}</span></div>
        <div class="dim" style="font-size:11px;margin-top:3px">${rt.edges.map((e) => e.id).join(' → ')}</div></div>`;
      view.querySelector('#eres').innerHTML = `<h3>Route result ${U.demo('SIMULATED')}</h3>
        <div style="text-align:center;font-size:13px;line-height:1.7">
          <div><span class="risk risk-${v.risk}">${v.name}</span> <span class="dim">(${v.affected ? 'floods T+' + Math.round(v.arrival) + ' min, ' + v.depth.toFixed(1) + ' m' : 'not flooded'})</span></div>
          <div class="dim">↓</div><div>${r ? `Safe road · ${r.edges.length} segments · ${r.len.toFixed(1)} km` : '<span class="risk risk-UNSAFE">NO SAFE ROAD ROUTE</span>'}</div><div class="dim">↓</div>
          <div>${z ? `<span class="risk risk-LOW">${z.name}</span>` : '<span class="muted">Shelter in place / vertical evacuation</span>'}</div></div>
        ${r ? routeBlock(r, 'Recommended route', '#22c55e') : `<div class="note mt">${T('shelter')}</div>`}
        ${plan.alternative ? routeBlock(plan.alternative, 'Alternative route', '#facc15') : r ? '<div class="dim mt" style="font-size:12px">No distinct alternative route found.</div>' : ''}
        ${plan.naive ? `<div class="mt" style="border-left:3px solid #ef4444;padding-left:10px"><div style="font-weight:600">Flooded / blocked roads on shortest (flood-unaware) path</div><div style="font-size:12.5px">${plan.naive.blocked.map((e) => `${e.name} — impassable from T+${Math.round(ana.roadEval[e.id].blockTime)} min`).join('<br>')}</div></div>` : ''}
        <div class="row mt" style="gap:6px"><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>`;
      mv.focusRoute(plan, ana.villages);
    };
    view.querySelector('#es').onchange = (e) => { ev.start = e.target.value; run(); };
    view.querySelector('#ed').onchange = (e) => { ev.dest = e.target.value; run(); };
    view.querySelector('#em').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ev.mode = b.dataset.v; view.querySelectorAll('#em button').forEach((x) => x.classList.toggle('on', x === b)); run(); };
    view.querySelector('#t0').oninput = (e) => { s.t0 = +e.target.value; view.querySelector('#t0v').textContent = s.t0 + ' min'; run(); };
    view.querySelector('#t0').onchange = () => FS.app.recomputeAnalysis();
    setTimeout(() => { if (!mv.dead) { mv.map.invalidateSize(); run(); } }, 60);
    return () => mv.destroy();
  };

  // ---------- HADR PRIORITY ----------
  const FACTORS = [['population', 'Population', 'Village population ÷ largest village population'], ['depth', 'Flood depth', 'Max depth ÷ 4 m (capped at 1)'], ['arrival', 'Arrival time', '1 − arrival ÷ 240 min (earlier = higher)'], ['infrastructure', 'Critical infra', 'Schools + health facilities in village ÷ 3'], ['accessibility', 'Accessibility', 'Evacuation travel time ÷ 60 min; 1 if no safe route'], ['roads', 'Road availability', 'Share of village access roads flooded']];
  const accTag = (a) => `<span class="risk risk-${{ GOOD: 'LOW', MODERATE: 'MEDIUM', LOW: 'HIGH', NONE: 'UNSAFE' }[a]}">${a === 'NONE' ? 'NO ROUTE' : a}</span>`;
  V.priority = function (view) {
    const s = st();
    s.priFilter = s.priFilter || 'all';
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_priority')}</h1><p>Transparent, rule-based and configurable priority scoring for HADR response. No machine-learning prediction is used.</p></div>${U.demo('PROTOTYPE DECISION-SUPPORT OUTPUT')}</div>
    <div class="grid" style="grid-template-columns:280px minmax(0,1fr) 360px">
      <div class="card"><h3>Scoring weights</h3><div id="wts"></div><button class="btn btn-sm mt" id="wreset">Reset weights</button>
        <div class="dim mt" style="font-size:11px">Score = Σ (weightᵢ × factorᵢ) ÷ Σ weights × 100. HIGH ≥ 55, MEDIUM ≥ 35, else LOW. Unaffected locations score 0.</div></div>
      <div class="card"><h3>Ranked HADR response table <div class="seg" id="pf">${['all', 'HIGH', 'MEDIUM', 'LOW'].map((p) => `<button data-v="${p}" class="${s.priFilter === p ? 'on' : ''}">${p === 'all' ? 'All' : p}</button>`).join('')}</div></h3><div class="tbl-wrap" style="max-height:620px"><table class="tbl" id="pt"></table></div></div>
      <div style="display:flex;flex-direction:column;gap:10px"><div class="card" id="pex"></div></div>
    </div>
    <div class="note mt">Priority scores, risk classes and alerts are prototype decision-support outputs from simulated data. They must be validated by authorised disaster-management authorities before operational use.</div>`;
    const drawW = () => {
      view.querySelector('#wts').innerHTML = FACTORS.map(([k, l, d]) => `<div class="field" title="${d}"><label>${l} <b>${s.weights[k]}</b></label><input type="range" min="0" max="50" step="5" value="${s.weights[k]}" data-k="${k}"/></div>`).join('');
    };
    const draw = () => {
      const { ana } = FS.app.cur();
      const list = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score);
      if (!s.priSel || !list.find((v) => v.id === s.priSel)) s.priSel = list[0] && list[0].id;
      view.querySelector('#pt').innerHTML = `<tr><th>#</th><th>Priority</th><th>Location</th><th class="num">Population</th><th class="num">Depth</th><th class="num">Arrival</th><th class="num">Infra</th><th>Accessibility</th><th class="num">Score</th></tr>` +
        list.map((v, i) => ({ v, i })).filter(({ v }) => s.priFilter === 'all' || v.priority === s.priFilter).map(({ v, i }) => `<tr class="click ${s.priSel === v.id ? 'sel' : ''}" data-id="${v.id}"><td>${i + 1}</td><td>${U.risk(v.priority)}</td><td>${v.name}<div class="dim" style="font-size:11px">${D.panchayats.find((p) => p.id === v.gp).name}</div></td><td class="num">${F.n(v.pop)}</td><td class="num">${v.depth.toFixed(1)} m</td><td class="num">${Math.round(v.arrival)} min</td><td class="num">${v.infra.filter((f) => f.type === 'school' || f.type === 'health').length}</td><td>${accTag(v.accessLabel)}</td><td class="num"><b>${v.score.toFixed(0)}</b></td></tr>`).join('');
      const v = list.find((x) => x.id === s.priSel);
      if (!v) { view.querySelector('#pex').innerHTML = '<h3>Explanation</h3><div class="muted">No affected locations.</div>'; return; }
      view.querySelector('#pex').innerHTML = `<h3>Why this priority?</h3>
        <div class="row between"><div style="font-size:17px;font-weight:700">${v.name}</div>${U.risk(v.priority)}</div><div class="muted mb" style="font-size:12px">Score ${v.score.toFixed(1)} / 100</div>
        <div class="pop-grid mb" style="font-size:12.5px"><span>Population (est.)</span><span>${F.n(v.pop)}</span><span>Depth</span><span>${v.depth.toFixed(2)} m</span><span>Arrival</span><span>${Math.round(v.arrival)} min</span><span>Critical infrastructure</span><span>${v.infra.filter((f) => f.type === 'school' || f.type === 'health').length}</span><span>Road accessibility</span><span>${accTag(v.accessLabel)}</span></div>
        <div class="muted" style="font-size:11px;margin-bottom:4px">Factor value (0–1) → contribution to score</div>
        ${FACTORS.map(([k, l]) => `<div class="factor" title="${FACTORS.find((x) => x[0] === k)[2]}"><span>${l}</span><div class="bar"><i style="width:${(v.factors[k] * 100).toFixed(0)}%"></i></div><span class="mono" style="text-align:right">+${v.contrib[k].toFixed(1)}</span></div>`).join('')}
        <div class="muted mt" style="font-size:12px">Recommended action</div><div style="font-size:12.5px">${v.evac.recommended ? `Evacuate to ${v.safeZone} via ${v.evac.recommended.edges.map((e) => e.id).join(' → ')} (~${Math.round(v.evac.recommended.time)} min).` : T('shelter')}${v.evac.avoidIds.length ? ` Avoid ${v.evac.avoidIds.join(', ')}.` : ''}</div>
        <div class="row mt wrap" style="gap:6px"><button class="btn btn-sm btn-primary" data-act="alert" data-id="${v.id}">Generate emergency alert</button><button class="btn btn-sm" data-act="evac" data-id="${v.id}">View route</button></div>`;
    };
    drawW(); draw();
    let tmr;
    view.querySelector('#wts').oninput = (e) => {
      const k = e.target.dataset.k; if (!k) return;
      s.weights[k] = +e.target.value; e.target.previousElementSibling.querySelector('b').textContent = e.target.value;
      clearTimeout(tmr); tmr = setTimeout(() => { FS.app.recomputeAnalysis(); draw(); FS.app.renderStatus(); }, 120);
    };
    view.querySelector('#wreset').onclick = () => { Object.assign(s.weights, E.DEFAULT_WEIGHTS); FS.app.recomputeAnalysis(); drawW(); draw(); };
    view.querySelector('#pf').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; s.priFilter = b.dataset.v; view.querySelectorAll('#pf button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    view.querySelector('#pt').onclick = (e) => { const r = e.target.closest('tr[data-id]'); if (r) { s.priSel = r.dataset.id; draw(); } };
  };

  // ---------- ALERT MODAL ----------
  V.alertModal = function (vid) {
    const s = st();
    const { ana } = FS.app.cur();
    const v = ana.villages.find((x) => x.id === vid);
    if (!v.affected) { FS.app.modal('Emergency alert', `<p>${v.name} is not inundated in the current simulated scenario. No alert generated.</p>`); return; }
    let kind = 'sms', lang = s.lang;
    FS.app.modal(`Emergency alert — ${v.name}`, `<div class="row between mb wrap"><div class="seg" id="ak"><button data-v="sms" class="on">SMS-style</button><button data-v="wa">WhatsApp-style</button><button data-v="brief">Printable brief</button></div>
      <div class="seg" id="al"><button data-v="en" class="${lang === 'en' ? 'on' : ''}">EN</button><button data-v="hi" class="${lang === 'hi' ? 'on' : ''}">हिन्दी</button></div></div>
      <div id="aout"></div>
      <div class="row mt" style="justify-content:space-between"><span class="dim" style="font-size:11px" id="alen"></span><div class="row" style="gap:6px"><button class="btn btn-sm" id="acopy">Copy text</button><button class="btn btn-sm" id="aprint">Print</button></div></div>
      <div class="note mt">Text generated only — <b>no SMS / WhatsApp gateway is connected and nothing has been sent</b>. Alerts are prototype outputs from a simulated scenario and must be validated and issued by authorised authorities.</div>`, (b) => {
      const text = () => (kind === 'sms' ? FS.exporter.sms(v, ana, lang) : kind === 'wa' ? FS.exporter.whatsapp(v, ana, lang) : FS.exporter.brief(v, ana, lang));
      const draw = () => {
        const t = text();
        b.querySelector('#aout').innerHTML = kind === 'wa' ? `<div class="wa"><div class="wa-bubble">${F.esc(t).replace(/\*(.+?)\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>')}</div></div>` : `<div class="alert-box">${F.esc(t)}</div>`;
        b.querySelector('#alen').textContent = kind === 'sms' ? `${t.length} characters${lang === 'hi' ? ' (Unicode SMS: 70 chars/segment)' : ' (GSM: 160 chars/segment)'}` : '';
      };
      b.querySelector('#ak').onclick = (e) => { const x = e.target.closest('button'); if (!x) return; kind = x.dataset.v; b.querySelectorAll('#ak button').forEach((y) => y.classList.toggle('on', y === x)); draw(); };
      b.querySelector('#al').onclick = (e) => { const x = e.target.closest('button'); if (!x) return; lang = x.dataset.v; b.querySelectorAll('#al button').forEach((y) => y.classList.toggle('on', y === x)); draw(); };
      b.querySelector('#acopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(text()).then(() => FS.app.toast('Alert text copied (not sent)')); };
      b.querySelector('#aprint').onclick = () => { const w = window.open('', '_blank'); w.document.write(`<pre style="font:14px/1.5 monospace;white-space:pre-wrap">${F.esc(text())}</pre>`); w.document.close(); w.print(); };
      draw();
    });
  };

  // ---------- SCENARIO COMPARISON (WHAT-IF) ----------
  V.whatif = function (view) {
    const s = st();
    const key = JSON.stringify([s.cfg, s.activeModel, s.weights]);
    if (!s.whatIf || s.whatIf.key !== key) {
      const mk = (name, label, cfg) => {
        const c = Object.assign({}, s.cfg, cfg, { peakDischarge: cfg.peakDischarge || 0 });
        const res = E.runModel(c, s.activeModel), ana = E.analyse(res, { weights: s.weights, roadThreshold: s.roadThreshold, t0: s.t0 });
        return { name, label, cfg: c, res, K: ana.kpi };
      };
      s.whatIf = { key, rows: [mk('A', 'Small breach', D.presets.small), mk('B', 'Medium breach', D.presets.medium), mk('C', 'Severe breach', D.presets.severe), mk('D', 'Current configuration', FS.app.effectiveCfg())] };
    }
    const rows = s.whatIf.rows;
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_whatif')} — What-if simulator</h1><p>Compare breach conditions using the ${FS.app.cur().res.model.name} surrogate. Scenario D follows the current Scenario Builder settings.</p></div><span class="tag tag-demo">SIMULATED DEMO RESULTS</span></div>
    <div class="card mb"><h3>Scenario comparison table ${U.demo('SIMULATED DEMO RESULTS')}</h3><div class="tbl-wrap" style="max-height:none"><table class="tbl">
      <tr><th>Scenario</th><th class="num">Breach width</th><th class="num">Breach depth</th><th class="num">Initial water level</th><th class="num">Formation time</th><th class="num">Peak discharge</th><th class="num">Flood area</th><th class="num">Max depth</th><th class="num">First arrival</th><th class="num">Villages</th><th class="num">Buildings / assets</th><th class="num">Bridges</th><th class="num">Population</th><th></th></tr>
      ${rows.map((r) => `<tr><td><b>${r.name}</b> · ${r.label}</td><td class="num">${r.cfg.breachWidth} m</td><td class="num">${r.cfg.waterLevel} m</td><td class="num">${r.cfg.waterLevel} m</td><td class="num">${r.cfg.breachTime} min</td><td class="num">${F.n(r.res.Qp)} m³/s</td><td class="num">${F.n(r.K.area, 1)} km²</td><td class="num">${r.K.maxDepth.toFixed(2)} m</td><td class="num">${F.min(r.K.firstArrival)}</td><td class="num">${r.K.villages}</td><td class="num">${r.K.infra}</td><td class="num">${r.K.bridges}</td><td class="num">${F.n(r.K.population)}</td><td>${r.name !== 'D' ? `<button class="btn btn-sm" data-load="${r.name}">Load</button>` : ''}</td></tr>`).join('')}
    </table></div><div class="dim" style="font-size:11px;margin-top:6px">Breach depth is taken as the head above the breach invert (equal to initial water level in this demo). "Buildings / assets" counts synthetic critical facilities with depth &gt; 0.05 m.</div></div>
    <div class="grid g3"><div class="card"><h3>Flooded area &amp; peak discharge</h3><div style="height:260px"><canvas id="w1"></canvas></div></div>
      <div class="card"><h3>Affected villages &amp; assets</h3><div style="height:260px"><canvas id="w2"></canvas></div></div>
      <div class="card"><h3>Front arrival along river</h3><div style="height:260px"><canvas id="w3"></canvas></div></div></div>`;
    const cols = ['#22c55e', '#f59e0b', '#ef4444', '#22d3ee'];
    const labels = rows.map((r) => `${r.name}: ${r.label}`);
    const c1 = new Chart(view.querySelector('#w1'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Flood area (km²)', data: rows.map((r) => +r.K.area.toFixed(1)), backgroundColor: cols, yAxisID: 'y' }, { type: 'line', label: 'Peak discharge (m³/s)', data: rows.map((r) => Math.round(r.res.Qp)), borderColor: '#e2e8f0', yAxisID: 'y1' }] }, options: { maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'km²' } }, y1: { position: 'right', grid: { drawOnChartArea: false } } } } });
    const c2 = new Chart(view.querySelector('#w2'), { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'Villages', data: rows.map((r) => r.K.villages), backgroundColor: '#f59e0b' }, { label: 'Critical assets', data: rows.map((r) => r.K.infra), backgroundColor: '#ef4444' }, { label: 'Bridges', data: rows.map((r) => r.K.bridges), backgroundColor: '#8b5cf6' }] }, options: { maintainAspectRatio: false } });
    const stn = E.R.stations.filter((_, i) => i % 6 === 0);
    const c3 = new Chart(view.querySelector('#w3'), { type: 'line', data: { labels: stn.map((p) => p.s.toFixed(0)), datasets: rows.map((r, i) => ({ label: labels[i], data: stn.map((p) => Math.round(r.res.st.ta[Math.round(p.s / E.STEP)])), borderColor: cols[i], pointRadius: 0 })) }, options: { maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Chainage (km)' } }, y: { title: { display: true, text: 'Arrival (min)' } } } } });
    view.onclick = (e) => { const b = e.target.closest('[data-load]'); if (!b) return; const k = { A: 'small', B: 'medium', C: 'severe' }[b.dataset.load]; FS.app.applyPreset(k); FS.app.go('builder'); FS.app.toast(`${D.presets[k].label} loaded into Scenario Builder`); };
    return () => { c1.destroy(); c2.destroy(); c3.destroy(); view.onclick = null; };
  };

  // ---------- EXPORT & REPORTS ----------
  V.export = function (view) {
    const s = st();
    s.exportLog = s.exportLog || [];
    let mkey = s.activeModel;
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_export')}</h1><p>Export the simulated inundation boundary and generate reports and emergency messages.</p></div>${U.demo('ALL OUTPUTS LABELLED SIMULATED')}</div>
    <div class="grid g2">
      <div class="card"><h3>GIS &amp; report exports</h3>
        <div class="field"><label>Model result to export</label><div class="seg" id="xm"><button data-v="sph">SPH</button><button data-v="delft3d">Delft3D</button></div></div>
        <div class="grid g2">
          <button class="btn btn-lg" data-x="kml">⤓ Export KML</button><button class="btn btn-lg" data-x="shp">⤓ Export SHP (zip)</button>
          <button class="btn btn-lg" data-x="geojson">⤓ Export GeoJSON</button><button class="btn btn-lg" data-x="png">⤓ Download Flood Map</button>
          <button class="btn btn-lg btn-primary" data-x="pdf" style="grid-column:span 2">Generate PDF Report</button></div>
        <div class="dim mt" style="font-size:11px">SHP export: polygon shapefile (.shp/.shx/.dbf/.prj, WGS84) of the simulated maximum inundation envelope. PDF: opens a print-ready report — choose "Save as PDF" in the print dialog.</div>
        <h3 class="mt">Export log</h3><ul class="steps" id="xlog"></ul></div>
      <div class="card"><h3>Report contents</h3><ul class="steps">${['Scenario name, river, dam, scenario type', 'Simulation time & model used', 'Maximum flood depth, velocity, inundated area, arrival time', 'Affected settlements & panchayat impact', 'Infrastructure impact (schools, PHCs, bridges, roads)', 'Evacuation analysis (simulated routes)', 'HADR priority ranking with weights', 'SPH vs Delft3D comparison', 'Map snapshot (locally rendered)', 'Data sources, DEM used, satellite source'].map((x) => `<li class="ok"><span class="si">✓</span>${x}</li>`).join('')}</ul></div>
    </div>
    <div class="card mt"><h3>Emergency alert export</h3>
      <div class="row wrap" style="gap:8px"><select id="av" style="width:auto">${FS.app.cur().ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score).map((v) => `<option value="${v.id}">${v.name} — ${v.priority}</option>`).join('')}</select>
      <button class="btn" data-a="sms">Generate SMS Alert</button><button class="btn" data-a="wa">Generate WhatsApp-Style Alert</button><button class="btn" data-a="brief">Print Emergency Brief</button><button class="btn" data-a="all">Download all alerts (.txt)</button></div>
      <div class="note mt">Alerts are generated as text only. No SMS / WhatsApp messaging backend is connected; nothing is delivered.</div></div>`;
    const seg = () => view.querySelectorAll('#xm button').forEach((b) => b.classList.toggle('on', b.dataset.v === mkey));
    seg();
    view.querySelector('#xm').onclick = (e) => { const b = e.target.closest('button'); if (b) { mkey = b.dataset.v; seg(); } };
    const log = (m) => { s.exportLog.unshift(`${new Date().toLocaleTimeString('en-IN')} · ${m}`); view.querySelector('#xlog').innerHTML = s.exportLog.slice(0, 8).map((x) => `<li class="ok"><span class="si">✓</span>${x}</li>`).join(''); };
    view.querySelector('#xlog').innerHTML = s.exportLog.slice(0, 8).map((x) => `<li class="ok"><span class="si">✓</span>${x}</li>`).join('') || '<li>No exports yet.</li>';
    const scen = FS.app.scenarioName();
    view.onclick = async (e) => {
      const b = e.target.closest('[data-x]');
      if (b) {
        const res = s.res[mkey], ana = s.ana[mkey], X = FS.exporter, name = `floodsim_${mkey}_${X.stamp()}`;
        try {
          if (b.dataset.x === 'kml') { X.download(name + '.kml', X.kml(res, ana, scen), 'application/vnd.google-earth.kml+xml'); log(`KML exported (${res.model.short})`); }
          if (b.dataset.x === 'geojson') { X.download(name + '.geojson', JSON.stringify(X.geojson(res, ana)), 'application/geo+json'); log(`GeoJSON exported (${res.model.short})`); }
          if (b.dataset.x === 'shp') { X.download(name + '_shp.zip', await X.shpZip(res, ana, scen)); log(`Shapefile exported (${res.model.short})`); }
          if (b.dataset.x === 'png') { const url = await X.mapSnapshot(res, ana, s.cfg.duration, `${scen} — ${res.model.name} — max depth`); const a = document.createElement('a'); a.href = url; a.download = name + '.png'; a.click(); log('Flood map PNG downloaded'); }
          if (b.dataset.x === 'pdf') {
            const other = mkey === 'sph' ? 'delft3d' : 'sph';
            const img = await X.mapSnapshot(res, ana, s.cfg.duration, `${scen} — ${res.model.name}`);
            const html = X.report({ st: s, res, ana, other: s.res[other], otherAna: s.ana[other], img, scen });
            const w = window.open('', '_blank');
            if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); } else X.download(name + '_report.html', html, 'text/html');
            log('Report generated successfully'); FS.app.toast('Report generated successfully');
          }
        } catch (err) { FS.app.toast('Export failed: ' + err.message); }
      }
      const a = e.target.closest('[data-a]');
      if (a) {
        const vid = view.querySelector('#av').value;
        if (a.dataset.a === 'all') {
          const { ana } = FS.app.cur();
          const txt = ana.villages.filter((v) => v.affected).sort((x, y) => y.score - x.score).map((v) => FS.exporter.brief(v, ana, s.lang)).join('\n\n\n');
          FS.exporter.download(`floodsim_alerts_${FS.exporter.stamp()}.txt`, txt); log('All alert briefs downloaded (text only)');
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
    const s = st();
    const tag = (x) => ({ REAL: '<span class="tag tag-real">REAL DATA</span>', DEMO: '<span class="tag tag-demo">DEMO DATA</span>', SIM: '<span class="tag tag-sim">SIMULATED</span>', NC: '<span class="tag tag-nc">NOT CONNECTED</span>' }[x]);
    const today = new Date().toLocaleDateString('en-IN');
    const sec = [
      ['Terrain', [['DEM — SRTM 30 m', 'NASA / USGS (via backend)', 'NC', '—', 'Hydrodynamic terrain'], ['DEM — ASTER GDEM v3', 'NASA / METI', 'NC', '—', 'Alternative terrain'], ['DEM Demo Dataset', 'Procedurally generated (this prototype)', 'DEMO', 'Bundled', 'Terrain for all demo runs']]],
      ['Remote Sensing', [['Sentinel-1 SAR / Sentinel-2 MSI', 'ESA Copernicus (via GEE)', 'NC', '—', 'Flood detection'], ['Landsat 8/9', 'USGS (via GEE)', 'NC', '—', 'Flood detection'], ['Basemap imagery', 'Esri World Imagery (tiles)', s.online ? 'REAL' : 'NC', s.online ? 'Live tiles' : 'Offline', 'Visual context only'], ['Observed water mask', 'Synthetic (perturbed simulation)', 'DEMO', 'Generated', 'NRT workflow demo']]],
      ['Hydrology', [['River discharge', 'CWC / India-WRIS', 'NC', '—', 'Boundary conditions'], ['Water level', 'CWC gauges', 'NC', '—', 'Calibration'], ['Rainfall', 'IMD / GPM IMERG', 'NC', '—', 'Antecedent conditions'], ['Dam characteristics', 'Hypothetical Demo Dam', 'DEMO', 'Bundled', 'Breach parameters'], ['River centreline', 'OpenStreetMap (ODbL), simplified snapshot', 'REAL', 'OSM snapshot 2026-06', 'Model geometry']]],
      ['GIS', [['Roads', 'Synthetic network', 'DEMO', 'Bundled', 'Impact & routing'], ['Villages', 'Synthetic settlements & populations', 'DEMO', 'Bundled', 'Impact'], ['Panchayats', 'Synthetic groupings / boundaries', 'DEMO', 'Bundled', 'Aggregation'], ['Bridges', 'Synthetic', 'DEMO', 'Bundled', 'Impact & routing'], ['Critical infrastructure', 'Synthetic', 'DEMO', 'Bundled', 'Impact'], ['Safe zones', 'Synthetic (not notified relief camps)', 'DEMO', 'Bundled', 'Evacuation'], ['Basemap vectors', 'Esri basemap tiles (incl. © OpenStreetMap contributors)', s.online ? 'REAL' : 'NC', s.online ? 'Live tiles' : 'Offline', 'Visual context only']]],
      ['Model outputs', [['SPH results', 'Parametric surrogate (SPH offsets)', 'SIM', s.lastRun ? s.lastRun.toLocaleString('en-IN') : '—', 'Flood maps'], ['Delft3D results', 'Parametric surrogate (Delft3D offsets)', 'SIM', s.lastRun ? s.lastRun.toLocaleString('en-IN') : '—', 'Flood maps'], ['SPH / Delft3D solvers', 'Modelling backend', 'NC', '—', 'Real numerical modelling']]]
    ];
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_data')}</h1><p>Datasets used or expected by the system and their current connection status (checked ${today}).</p></div></div>
    <div class="row wrap mb" style="gap:14px;font-size:12px">${tag('REAL')} Live third-party data${tag('DEMO')} Bundled demonstration/synthetic data${tag('SIM')} Outputs of the prototype surrogate${tag('NC')} Expected source, not integrated</div>
    ${sec.map(([t, rows]) => `<div class="card mb"><h3>${t}</h3><table class="tbl"><tr><th>Data type</th><th>Source</th><th>Status</th><th>Last updated</th><th>Used for</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td class="muted">${r[1]}</td><td>${tag(r[2])}</td><td class="muted">${r[3]}</td><td class="muted">${r[4]}</td></tr>`).join('')}</table></div>`).join('')}`;
  };

  // ---------- SYSTEM ARCHITECTURE ----------
  V.arch = function (view) {
    const box = (x, y, w, t, sub, col) => `<g><rect x="${x}" y="${y}" width="${w}" height="${sub ? 46 : 34}" rx="6" fill="#0e1828" stroke="${col || '#273a57'}" stroke-width="1.5"/><text x="${x + w / 2}" y="${y + (sub ? 20 : 22)}" fill="#e6edf6" font-size="12.5" font-weight="600" text-anchor="middle">${t}</text>${sub ? `<text x="${x + w / 2}" y="${y + 36}" fill="#8ea0b8" font-size="10.5" text-anchor="middle">${sub}</text>` : ''}</g>`;
    const ar = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4b6488" stroke-width="1.5" marker-end="url(#ah)"/>`;
    const defs = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#4b6488"/></marker></defs>';
    // main pipeline
    const X = 150, W = 260; let y = 10; const g = 62;
    let m = defs;
    const main = [['Data Sources', 'DEM · hydrology · satellite · GIS', '#22d3ee'], ['Data Preprocessing', 'reprojection, gap-fill, mesh / particle setup'], ['DEM + Hydrological + Satellite Data', 'harmonised model inputs']];
    main.forEach((b, i) => { m += box(X, y, W, b[0], b[1], b[2]); if (i < main.length) m += ar(X + W / 2, y + 46, X + W / 2, y + g - 2); y += g; });
    m += box(X, y, W, 'Hydrodynamic Modelling Engine', 'backend (not connected in MVP)', '#f59e0b'); const yE = y; y += g + 6;
    m += box(20, y, 190, 'SPH', 'Smooth Particle Hydrodynamics', '#f97316') + box(350, y, 190, 'Delft3D', 'Delft3D-FM shallow-water', '#38bdf8');
    m += ar(X + W / 2 - 40, yE + 46, 115, y - 2) + ar(X + W / 2 + 40, yE + 46, 445, y - 2);
    const yM = y; y += g + 10;
    m += box(560, yM + 6, 180, 'Scenario Comparison', 'SPH vs Delft3D', '#8b5cf6') + ar(540, yM + 23, 558, yM + 29);
    m += `<path d="M210,${yM + 23} C 300,${yM - 10} 470,${yM - 20} 560,${yM + 18}" stroke="#4b6488" fill="none" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    m += ar(115, yM + 46, X + W / 2 - 30, y - 2) + ar(445, yM + 46, X + W / 2 + 30, y - 2);
    const rest = [['Flood Inundation Engine', 'depth · velocity · arrival · duration'], ['GIS Visualization', 'Leaflet map, layers, timeline'], ['Impact & Loss Analysis', 'villages · panchayats · infrastructure'], ['Evacuation Intelligence', 'time-aware routing'], ['HADR Priority Engine', 'transparent weighted scoring'], ['KML / SHP / PDF', 'exports & alerts'], ['HADR Decision Support', 'DDMA / SDMA / NDRF', '#22c55e']];
    rest.forEach((b, i) => { m += box(X, y, W, b[0], b[1], b[2]); if (i < rest.length - 1) m += ar(X + W / 2, y + 46, X + W / 2, y + g - 2); y += g; });
    const H1 = y;
    // satellite path
    let y2 = 10; let s2 = defs;
    [['Satellite Data', 'Sentinel-1/2, Landsat', '#22d3ee'], ['Google Earth Engine', 'server-side (not connected)', '#f59e0b'], ['Flood Detection', 'SAR threshold + change detection'], ['Near-Real-Time Analysis', 'observed vs simulated extent', '#22c55e']].forEach((b, i, a) => { s2 += box(20, y2, 250, b[0], b[1], b[2]); if (i < a.length - 1) s2 += ar(145, y2 + 46, 145, y2 + g - 2); y2 += g; });
    let y3 = 10; let s3 = defs;
    [['Flood Simulation', 'surrogate / SPH / Delft3D', '#22d3ee'], ['Village / Panchayat Impact', 'depth, arrival, duration, population'], ['Infrastructure Analysis', 'schools, PHCs, roads, bridges'], ['Evacuation Route Analysis', 'flood-aware Dijkstra'], ['Emergency Alert Generation', 'SMS / WhatsApp-style / print (text only)', '#22c55e']].forEach((b, i, a) => { s3 += box(20, y3, 250, b[0], b[1], b[2]); if (i < a.length - 1) s3 += ar(145, y3 + 46, 145, y3 + g - 2); y3 += g; });
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_arch')}</h1><p>End-to-end data and modelling flow. Components marked "not connected" are backend integration points; the MVP substitutes a browser-side surrogate.</p></div></div>
    <div class="grid arch" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="card"><h3>Modelling &amp; decision-support pipeline</h3><svg viewBox="0 0 760 ${H1}" width="100%">${m}</svg></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card"><h3>Near-real-time remote sensing path</h3><svg viewBox="0 0 290 ${y2}" width="100%" style="max-height:300px">${s2}</svg></div>
        <div class="card"><h3>HADR response path</h3><svg viewBox="0 0 290 ${y3}" width="100%" style="max-height:360px">${s3}</svg></div>
        <div class="card"><h3>MVP implementation</h3><div style="font-size:12.5px;line-height:1.7">Frontend: HTML + CSS + JavaScript (no build step)<br>Maps: Leaflet 1.9 · Charts: Chart.js 4 · Zip: JSZip<br>Engine: <span class="mono">js/engine.js</span> parametric surrogate<br>Backend hook: <span class="mono">FS.backend</span> in <span class="mono">js/app.js</span><br>i18n: <span class="mono">js/i18n.js</span> (EN, HI; extensible)</div></div>
      </div></div>`;
  };

  // ---------- SETTINGS ----------
  V.settings = function (view) {
    const s = st();
    let cacheInfo = '—';
    try { const c = localStorage.getItem('floodsim_hadr_cache_v1'); cacheInfo = c ? `${(c.length / 1024).toFixed(1)} KB · saved ${new Date(JSON.parse(c).savedAt).toLocaleString('en-IN')}` : 'empty'; } catch (e) { cacheInfo = 'unavailable'; }
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_settings')}</h1><p>Language, connectivity, analysis thresholds and backend configuration.</p></div></div>
    <div class="grid g2">
      <div class="card"><h3>Language</h3><div class="field"><label>Interface language</label><select id="lang">${Object.entries(FS.i18n.langs).map(([k, l]) => `<option value="${k}" ${s.lang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="dim" style="font-size:11px">Strings live in <span class="mono">js/i18n.js</span>. Add a regional language (e.g. Bengali, Marathi, Odia) by adding a dictionary with the same keys; missing keys fall back to English.</div></div>
      <div class="card"><h3>Connectivity</h3>
        <div class="row between mb"><div>Current mode</div><span class="chip ${s.online ? '' : 'warn'}"><span class="led"></span><b>${s.online ? 'ONLINE MODE' : 'OFFLINE / CACHED DEMO MODE'}</b></span></div>
        <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="off" ${s.forceOffline ? 'checked' : ''}/> Low-connectivity mode (use bundled DEM basemap, no tile downloads)</label>
        <div class="dim mt" style="font-size:11px">Scenario data, synthetic DEM and all analysis run locally and remain usable without internet. Settings and the last scenario are cached in browser storage (${cacheInfo}). Online basemap tiles are not pre-cached in this MVP.</div>
        <button class="btn btn-sm mt" id="clr">Clear local cache</button></div>
      <div class="card"><h3>Analysis thresholds</h3>
        <div class="field"><label>Road impassable above water depth <b id="rtv">${s.roadThreshold} m</b></label><input type="range" id="rt" min="0.1" max="1" step="0.05" value="${s.roadThreshold}"/></div>
        <div class="field"><label>Default evacuation departure (after breach) <b id="t0v">${s.t0} min</b></label><input type="range" id="t0" min="0" max="90" step="5" value="${s.t0}"/></div>
        <button class="btn btn-sm" id="apply">Apply &amp; recompute</button></div>
      <div class="card"><h3>Modelling backend</h3><div class="field"><label>Backend API endpoint</label><input type="text" disabled value="Not configured"/></div>
        <div class="row between"><span>SPH solver</span><span class="tag tag-nc">NOT CONNECTED</span></div><div class="row between mt"><span>Delft3D solver</span><span class="tag tag-nc">NOT CONNECTED</span></div><div class="row between mt"><span>Google Earth Engine</span><span class="tag tag-nc">NOT CONNECTED</span></div><div class="row between mt"><span>SMS / WhatsApp gateway</span><span class="tag tag-nc">NOT CONNECTED</span></div>
        <div class="dim mt" style="font-size:11px">Integration contract: ${F.esc(FS.backend.contract)}</div></div>
    </div>`;
    view.querySelector('#lang').onchange = (e) => { s.lang = e.target.value; FS.app.save(); FS.app.go('settings'); };
    view.querySelector('#off').onchange = (e) => { s.forceOffline = e.target.checked; FS.app.save(); FS.app.renderStatus(); FS.app.toast(s.online ? 'ONLINE MODE' : 'OFFLINE / CACHED DEMO MODE enabled'); FS.app.go('settings'); };
    view.querySelector('#clr').onclick = () => { try { localStorage.removeItem('floodsim_hadr_cache_v1'); } catch (e) {} FS.app.toast('Local cache cleared'); FS.app.go('settings'); };
    view.querySelector('#rt').oninput = (e) => (view.querySelector('#rtv').textContent = e.target.value + ' m');
    view.querySelector('#t0').oninput = (e) => (view.querySelector('#t0v').textContent = e.target.value + ' min');
    view.querySelector('#apply').onclick = () => { s.roadThreshold = +view.querySelector('#rt').value; s.t0 = +view.querySelector('#t0').value; FS.app.recomputeAnalysis(); FS.app.renderStatus(); FS.app.toast('Thresholds applied — analysis recomputed'); };
  };
})();
