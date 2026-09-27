/* FloodSim HADR — page views (part 1). */
(function () {
  const E = FS.engine, D = FS.data, F = FS.fmt;
  const V = (FS.views = {});
  const st = () => FS.state;
  const T = (k) => FS.t(k);

  // ---------- shared UI helpers ----------
  const U = (FS.ui = {});
  U.risk = (r) => `<span class="risk risk-${String(r).replace(' ', '.')}">${r}</span>`;
  U.demo = (txt) => `<span class="tag tag-demo">${txt || 'SIMULATED DEMO DATA'}</span>`;
  U.kpi = (label, value, unit, accent) => `<div class="kpi ${accent ? 'accent-' + accent : ''}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  U.kpis = (K, full) => {
    const a = [
      U.kpi(T('maxDepth'), K.maxDepth.toFixed(2), 'm', 'red'),
      U.kpi(T('maxVel'), K.maxVel.toFixed(2), 'm/s', 'amber'),
      U.kpi(T('firstArrival'), isFinite(K.firstArrival) ? Math.round(K.firstArrival) : '—', 'min', 'red'),
      U.kpi(T('area'), F.n(K.area, 1), 'km²', 'cyan'),
      U.kpi(T('villages'), K.villages, `/ ${D.villages.length}`, 'amber'),
      U.kpi(T('population'), F.n(K.population), '', 'amber'),
      U.kpi(T('roads'), K.roads, `seg · ${F.n(K.roadKm, 0)} km`),
      U.kpi(T('bridges'), K.bridges, `/ ${E.ROADS.bridges.length}`),
      U.kpi(T('infra'), K.infra, '', 'red'),
      U.kpi(T('highPri'), K.highPriority, '', 'red')
    ];
    if (full) a.push(U.kpi(T('peakQ'), F.n(K.peakQ), 'm³/s', 'cyan'), U.kpi(T('panchayats'), K.panchayats, `/ ${D.panchayats.length}`));
    return a.join('');
  };
  U.mountMap = (el, opts) => {
    const s = st();
    const o = Object.assign({ basemap: s.online ? 'dark' : 'offline' }, opts || {});
    if (!s.online) o.layers = Object.assign({}, o.layers || {}, { dem: true });
    return new FS.mapkit.MapView(el, o);
  };
  const MARKS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
  U.timeline = (el, max, onChange, opts) => {
    const marks = MARKS.filter((m) => m <= max);
    if (marks[marks.length - 1] !== max) marks.push(max);
    const N = 20, top = (marks.length - 1) * N;
    const toT = (v) => { const i = Math.min(marks.length - 2, Math.floor(v / N)); return marks[i] + (marks[i + 1] - marks[i]) * ((v - i * N) / N); };
    const fromT = (t) => { for (let i = 0; i < marks.length - 1; i++) if (t <= marks[i + 1]) return i * N + ((t - marks[i]) / (marks[i + 1] - marks[i])) * N; return top; };
    el.innerHTML = `<div class="timebar"><button class="btn btn-sm" data-play style="width:38px">▶</button><div class="tnow"></div>
      <div class="tl-track"><input type="range" min="0" max="${top}" step="1"/><div class="tl-ticks">${marks.map((m, i) => `<span style="left:calc(${(i / (marks.length - 1)) * 100}% + ${8 - (i / (marks.length - 1)) * 16}px)" data-i="${i}">${m}</span>`).join('')}</div></div>
      <span class="muted" style="font-size:11px">min after breach</span></div>`;
    const inp = el.querySelector('input'), now = el.querySelector('.tnow'), play = el.querySelector('[data-play]');
    let timer = null;
    const set = (t, fire) => { t = Math.max(0, Math.min(max, t)); inp.value = fromT(t); now.textContent = `T+${Math.round(t)} min`; if (fire !== false) onChange(t); };
    inp.oninput = () => set(toT(+inp.value));
    el.querySelector('.tl-ticks').onclick = (e) => { const s = e.target.closest('span'); if (s) set(marks[+s.dataset.i]); };
    const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶'; };
    const start = () => {
      if (+inp.value >= top) set(0);
      play.textContent = '❚❚';
      timer = setInterval(() => { const v = +inp.value + 1; if (v > top) return stop(); set(toT(v)); }, (opts && opts.speed) || 90);
    };
    play.onclick = () => (timer ? stop() : start());
    return { set, start, stop, destroy: stop };
  };

  // ---------- DASHBOARD ----------
  V.dashboard = function (view) {
    const s = st();
    view.classList.add('fill');
    view.innerHTML = `<div class="dash">
      <div class="dash-map"><div class="map-wrap" id="dmap"></div><div id="dtl"></div></div>
      <div class="dash-side">
        <div class="card">
          <h3>Active scenario ${U.demo('DEMO SCENARIO')}</h3>
          <div style="font-weight:700;font-size:15px">${FS.app.scenarioName()}</div>
          <div class="muted" style="font-size:12px;margin:2px 0 10px">River: Kosi · Dam: ${D.dam.name} · ${s.runSource}</div>
          <div class="row between wrap"><div class="seg" id="modelSeg"><button data-m="sph">SPH</button><button data-m="delft3d">Delft3D</button></div>
          <div class="row" style="gap:6px"><button class="btn btn-sm" data-go="builder">Configure</button><button class="btn btn-sm btn-primary" id="rerun">Re-run</button></div></div>
        </div>
        <div class="kpis" id="dk" style="grid-template-columns:1fr 1fr"></div>
        <div class="card"><h3>Top HADR priorities <a href="#" data-go="priority" style="font-size:11px">All →</a></h3><table class="tbl" id="dpri"></table></div>
        <div class="card"><h3>Panchayat impact <a href="#" data-go="impact" style="font-size:11px">Details →</a></h3><table class="tbl" id="dgp"></table></div>
        <div class="note">Results are SIMULATED DEMO outputs for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
      </div></div>`;
    const mv = U.mountMap(view.querySelector('#dmap'), { mode: 'depth' });
    const draw = () => {
      const { res, ana } = FS.app.cur();
      mv.update({ res, ana, t: s.t });
      view.querySelector('#dk').innerHTML = U.kpis(ana.kpi);
      view.querySelectorAll('#modelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === s.activeModel));
      const top = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score).slice(0, 6);
      view.querySelector('#dpri').innerHTML = `<tr><th>Location</th><th class="num">Arrival</th><th class="num">Depth</th><th>Priority</th></tr>` +
        top.map((v) => `<tr class="click" data-act="village" data-id="${v.id}"><td>${v.name}</td><td class="num">${Math.round(v.arrival)}m</td><td class="num">${v.depth.toFixed(1)}</td><td>${U.risk(v.priority)}</td></tr>`).join('');
      view.querySelector('#dgp').innerHTML = `<tr><th>Panchayat</th><th class="num">Vill.</th><th class="num">Pop.</th><th>Risk</th></tr>` +
        ana.panchayats.map((g) => `<tr><td>${g.name}</td><td class="num">${g.affectedVillages}</td><td class="num">${F.n(g.population)}</td><td>${U.risk(g.risk)}</td></tr>`).join('');
    };
    const tl = U.timeline(view.querySelector('#dtl'), s.cfg.duration, (t) => { s.t = t; const c = FS.app.cur(); mv.update({ res: c.res, ana: c.ana, t }); });
    tl.set(s.t, false);
    view.querySelector('#modelSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { s.activeModel = b.dataset.m; draw(); FS.app.renderStatus(); } };
    view.querySelector('#rerun').onclick = () => FS.app.runSimulation();
    draw();
    setTimeout(() => !mv.dead && mv.map.invalidateSize(), 50);
    return () => { tl.destroy(); mv.destroy(); };
  };

  // ---------- SCENARIO BUILDER ----------
  V.builder = function (view) {
    const s = st(), c = s.cfg;
    const slider = (k, label, min, max, step, unit) => `<div class="field"><label>${label} <b id="v_${k}">${c[k]} ${unit}</b></label><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${c[k]}"/></div>`;
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_builder')}</h1><p>Configure a dam-break, sudden-release or lake-burst scenario for the packaged demonstration reach.</p></div>${U.demo('DEMO SCENARIO LIBRARY')}</div>
    <div class="card mb"><h3>Indian river / dam demonstration library</h3><div class="lib">${D.scenarioLibrary.map((l) => `<div class="lib-item ${l.status === 'READY' ? 'on' : 'off'}" title="${l.note}"><div class="row between"><b>${l.river}</b>${l.status === 'READY' ? '<span class="tag tag-demo">DEMO READY</span>' : '<span class="tag tag-nc">NOT PACKAGED</span>'}</div><div class="muted" style="font-size:11.5px">${l.region}</div><div class="dim" style="font-size:11px;margin-top:3px">${l.note}</div></div>`).join('')}</div>
    <div class="note info mt">Only scenarios with packaged demonstration data are runnable. Additional rivers need DEM, cross-section and GIS layers supplied through the modelling backend.</div></div>
    <div class="grid g2">
      <div class="card"><h3>Scenario configuration</h3>
        <div class="grid g2"><div class="field"><label>River</label><select id="river">${D.scenarioLibrary.map((l) => `<option ${l.status !== 'READY' ? 'disabled' : ''}>${l.river}${l.status !== 'READY' ? ' (not packaged)' : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Dam</label><select><option>${D.dam.name}</option></select></div></div>
        <div class="field"><label>Scenario type</label><div class="seg" id="type">${['Dam Break', 'Sudden Water Release', 'River Blockage / Lake Burst'].map((t) => `<button data-v="${t}" class="${c.type === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        <div class="field"><label>Scenario presets</label><div class="preset-grid" id="presets">
          ${Object.entries(D.presets).map(([k, p]) => `<button class="preset ${c.preset === k ? 'on' : ''}" data-p="${k}"><b>${p.label}</b><span>${p.breachWidth} m · ${p.waterLevel} m head</span></button>`).join('')}
          <button class="preset ${c.preset === 'custom' ? 'on' : ''}" data-p="custom"><b>Custom Scenario</b><span>Edit parameters</span></button></div></div>
        ${slider('waterLevel', 'Initial water level (head above breach invert)', 5, 40, 1, 'm')}
        ${slider('breachWidth', 'Dam break width', 20, 600, 10, 'm')}
        ${slider('breachTime', 'Break formation time', 5, 180, 5, 'min')}
        ${slider('storage', 'Reservoir storage released', 50, 1500, 25, 'MCM')}
        <div class="grid g2"><div class="field"><label>Peak discharge (m³/s) <span class="dim">0 = auto estimate</span></label><input type="number" id="qp" min="0" step="500" value="${c.peakDischarge || 0}"/></div>
        <div class="field"><label>Simulation duration</label><select id="dur">${[[180, '3 hours'], [360, '6 hours'], [720, '12 hours']].map(([v, l]) => `<option value="${v}" ${c.duration === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      </div>
      <div class="card"><h3>Data &amp; model selection</h3>
        <div class="field"><label>Terrain dataset</label><select id="terrain">${['SRTM', 'ASTER', 'DEM Demo Dataset'].map((v) => `<option ${c.terrain === v ? 'selected' : ''}>${v}</option>`).join('')}</select><div id="terrainNote"></div></div>
        <div class="field"><label>Satellite dataset</label><select id="sat">${['Sentinel', 'Landsat', 'Demo Dataset'].map((v) => `<option ${c.satellite === v ? 'selected' : ''}>${v}</option>`).join('')}</select><div id="satNote"></div></div>
        <div class="field"><label>Model</label><div class="seg" id="model">${[['sph', 'Smooth Particle Hydrodynamics (SPH)'], ['delft3d', 'Delft3D'], ['both', 'Compare Both']].map(([k, l]) => `<button data-v="${k}" class="${c.model === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="card" style="background:#0a1322;box-shadow:none"><h3>Derived inputs ${U.demo('ESTIMATE')}</h3><div class="grid g2" id="derived"></div>
          <div class="dim" style="font-size:11px;margin-top:8px">Peak discharge estimated with a broad-crested weir relation Q ≈ 1.7·B·H<sup>1.5</sup>, reduced for slower breach formation. Sudden water release uses 45% of the breach estimate unless a value is entered.</div></div>
        <div class="note mt">Simulation results are intended for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
        <button class="btn btn-primary btn-lg mt" style="width:100%" id="runBtn">${T('run')}</button>
      </div>
    </div>`;
    const derived = () => {
      const q = FS.app.effectiveCfg();
      const Q = q.peakDischarge > 0 ? q.peakDischarge : E.peakDischarge(q);
      view.querySelector('#derived').innerHTML = U.kpi('Peak discharge', F.n(Q), 'm³/s', 'cyan') + U.kpi('Release volume', F.n(c.storage), 'MCM') + U.kpi('Recession (≈V/Qp)', F.n((c.storage * 1e6) / Q / 60), 'min') + U.kpi('Duration', c.duration / 60, 'h');
      const nc = (v, real) => (v === real ? '<span class="tag tag-demo mt">DEMO DATA IN USE</span>' : `<div class="note" style="margin-top:6px">${v} is <b>NOT CONNECTED</b> in this prototype — the run will fall back to the ${real}.</div>`);
      view.querySelector('#terrainNote').innerHTML = nc(c.terrain, 'DEM Demo Dataset');
      view.querySelector('#satNote').innerHTML = nc(c.satellite, 'Demo Dataset');
    };
    view.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => {
      c[r.dataset.k] = +r.value; c.preset = 'custom';
      view.querySelector('#v_' + r.dataset.k).textContent = `${r.value} ${r.dataset.k === 'breachTime' ? 'min' : r.dataset.k === 'storage' ? 'MCM' : 'm'}`;
      view.querySelectorAll('#presets .preset').forEach((b) => b.classList.toggle('on', b.dataset.p === 'custom'));
      derived();
    }));
    view.querySelector('#presets').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; FS.app.applyPreset(b.dataset.p); V.builder(view); };
    const segs = (id, key) => (view.querySelector(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; c[key] = b.dataset.v; view.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('on', x === b)); derived(); });
    segs('#type', 'type'); segs('#model', 'model');
    view.querySelector('#qp').oninput = (e) => { c.peakDischarge = +e.target.value || 0; derived(); };
    view.querySelector('#dur').onchange = (e) => { c.duration = +e.target.value; derived(); };
    view.querySelector('#terrain').onchange = (e) => { c.terrain = e.target.value; derived(); };
    view.querySelector('#sat').onchange = (e) => { c.satellite = e.target.value; derived(); };
    view.querySelector('#runBtn').onclick = () => FS.app.modal('Before running the simulation', `
      <p>You are about to run <b>${FS.app.scenarioName()}</b>.</p>
      <div class="note">Simulation results are intended for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
      <p class="muted" style="font-size:12px">In this prototype the SPH and Delft3D backends are <b>not connected</b>. The run uses a browser-side parametric surrogate with model-specific calibration offsets and a synthetic demo DEM. All outputs are labelled SIMULATED DEMO RESULTS.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" onclick="FS.app.closeModal()">Cancel</button><button class="btn btn-primary" id="goRun">Acknowledge &amp; run</button></div>`,
      (b) => (b.querySelector('#goRun').onclick = () => { FS.app.closeModal(); FS.app.runSimulation(); }));
    derived();
  };

  // ---------- FLOOD SIMULATION ----------
  V.simulation = function (view) {
    const s = st();
    view.classList.add('fill');
    view.innerHTML = `<div class="dash" style="grid-template-columns:380px minmax(0,1fr)">
      <div class="dash-side">
        <div class="card"><h3>Simulation workflow ${U.demo('SURROGATE')}</h3><div class="progress mb"><i id="prog" style="width:0"></i></div><ul class="steps" id="steps"></ul>
          <div class="dim" style="font-size:11px;margin-top:8px">Step timings are real (browser). SPH / Delft3D numerical solvers are <b>not executed</b>; model steps use the parametric surrogate.</div></div>
        <div class="card" id="resCard"><h3>Simulation results ${U.demo('SIMULATED DEMO RESULTS')}</h3><div class="seg mb" id="modelSeg"><button data-m="sph">SPH</button><button data-m="delft3d">Delft3D</button></div><div class="kpis" id="sk" style="grid-template-columns:1fr 1fr"></div></div>
      </div>
      <div class="dash-map"><div class="map-wrap" id="smap"></div><div id="stl"></div></div></div>`;
    const mv = U.mountMap(view.querySelector('#smap'), { mode: 'depth' });
    const tl = U.timeline(view.querySelector('#stl'), s.cfg.duration, (t) => { s.t = t; const c = FS.app.cur(); if (c.res) mv.update({ res: c.res, ana: c.ana, t }); }, { speed: 70 });
    const drawSteps = () => {
      const n = FS.app.STEPS.length, k = s.running ? s.step : n;
      view.querySelector('#prog').style.width = `${Math.min(100, (k / (n - 1)) * 100)}%`;
      view.querySelector('#steps').innerHTML = FS.app.STEPS.map(([l, d], i) => {
        const cls = i < k ? 'ok' : i === k && s.running ? 'run' : '';
        const tm = i < k && s.stepTimes && s.stepTimes[i] != null ? `${s.stepTimes[i].toFixed(0)} ms` : '';
        return `<li class="${cls}"><span class="si">${i < k ? '✓' : i + 1}</span><div><div>Step ${i + 1}: ${l}</div>${d ? `<div class="dim" style="font-size:11px">${d}</div>` : ''}</div><span class="sd">${tm}</span></li>`;
      }).join('');
    };
    const drawRes = () => {
      const c = FS.app.cur();
      view.querySelector('#resCard').style.opacity = s.running ? 0.35 : 1;
      if (!c.ana) return;
      view.querySelector('#sk').innerHTML = U.kpis(c.ana.kpi, true);
      view.querySelectorAll('#modelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === s.activeModel));
      mv.update({ res: c.res, ana: c.ana, t: s.t });
    };
    view.querySelector('#modelSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { s.activeModel = b.dataset.m; drawRes(); FS.app.renderStatus(); } };
    V._simStep = (done) => {
      drawSteps();
      if (done) { drawRes(); tl.set(0); tl.start(); FS.app.toast('Simulation complete — SIMULATED DEMO RESULTS'); }
    };
    drawSteps();
    if (!s.running) drawRes(); else view.querySelector('#resCard').style.opacity = 0.35;
    tl.set(s.running ? 0 : s.t, false);
    if (s.running) mv.update({ res: null, ana: null, t: 0 });
    setTimeout(() => !mv.dead && mv.map.invalidateSize(), 50);
    return () => { V._simStep = null; tl.destroy(); mv.destroy(); };
  };

  // ---------- MODEL COMPARISON ----------
  V.models = function (view) {
    const s = st();
    const A = { res: s.res.sph, ana: s.ana.sph }, B = { res: s.res.delft3d, ana: s.ana.delft3d };
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_models')}: SPH vs Delft3D</h1><p>Side-by-side maximum flood depth with synchronised zoom/pan, difference map and metric comparison.</p></div>${U.demo('SIMULATED DEMO RESULTS')}</div>
    <div class="note mb">Both outputs come from the prototype's parametric surrogate with model-specific calibration offsets (SPH: less attenuation, faster front, particle-scale scatter; Delft3D: smoother, more attenuation). They demonstrate the comparison workflow only and are <b>not</b> results of SPH or Delft3D numerical runs.</div>
    <div class="split mb"><div class="map-wrap" id="mA"><div class="map-title">Smooth Particle Hydrodynamics</div></div><div class="map-wrap" id="mB"><div class="map-title">Delft3D</div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
      <div class="card"><h3>Comparison metrics ${U.demo()}</h3><table class="tbl" id="mt"></table></div>
      <div class="card"><h3>Relative difference (SPH vs Delft3D, %)</h3><div style="height:250px"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>SPH vs Delft3D Difference</h3><div class="map-wrap" id="mD" style="height:340px"></div></div>
      <div class="card"><h3>Longitudinal profile — peak stage &amp; front arrival</h3><div style="height:340px"><canvas id="c2"></canvas></div></div>
    </div>`;
    const opts = { tools: false, modes: false, legend: true, layers: { river: true, dam: true, villages: true, labels: false, safe: false, roads: false, bridges: false, infra: false, arrows: false, extent: true } };
    const ma = U.mountMap(view.querySelector('#mA'), opts), mb = U.mountMap(view.querySelector('#mB'), opts);
    ma.update({ res: A.res, ana: A.ana, t: s.cfg.duration }); mb.update({ res: B.res, ana: B.ana, t: s.cfg.duration });
    let lock = false;
    const sync = (src, dst) => src.map.on('move', () => { if (lock) return; lock = true; dst.map.setView(src.map.getCenter(), src.map.getZoom(), { animate: false }); lock = false; });
    sync(ma, mb); sync(mb, ma);
    const md = U.mountMap(view.querySelector('#mD'), { tools: false, modes: false, legend: false, layers: { river: true, dam: true } });
    L.imageOverlay(FS.mapkit.renderDiff(A.res, B.res), FS.mapkit.gridBounds(), { pane: 'floodPane', className: 'flood-img' }).addTo(md.map);
    const lg = document.createElement('div'); lg.className = 'map-ctl legend';
    const P = FS.mapkit.PAL.diff;
    lg.innerHTML = `<div class="legend-t">${P.title}</div>` + P.labels.map((l, i) => `<div class="legend-row"><i style="background:${P.colors[i]}"></i>${l}</div>`).join('') + '<div class="legend-demo">SIMULATED DEMO DATA</div>';
    view.querySelector('#mD').appendChild(lg);
    const Ka = A.ana.kpi, Kb = B.ana.kpi;
    const rows = [['Inundated area', Ka.area, Kb.area, 'km²', 1], ['Maximum depth', Ka.maxDepth, Kb.maxDepth, 'm', 2], ['Peak velocity', Ka.maxVel, Kb.maxVel, 'm/s', 2], ['First arrival (settlement)', Ka.firstArrival, Kb.firstArrival, 'min', 0], ['Affected villages', Ka.villages, Kb.villages, '', 0], ['Affected population (est.)', Ka.population, Kb.population, '', 0], ['Affected infrastructure', Ka.infra, Kb.infra, '', 0], ['Roads flooded', Ka.roads, Kb.roads, 'seg', 0], ['Bridges at risk', Ka.bridges, Kb.bridges, '', 0]];
    view.querySelector('#mt').innerHTML = `<tr><th>Metric</th><th class="num">SPH</th><th class="num">Delft3D</th><th class="num">Δ</th></tr>` + rows.map(([l, a, b, u, d]) => `<tr><td>${l}</td><td class="num">${F.n(a, d)} ${u}</td><td class="num">${F.n(b, d)} ${u}</td><td class="num" style="color:${a - b > 0 ? '#fdba74' : '#93c5fd'}">${a - b > 0 ? '+' : ''}${F.n(a - b, d)}</td></tr>`).join('');
    const pct = rows.filter((r) => r[2]).map((r) => [r[0], ((r[1] - r[2]) / r[2]) * 100]);
    const c1 = new Chart(view.querySelector('#c1'), { type: 'bar', data: { labels: pct.map((p) => p[0]), datasets: [{ label: 'SPH relative to Delft3D (%)', data: pct.map((p) => +p[1].toFixed(1)), backgroundColor: pct.map((p) => (p[1] >= 0 ? '#f97316' : '#3b82f6')) }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: '% difference (SPH − Delft3D) / Delft3D' } } } } });
    const stn = E.R.stations.filter((_, i) => i % 4 === 0);
    const idx = stn.map((p) => Math.round(p.s / E.STEP));
    const c2 = new Chart(view.querySelector('#c2'), { type: 'line', data: { labels: stn.map((p) => p.s.toFixed(0)), datasets: [
      { label: 'SPH peak stage (m)', data: idx.map((k) => +A.res.st.Hs[k].toFixed(2)), borderColor: '#f97316', pointRadius: 0, yAxisID: 'y' },
      { label: 'Delft3D peak stage (m)', data: idx.map((k) => +B.res.st.Hs[k].toFixed(2)), borderColor: '#38bdf8', pointRadius: 0, yAxisID: 'y' },
      { label: 'SPH front arrival (min)', data: idx.map((k) => Math.round(A.res.st.ta[k])), borderColor: '#f97316', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y1' },
      { label: 'Delft3D front arrival (min)', data: idx.map((k) => Math.round(B.res.st.ta[k])), borderColor: '#38bdf8', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y1' }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { title: { display: true, text: 'Chainage downstream of dam (km)' } }, y: { title: { display: true, text: 'Stage (m)' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Arrival (min)' } } } } });
    setTimeout(() => [ma, mb, md].forEach((m) => !m.dead && m.map.invalidateSize()), 60);
    return () => { c1.destroy(); c2.destroy(); ma.destroy(); mb.destroy(); md.destroy(); };
  };

  // ---------- IMPACT ANALYSIS ----------
  V.impact = function (view) {
    const s = st();
    const { ana } = FS.app.cur();
    const K = ana.kpi;
    const f = (s.impactFilter = s.impactFilter || { type: 'all', risk: 'all', gp: 'all' });
    const usedSZ = new Set(ana.villages.filter((v) => v.affected && v.safeZone).map((v) => v.safeZone));
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_impact')}</h1><p>Village, panchayat and infrastructure impact from the active model (${FS.app.cur().res.model.name}).</p></div>${U.demo('SIMULATED DEMO RESULTS')}</div>
    <div class="kpis mb">${[
      U.kpi(T('population'), F.n(K.population), '', 'amber'), U.kpi(T('villages'), K.villages, `/ ${D.villages.length}`, 'amber'), U.kpi(T('panchayats'), K.panchayats, `/ ${D.panchayats.length}`),
      U.kpi(T('roads'), K.roads, `seg · ${F.n(K.roadKm)} km`, 'red'), U.kpi(T('bridges'), K.bridges, '', 'red'), U.kpi(T('agri'), F.n(K.agriArea), 'km²', 'green'),
      U.kpi(T('infra'), K.infra, '', 'red'), U.kpi('Evacuation zones in use', usedSZ.size, `/ ${D.safeZones.length}`, 'green')].join('')}</div>
    <div class="dim mb" style="font-size:11px">Agricultural area assumes 72% of the inundated area is cropland (demo assumption). Population figures are synthetic estimates.</div>
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      <div class="card"><h3>Ranked impact register</h3>
        <div class="row wrap mb" style="gap:8px"><div class="seg" id="ftype">${[['all', 'All'], ['village', 'Villages'], ['panchayat', 'Panchayats'], ['road', 'Roads'], ['bridge', 'Bridges'], ['infra', 'Infrastructure']].map(([k, l]) => `<button data-v="${k}" class="${f.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <select id="frisk" style="width:auto">${['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((r) => `<option value="${r}" ${f.risk === r ? 'selected' : ''}>${r === 'all' ? 'All risk levels' : r}</option>`).join('')}</select>
        <select id="fgp" style="width:auto"><option value="all">All panchayats</option>${D.panchayats.map((p) => `<option value="${p.id}" ${f.gp === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>
        <div class="tbl-wrap" style="max-height:470px"><table class="tbl" id="reg"></table></div></div>
      <div class="card" id="vdet"></div>
    </div>
    <div class="card mt"><h3>Panchayat-level summary ${U.demo()}</h3><table class="tbl" id="gpt"></table></div>`;
    const nearestGp = (sv) => D.villages.reduce((a, v) => (Math.abs(v.s - sv) < Math.abs(a.s - sv) ? v : a)).gp;
    const assets = [];
    ana.villages.forEach((v) => assets.push({ kind: 'village', id: v.id, name: v.name, sub: 'Village', gp: v.gp, dist: v.distRiver, depth: v.depth, arr: v.arrival, risk: v.risk }));
    ana.panchayats.forEach((g) => assets.push({ kind: 'panchayat', id: g.id, name: g.name, sub: 'Gram Panchayat', gp: g.id, dist: Math.min(...g.villages.map((v) => v.distRiver)), depth: Math.max(...g.villages.map((v) => v.depth)), arr: Math.min(...g.villages.map((v) => v.arrival)), risk: g.risk }));
    ana.infra.forEach((x) => assets.push({ kind: 'infra', id: x.id, name: x.name, sub: FS.mapkit.INFRA_NAME[x.type], gp: x.village ? D.villages.find((v) => v.id === x.village).gp : nearestGp(x.s), dist: x.distRiver, depth: x.depth, arr: x.arrival, risk: x.risk }));
    ana.bridges.forEach((b) => assets.push({ kind: 'bridge', id: b.id, name: b.name, sub: b.status, gp: nearestGp(b.s), dist: b.distRiver, depth: b.depth, arr: b.arrival, risk: b.risk === 'LOW' ? 'NONE' : b.risk }));
    E.ROADS.edges.forEach((e) => { const ev = ana.roadEval[e.id]; if (e.crossing || !(ev.maxDepth > 0.05)) return; const mid = e.geom[Math.floor(e.geom.length / 2)]; assets.push({ kind: 'road', id: e.id, name: e.name, sub: `${ev.status} · ${e.len.toFixed(1)} km`, gp: nearestGp(mid.s), dist: Math.abs(mid.d), depth: ev.maxDepth, arr: ev.arrival, risk: ev.blocked ? (ev.maxDepth > 1 ? 'CRITICAL' : 'HIGH') : 'MEDIUM' }); });
    const drawReg = () => {
      const rows = assets.filter((a) => (f.type === 'all' || a.kind === f.type) && (f.risk === 'all' || a.risk === f.risk) && (f.gp === 'all' || a.gp === f.gp) && a.risk !== 'NONE')
        .sort((a, b) => E.RISK_ORDER[b.risk] - E.RISK_ORDER[a.risk] || a.arr - b.arr);
      view.querySelector('#reg').innerHTML = `<tr><th>Asset</th><th>Type</th><th class="num">Dist. river</th><th class="num">Depth</th><th class="num">Arrival</th><th>Risk</th></tr>` +
        (rows.map((a) => `<tr class="${a.kind === 'village' ? 'click' : ''} ${s.selVillage === a.id ? 'sel' : ''}" data-v="${a.kind === 'village' ? a.id : ''}"><td>${F.esc(a.name)}</td><td class="muted">${a.sub}</td><td class="num">${F.km(a.dist)}</td><td class="num">${F.m(a.depth)}</td><td class="num">${isFinite(a.arr) ? Math.round(a.arr) + ' min' : '—'}</td><td>${U.risk(a.risk)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No affected assets match the filter.</td></tr>');
    };
    const drawVillage = () => {
      const v = ana.villages.find((x) => x.id === s.selVillage) || ana.villages.filter((x) => x.affected).sort((a, b) => b.score - a.score)[0] || ana.villages[0];
      s.selVillage = v.id;
      const gp = D.panchayats.find((p) => p.id === v.gp), sz = D.safeZones.find((z) => z.id === v.safeZone);
      view.querySelector('#vdet').innerHTML = `<h3>Village-level flood impact ${U.demo('DEMO')}</h3>
        <div class="row between"><div><div style="font-size:18px;font-weight:700">${v.name}</div><div class="muted">${gp.name} · ${gp.block}</div></div>${U.risk(v.risk)}</div>
        <div class="kpis mt" style="grid-template-columns:1fr 1fr">${U.kpi('Flood depth', v.depth.toFixed(2), 'm', 'red')}${U.kpi('Arrival time', v.affected ? Math.round(v.arrival) : '—', 'min', 'red')}${U.kpi('Flood duration', v.affected ? F.min(v.duration) : '—', '')}${U.kpi('Population (est.)', F.n(v.pop), '', 'amber')}${U.kpi('Distance from river', v.distRiver.toFixed(1), 'km')}${U.kpi('Distance from dam', v.distDam.toFixed(0), 'km')}</div>
        <div class="mt"><div class="muted" style="font-size:12px">Nearby safe location</div><div style="font-weight:600">${sz ? sz.name : 'No road route before flood arrival — vertical evacuation / shelter advised'}</div>
        ${v.evac.recommended ? `<div class="muted" style="font-size:12px">${v.evac.recommended.len.toFixed(1)} km · ~${Math.round(v.evac.recommended.time)} min by vehicle · route risk ${U.risk(v.evac.recommended.risk)}</div>` : ''}</div>
        <div class="mt"><div class="muted" style="font-size:12px">Critical assets in village</div>${v.infra.length ? v.infra.map((x) => `<div class="row between" style="font-size:12.5px;padding:3px 0"><span>${x.name}</span>${U.risk(x.risk)}</div>`).join('') : '<div class="dim">None recorded</div>'}</div>
        <div class="row mt" style="gap:6px"><button class="btn btn-sm" data-act="evac" data-id="${v.id}">Plan evacuation</button><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>
        <div class="dim mt" style="font-size:11px">HADR priority ${U.risk(v.priority)} (${v.score.toFixed(0)}/100) · hazard rating ${v.hazard.toFixed(2)}</div>`;
    };
    view.querySelector('#gpt').innerHTML = `<tr><th>Panchayat</th><th>Block</th><th class="num">Affected villages</th><th class="num">Population</th><th class="num">Schools</th><th class="num">PHCs</th><th class="num">Roads</th><th class="num">Bridges</th><th class="num">Flood area</th><th>Risk</th><th>HADR priority</th></tr>` +
      ana.panchayats.map((g) => `<tr class="click" data-gp="${g.id}"><td>${g.name}</td><td class="muted">${g.block}</td><td class="num">${g.affectedVillages} / ${g.villages.length}</td><td class="num">${F.n(g.population)}</td><td class="num">${g.schools}</td><td class="num">${g.health}</td><td class="num">${g.roads}</td><td class="num">${g.bridges}</td><td class="num">${g.area.toFixed(1)} km²</td><td>${U.risk(g.risk)}</td><td>${U.risk(g.priority)}</td></tr>`).join('');
    view.querySelector('#gpt').onclick = (e) => { const r = e.target.closest('[data-gp]'); if (r) { f.gp = r.dataset.gp; V.impact(view); } };
    view.querySelector('#ftype').onclick = (e) => { const b = e.target.closest('button'); if (b) { f.type = b.dataset.v; view.querySelectorAll('#ftype button').forEach((x) => x.classList.toggle('on', x === b)); drawReg(); } };
    view.querySelector('#frisk').onchange = (e) => { f.risk = e.target.value; drawReg(); };
    view.querySelector('#fgp').onchange = (e) => { f.gp = e.target.value; drawReg(); };
    view.querySelector('#reg').onclick = (e) => { const r = e.target.closest('tr[data-v]'); if (r && r.dataset.v) { s.selVillage = r.dataset.v; drawReg(); drawVillage(); } };
    drawReg(); drawVillage();
  };

  // ---------- NEAR-REAL-TIME ANALYSIS ----------
  V.nrt = function (view) {
    const s = st();
    const { res } = FS.app.cur();
    const obs = E.syntheticObservedMask(res);
    const cmp = E.compareMasks(res, obs);
    let perm = 0, newW = 0;
    for (let i = 0; i < E.G.n; i++) { if (E.G.channel[i]) perm++; else if (obs[i]) newW++; }
    view.innerHTML = `<div class="page-head"><div><h1>NEAR-REAL-TIME FLOOD ANALYSIS</h1><p>Before/after satellite comparison, detected water extent, change detection and simulation-vs-observation view.</p></div><span class="tag tag-demo">DEMO / SIMULATED REMOTE-SENSING ANALYSIS</span></div>
    <div class="note mb">No Google Earth Engine or satellite backend is connected. The "after" view uses the same basemap imagery with a <b>synthetic observed water mask</b> (perturbed from the simulation). It demonstrates the workflow only — it is not real satellite validation.</div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px">
      <div><div class="row mb"><div class="seg" id="nmode"><button data-v="ba" class="on">Before / After</button><button data-v="sim">Simulation vs Satellite Observation</button><button data-v="chg">Change detection</button></div><span class="muted" style="font-size:12px">Drag the handle to compare</span></div>
        <div class="map-wrap" id="nmap" style="height:560px"></div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div class="card"><h3>Detected water (demo)</h3><div class="kpis" style="grid-template-columns:1fr 1fr">${U.kpi('Observed water (total)', F.n(cmp.obsArea + perm * E.G.cellArea), 'km²', 'cyan')}${U.kpi('New water (change)', F.n(newW * E.G.cellArea), 'km²', 'red')}${U.kpi('Permanent water', F.n(perm * E.G.cellArea), 'km²')}${U.kpi('Est. affected area', F.n(newW * E.G.cellArea), 'km²', 'amber')}</div></div>
        <div class="card"><h3>Validation metrics</h3><div id="val"><p class="muted" style="font-size:12px;margin-top:0">Accuracy metrics are shown only when a reference flood mask is loaded. No real reference mask is available in this prototype.</p><button class="btn btn-sm" id="loadRef">Load demo reference mask</button></div></div>
        <div class="card"><h3>Data sources</h3><table class="tbl">${[['Sentinel-1 SAR (VV/VH)', 'NOT CONNECTED'], ['Sentinel-2 MSI (NDWI)', 'NOT CONNECTED'], ['Landsat 8/9 OLI (MNDWI)', 'NOT CONNECTED'], ['DEM (SRTM 30 m)', 'NOT CONNECTED'], ['Rainfall (IMD / GPM IMERG)', 'NOT CONNECTED'], ['Demo imagery + synthetic mask', 'DEMO']].map(([a, b]) => `<tr><td>${a}</td><td>${b === 'DEMO' ? '<span class="tag tag-demo">DEMO</span>' : '<span class="tag tag-nc">NOT CONNECTED</span>'}</td></tr>`).join('')}</table></div>
      </div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><h3>Intended Google Earth Engine pipeline (backend)</h3><ul class="steps">${['Select Sentinel-1 GRD scenes (pre-event & post-event, same orbit)', 'Speckle filter (focal median) → VV backscatter in dB', 'Water classification: VV < −16 dB (or Otsu threshold), mask slopes > 5° using DEM', 'Change detection: post-water AND NOT pre-water → flood extent', 'Remove permanent water (JRC Global Surface Water occurrence > 80%)', 'Vectorise flood mask → compare with simulated extent (IoU, area difference)'].map((x, i) => `<li class="ok"><span class="si">${i + 1}</span>${x}</li>`).join('')}</ul><div class="dim" style="font-size:11px;margin-top:6px">Steps describe the planned server-side workflow. They are NOT executed in this prototype.</div></div>
      <div class="card"><h3>Backend script (reference, not executed)</h3><textarea rows="12" readonly>// Google Earth Engine (JavaScript API) — to run server-side
var aoi = ee.Geometry.Rectangle([86.35, 25.75, 87.15, 26.60]);
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi).filter(ee.Filter.eq('instrumentMode','IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV'))
  .select('VV');
var before = s1.filterDate(PRE_START, PRE_END).mosaic().focal_median(50,'circle','meters');
var after  = s1.filterDate(POST_START, POST_END).mosaic().focal_median(50,'circle','meters');
var waterBefore = before.lt(-16), waterAfter = after.lt(-16);
var slope = ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003'));
var flood = waterAfter.and(waterBefore.not()).updateMask(slope.lt(5));
Export.table.toDrive(flood.selfMask().reduceToVectors({geometry: aoi, scale: 30}));</textarea></div>
    </div>`;
    const wrap = view.querySelector('#nmap');
    const mv = U.mountMap(wrap, { tools: true, modes: false, legend: false, basemap: s.online ? 'satellite' : 'offline', layers: { river: true, dam: true, villages: true, labels: true } });
    mv.update({ res: null, ana: FS.app.cur().ana, t: 0 });
    const map = mv.map;
    const pane = map.createPane('afterPane'); pane.style.zIndex = 420;
    const grp = L.layerGroup().addTo(map);
    const cv = document.createElement('canvas'); cv.width = E.G.cols; cv.height = E.G.rows;
    const cx = cv.getContext('2d');
    const paint = (fn) => { const img = cx.createImageData(E.G.cols, E.G.rows); for (let i = 0; i < E.G.n; i++) { const c = fn(i); if (c) { img.data.set(c, i * 4); } } cx.putImageData(img, 0, 0); return cv.toDataURL(); };
    let ratio = 0.5, mode = 'ba';
    const handle = document.createElement('div'); handle.className = 'curtain-handle'; wrap.appendChild(handle);
    const lblL = document.createElement('div'); lblL.className = 'curtain-lbl'; lblL.style.left = '60px'; wrap.appendChild(lblL);
    const lblR = document.createElement('div'); lblR.className = 'curtain-lbl'; lblR.style.right = '10px'; lblR.style.top = '52px'; wrap.appendChild(lblR);
    const clip = () => {
      const size = map.getSize(), nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
      const x = map.containerPointToLayerPoint([size.x * ratio, 0]).x;
      pane.style.clip = mode === 'ba' ? `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)` : 'auto';
      handle.style.left = `calc(${ratio * 100}% - 1px)`;
      handle.style.display = mode === 'ba' ? '' : 'none';
    };
    const draw = () => {
      grp.clearLayers();
      if (mode === 'ba') {
        if (s.online) L.tileLayer(FS.mapkit.BASEMAPS.satellite.url, { pane: 'afterPane', className: 'after-tiles' }).addTo(grp);
        L.imageOverlay(paint((i) => (obs[i] ? [34, 211, 238, 190] : null)), FS.mapkit.gridBounds(), { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = 'BEFORE FLOOD · basemap imagery'; lblR.textContent = 'AFTER FLOOD · synthetic water mask (DEMO)';
      } else if (mode === 'sim') {
        L.imageOverlay(paint((i) => { const a = res.dmax[i] > 0.05, b = obs[i] && !E.G.channel[i]; return a && b ? [34, 197, 94, 185] : a ? [249, 115, 22, 185] : b ? [232, 121, 249, 185] : null; }), FS.mapkit.gridBounds(), { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = '■ green: both  ■ orange: simulated only  ■ pink: observed only'; lblR.textContent = 'SIMULATION vs OBSERVATION (DEMO)';
      } else {
        L.imageOverlay(paint((i) => (E.G.channel[i] ? [59, 130, 246, 200] : obs[i] ? [239, 68, 68, 180] : null)), FS.mapkit.gridBounds(), { pane: 'afterPane', className: 'flood-img' }).addTo(grp);
        lblL.textContent = '■ blue: permanent water  ■ red: new flood water'; lblR.textContent = 'CHANGE DETECTION (DEMO)';
      }
      clip();
    };
    const st2 = document.createElement('style'); st2.textContent = '.after-tiles{filter:brightness(.72) saturate(.55) sepia(.25)}'; view.appendChild(st2);
    map.on('move zoom resize', clip);
    let drag = false;
    handle.addEventListener('pointerdown', (e) => { drag = true; handle.setPointerCapture(e.pointerId); L.DomEvent.stop(e); map.dragging.disable(); });
    handle.addEventListener('pointermove', (e) => { if (!drag) return; const r = wrap.getBoundingClientRect(); ratio = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); clip(); });
    handle.addEventListener('pointerup', () => { drag = false; map.dragging.enable(); });
    view.querySelector('#nmode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v; view.querySelectorAll('#nmode button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    view.querySelector('#loadRef').onclick = () => {
      view.querySelector('#val').innerHTML = `<div class="kpis" style="grid-template-columns:1fr 1fr">${U.kpi('IoU', cmp.iou.toFixed(2), '', 'cyan')}${U.kpi('Overlap (of observed)', (cmp.overlap * 100).toFixed(0), '%')}${U.kpi('Simulated area', F.n(cmp.simArea), 'km²')}${U.kpi('Area difference', (cmp.diff > 0 ? '+' : '') + F.n(cmp.diff), 'km²', 'amber')}</div>
      <div class="note mt">Computed against a <b>synthetic demo reference mask</b> — demonstrates the validation pipeline only; not an accuracy claim.</div>`;
    };
    draw();
    setTimeout(() => { if (!mv.dead) { map.invalidateSize(); clip(); } }, 60);
    return () => mv.destroy();
  };
})();
