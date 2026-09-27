/* FloodSim HADR — page views (part 1): shared UI, Dashboard, Scenario Builder, Simulation, Model Comparison. */
(function () {
  const A = FS.analysis, D = FS.data, F = FS.fmt;
  const V = (FS.views = {});
  const st = () => FS.state;
  const T = (k) => FS.t(k);

  // ---------- shared UI helpers ----------
  const U = (FS.ui = {});
  U.risk = (r) => `<span class="risk risk-${String(r).replace(' ', '.')}">${r}</span>`;
  U.demo = (txt) => `<span class="tag ${FS.app.isLive() ? 'tag-sim' : 'tag-demo'}">${txt || FS.app.dataTag()}</span>`;
  U.kpi = (label, value, unit, accent) => `<div class="kpi ${accent ? 'accent-' + accent : ''}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
  U.kpis = (K, full) => {
    const s = st();
    const a = [
      U.kpi(T('maxDepth'), K.maxDepth.toFixed(2), 'm', 'red'), U.kpi(T('maxVel'), K.maxVel.toFixed(2), 'm/s', 'amber'),
      U.kpi(T('firstArrival'), isFinite(K.firstArrival) ? Math.round(K.firstArrival) : '—', 'min', 'red'), U.kpi(T('area'), F.n(K.area, 1), 'km²', 'cyan'),
      U.kpi(T('villages'), K.villages, `/ ${s.scn.features.villages.length}`, 'amber'), U.kpi(T('population'), F.n(K.population), '', 'amber'),
      U.kpi(T('roads'), K.roads, `seg · ${F.n(K.roadKm, 0)} km`), U.kpi(T('bridges'), K.bridges, `/ ${s.scn.features.bridges.length}`),
      U.kpi(T('infra'), K.infra, '', 'red'), U.kpi(T('highPri'), K.highPriority, '', 'red')
    ];
    if (full) a.push(U.kpi(T('peakQ'), F.n(K.peakQ), 'm³/s', 'cyan'), U.kpi(T('panchayats'), K.panchayats, `/ ${s.scn.features.groups.length}`), U.kpi('Est. building loss', F.inr(K.damage.buildingLossINR), '', 'amber'), U.kpi('Est. crop loss', F.inr(K.damage.cropLossINR), '', 'amber'));
    return a.join('');
  };
  U.mountMap = (el, opts) => {
    const s = st();
    const o = Object.assign({ basemap: s.online ? 'dark' : 'offline' }, opts || {});
    if (!s.online) o.layers = Object.assign({}, o.layers || { river: true, dam: true, villages: true, labels: true, roads: true, bridges: true, infra: true, safe: true, arrows: true, extent: true }, { dem: true });
    return new FS.mapkit.MapView(el, o);
  };
  U.mapData = (t) => { const c = FS.app.cur(); return { scn: c.scn, M: c.M, ana: c.ana, t }; };
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
    const start = () => { if (+inp.value >= top) set(0); play.textContent = '❚❚'; timer = setInterval(() => { const v = +inp.value + 1; if (v > top) return stop(); set(toT(v)); }, (opts && opts.speed) || 90); };
    play.onclick = () => (timer ? stop() : start());
    return { set, start, stop, destroy: stop };
  };
  U.groupName = (id) => (st().scn.features.groups.find((g) => g.id === id) || { name: '—' }).name;

  // ---------- DASHBOARD ----------
  V.dashboard = function (view) {
    const s = st();
    view.classList.add('fill');
    const live = FS.app.isLive(), d = s.scn.dam;
    view.innerHTML = `<div class="dash">
      <div class="dash-map"><div class="map-wrap" id="dmap"></div><div id="dtl"></div></div>
      <div class="dash-side">
        <div class="card">
          <h3>Active scenario ${U.demo(live ? 'LIVE · NUMERICAL' : 'DEMO SCENARIO')}</h3>
          <div style="font-weight:700;font-size:15px">${F.esc(FS.app.scenarioName())}</div>
          <div class="muted" style="font-size:12px;margin:2px 0 10px">${F.esc([d.river && 'River: ' + d.river, d.state, 'Dam: ' + d.name].filter(Boolean).join(' · '))}<br>${F.esc(s.runSource)}</div>
          <div class="row between wrap"><div class="seg" id="modelSeg"><button data-m="sph">SPH</button><button data-m="delft3d">${live ? 'Delft3D-class SWE' : 'Delft3D'}</button></div>
          <div class="row" style="gap:6px"><button class="btn btn-sm" data-go="builder">Configure</button>${live ? '' : '<button class="btn btn-sm btn-primary" id="rerun">Re-run</button>'}</div></div>
        </div>
        <div class="kpis" id="dk" style="grid-template-columns:1fr 1fr"></div>
        <div class="card"><h3>Top HADR priorities <a href="#" data-go="priority" style="font-size:11px">All →</a></h3><table class="tbl" id="dpri"></table></div>
        <div class="card"><h3>${live ? 'Settlement groups' : 'Panchayat impact'} <a href="#" data-go="impact" style="font-size:11px">Details →</a></h3><table class="tbl" id="dgp"></table></div>
        <div class="note">Results are SIMULATED outputs for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
      </div></div>`;
    const mv = U.mountMap(view.querySelector('#dmap'), { mode: 'depth' });
    const draw = () => {
      const { ana } = FS.app.cur();
      mv.update(U.mapData(s.t));
      view.querySelector('#dk').innerHTML = U.kpis(ana.kpi);
      view.querySelectorAll('#modelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === s.activeModel));
      const top = ana.villages.filter((v) => v.affected).sort((a, b) => b.score - a.score).slice(0, 6);
      view.querySelector('#dpri').innerHTML = `<tr><th>Location</th><th class="num">Arrival</th><th class="num">Depth</th><th>Priority</th></tr>` +
        (top.map((v) => `<tr class="click" data-act="village" data-id="${v.id}"><td>${F.esc(v.name)}</td><td class="num">${Math.round(v.arrival)}m</td><td class="num">${v.depth.toFixed(1)}</td><td>${U.risk(v.priority)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No settlements affected</td></tr>');
      view.querySelector('#dgp').innerHTML = `<tr><th>${live ? 'Group' : 'Panchayat'}</th><th class="num">Vill.</th><th class="num">Pop.</th><th>Risk</th></tr>` +
        ana.panchayats.filter((g) => !live || g.affectedVillages).slice(0, 12).map((g) => `<tr><td>${F.esc(g.name)}</td><td class="num">${g.affectedVillages}</td><td class="num">${F.n(g.population)}</td><td>${U.risk(g.risk)}</td></tr>`).join('');
    };
    const tl = U.timeline(view.querySelector('#dtl'), s.scn.config.duration, (t) => { s.t = t; mv.update(U.mapData(t)); });
    tl.set(s.t, false);
    view.querySelector('#modelSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { s.activeModel = b.dataset.m; draw(); FS.app.renderStatus(); } };
    const rr = view.querySelector('#rerun'); if (rr) rr.onclick = () => FS.app.runDemo();
    draw();
    return () => { tl.destroy(); mv.destroy(); };
  };

  // ---------- SCENARIO BUILDER ----------
  const LIVE_PRESETS = { small: { label: 'Small Breach', sf: 0.5, wm: 0.6, tm: 1.5 }, medium: { label: 'Medium Breach', sf: 1, wm: 1, tm: 1 }, severe: { label: 'Severe Breach', sf: 1, wm: 1.5, tm: 0.6 } };
  V.builder = function (view) {
    const s = st();
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_builder')}</h1><p>Configure a dam-break, sudden-release or lake-burst scenario.</p></div>
      <div class="seg" id="bmode"><button data-v="live" class="${s.builderMode === 'live' ? 'on' : ''}">Live — any Indian dam (backend)</button><button data-v="demo" class="${s.builderMode === 'demo' ? 'on' : ''}">Offline demo — Kosi</button></div></div><div id="bbody"></div>`;
    view.querySelector('#bmode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; s.builderMode = b.dataset.v; V.builder(view); };
    const body = view.querySelector('#bbody');
    if (s.builderMode === 'live') return liveBuilder(body);
    demoBuilder(body);
  };

  function liveBuilder(el) {
    const s = st(), c = s.live.cfg;
    if (!s.backend.online) {
      el.innerHTML = `<div class="card"><h3>Backend not connected</h3><p>Live scenarios run the SPH and 2D shallow-water solvers on real open data (Wikidata dam catalogue, SRTM-derived DEM, OpenStreetMap) and need the Node backend.</p>
        <div class="alert-box" style="min-height:0">cd Dam_break\nnpm run dev\n\n→ open http://localhost:8080</div><p class="muted">No npm install is needed — the backend uses only built-in Node.js modules.</p><button class="btn" id="retry">Retry connection</button></div>`;
      el.querySelector('#retry').onclick = async () => { const h = await FS.api.health(); s.backend = { online: !!h, health: h }; FS.app.renderStatus(); FS.app.go('builder'); };
      return;
    }
    el.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
      <div class="card"><h3>1 · Select an Indian dam <span class="tag tag-real">WIKIDATA · CC0</span></h3>
        <div class="row mb" style="gap:8px"><input type="text" id="dq" placeholder="Search dam, river or state (e.g. Tehri, Hirakud, Bhagirathi, Odisha)"/><span class="muted" id="dcount" style="white-space:nowrap;font-size:12px"></span></div>
        <div class="map-wrap mb" id="dmap2" style="height:300px"></div>
        <div class="tbl-wrap" style="max-height:230px"><table class="tbl" id="dlist"></table></div>
        <div class="dim" style="font-size:11px;margin-top:6px">Click a dam in the list or on the map. Click anywhere else on the map to use a custom site (e.g. a landslide lake). Missing heights/capacities are not invented — enter them below.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card" id="dsel"></div>
        <div class="card"><h3>2 · Scenario &amp; breach</h3>
          <div class="field"><label>Scenario type</label><div class="seg" id="ltype">${['Dam Break', 'Sudden Water Release', 'River Blockage / Lake Burst'].map((t) => `<button data-v="${t}" class="${c.type === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
          <div class="grid g2"><div class="field"><label>Dam / blockage height (m)</label><input type="number" id="lh" min="1" step="1" value="${c.heightM ?? ''}"/></div><div class="field"><label>Storage released (MCM)</label><input type="number" id="ls" min="0.1" step="1" value="${c.storageMCM ?? ''}"/></div></div>
          <div class="field"><label>Breach presets (scaled from Froehlich estimates)</label><div class="preset-grid" id="lpre" style="grid-template-columns:repeat(4,1fr)">${Object.entries(LIVE_PRESETS).map(([k, p]) => `<button class="preset ${c.preset === k ? 'on' : ''}" data-p="${k}"><b>${p.label}</b><span>B×${p.wm} · tf×${p.tm}${p.sf < 1 ? ' · V×' + p.sf : ''}</span></button>`).join('')}<button class="preset ${c.preset === 'custom' ? 'on' : ''}" data-p="custom"><b>Custom</b><span>manual values</span></button></div></div>
          <div class="grid g3"><div class="field"><label>Breach width (m)</label><input type="number" id="lbw" min="0" value="${c.breachWidth || ''}" placeholder="auto"/></div><div class="field"><label>Formation time (min)</label><input type="number" id="lbt" min="0" value="${c.breachTime || ''}" placeholder="auto"/></div><div class="field"><label>Peak discharge (m³/s)</label><input type="number" id="lqp" min="0" value="${c.peakDischarge || ''}" placeholder="auto"/></div></div>
          <div id="bprev"></div>
        </div>
        <div class="card"><h3>3 · Domain, data &amp; models</h3>
          <div class="grid g3"><div class="field"><label>Reach length (km)</label><input type="number" id="lreach" min="10" max="150" value="${c.reachKm}"/></div><div class="field"><label>Lateral buffer (km)</label><input type="number" id="lbuf" min="3" max="30" value="${c.bufferKm}"/></div>
          <div class="field"><label>Grid resolution</label><select id="lres">${[['auto', 'Auto (≤70k cells)'], ['120', '120 m'], ['200', '200 m'], ['300', '300 m'], ['500', '500 m']].map(([v, l]) => `<option value="${v}" ${String(c.resolution) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
          <div class="grid g3"><div class="field"><label>Simulation duration</label><select id="ldur">${[[180, '3 h'], [360, '6 h'], [720, '12 h']].map(([v, l]) => `<option value="${v}" ${c.duration === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label>SPH max particles</label><input type="number" id="lpart" min="2000" max="40000" step="1000" value="${c.maxParticles}"/></div><div class="field"><label>Event / analysis date</label><input type="text" id="ldate" value="${c.eventDate}"/></div></div>
          <div class="grid g3">
            <div class="field"><label>Terrain dataset</label><select id="lterr"><option value="srtm" ${c.terrain === 'srtm' ? 'selected' : ''}>SRTM (AWS Terrain Tiles) — live</option><option value="upload" ${c.terrain === 'upload' ? 'selected' : ''}>Upload DEM (ESRI ASCII .asc)</option><option value="aster" ${c.terrain === 'aster' ? 'selected' : ''}>ASTER GDEM — not connected</option></select><input type="file" id="ldem" accept=".asc,.txt" class="${c.terrain === 'upload' ? '' : 'hidden'}" style="margin-top:6px"/><div id="ldemnote" class="dim" style="font-size:11px"></div></div>
            <div class="field"><label>Satellite dataset</label><select id="lsat"><option value="gibs">NASA GIBS MODIS/VIIRS — live imagery</option><option value="s1">Sentinel-1 (GEE script generated)</option><option value="landsat">Landsat (GEE) — not connected</option></select></div>
            <div class="field"><label>Hydrograph</label><select id="lhyd"><option value="froehlich" ${c.hydro === 'froehlich' ? 'selected' : ''}>Froehlich breach (auto)</option><option value="csv" ${c.hydro === 'csv' ? 'selected' : ''}>Upload CSV (time_min, Q)</option></select><input type="file" id="lcsv" accept=".csv,.txt" class="${c.hydro === 'csv' ? '' : 'hidden'}" style="margin-top:6px"/></div>
          </div>
          <div class="field"><label>Model</label><div class="seg" id="lmodel">${[['sph', 'SPH'], ['delft3d', 'Delft3D-class SWE'], ['both', 'Compare Both']].map(([k, l]) => `<button data-v="${k}" class="${(c.model || 'both') === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="dim" style="font-size:11px">Both solvers always run so the comparison is available; this sets the default view.</div></div>
          <div class="note">Simulation results are intended for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
          <button class="btn btn-primary btn-lg mt" style="width:100%" id="lrun">${T('run')}</button>
        </div>
      </div></div>`;
    let all = [], bp = null;
    const mapWrap = el.querySelector('#dmap2');
    const map = L.map(mapWrap, { preferCanvas: true, zoomSnap: 0.5 }).setView([22.5, 80], 4.5);
    L.tileLayer(FS.mapkit.BASEMAPS.dark.url, { maxNativeZoom: 16, attribution: FS.mapkit.BASEMAPS.dark.attr }).addTo(map);
    const dots = L.layerGroup().addTo(map), selL = L.layerGroup().addTo(map);
    const selCard = () => {
      const d = s.live.dam;
      el.querySelector('#dsel').innerHTML = !d ? '<h3>Selected site</h3><div class="muted">No dam selected yet.</div>' : `<h3>Selected site ${d.qid ? '<span class="tag tag-real">WIKIDATA</span>' : '<span class="tag tag-nc">CUSTOM</span>'}</h3>
        <div style="font-size:16px;font-weight:700">${F.esc(d.name)}</div><div class="muted" style="font-size:12px">${F.esc([d.river, d.state].filter(Boolean).join(' · ') || '—')} · ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}</div>
        <div class="pop-grid mt" style="font-size:12.5px"><span>Height</span><span>${d.heightM != null ? d.heightM + ' m' : 'unknown'}</span><span>Capacity</span><span>${d.storageMCM != null ? F.n(d.storageMCM) + ' MCM' : 'unknown'}</span><span>Opened</span><span>${d.year || '—'}</span></div>
        ${d.wikidataUrl ? `<a href="${d.wikidataUrl}" target="_blank" rel="noopener" style="font-size:12px">View on Wikidata ↗</a>` : ''}`;
      selL.clearLayers();
      if (d) { L.circleMarker([d.lat, d.lng], { radius: 9, color: '#22d3ee', weight: 3, fillOpacity: 0.3 }).addTo(selL); }
    };
    const choose = (d) => {
      s.live.dam = { qid: d.qid || null, name: d.name, lat: +d.lat, lng: +d.lng, river: d.river || null, state: d.state || null, heightM: d.heightM ?? null, storageMCM: d.capacityMCM ?? d.storageMCM ?? null, year: d.yearOpened || d.year || null, wikidataUrl: d.wikidataUrl || null, source: d.qid ? 'Wikidata (CC0)' : 'User-selected location' };
      c.heightM = s.live.dam.heightM; c.storageMCM = s.live.dam.storageMCM; c.breachWidth = 0; c.breachTime = 0; c.peakDischarge = 0; c.preset = 'medium';
      el.querySelector('#lh').value = c.heightM ?? ''; el.querySelector('#ls').value = c.storageMCM ?? '';
      ['#lbw', '#lbt', '#lqp'].forEach((q) => (el.querySelector(q).value = ''));
      el.querySelectorAll('#lpre .preset').forEach((b) => b.classList.toggle('on', b.dataset.p === 'medium'));
      selCard(); preview(); FS.app.save();
      map.setView([s.live.dam.lat, s.live.dam.lng], Math.max(map.getZoom(), 7));
    };
    const drawList = () => {
      const q = el.querySelector('#dq').value.toLowerCase();
      const list = all.filter((d) => !q || [d.name, d.river, d.state].some((x) => x && String(x).toLowerCase().includes(q)));
      el.querySelector('#dcount').textContent = `${list.length} of ${all.length}`;
      el.querySelector('#dlist').innerHTML = `<tr><th>Dam</th><th>River</th><th>State</th><th class="num">Height</th><th class="num">Capacity</th></tr>` + list.slice(0, 250).map((d, k) => `<tr class="click ${s.live.dam && s.live.dam.qid === d.qid ? 'sel' : ''}" data-q="${d.qid}"><td>${F.esc(d.name)}</td><td class="muted">${F.esc(d.river || '—')}</td><td class="muted">${F.esc(d.state || '—')}</td><td class="num">${d.heightM != null ? d.heightM + ' m' : '—'}</td><td class="num">${(d.capacityMCM ?? d.storageMCM) != null ? F.n(d.capacityMCM ?? d.storageMCM) : '—'}</td></tr>`).join('');
      dots.clearLayers();
      list.forEach((d) => L.circleMarker([d.lat, d.lng], { radius: 3.5, color: (d.capacityMCM ?? d.storageMCM) != null && d.heightM != null ? '#22d3ee' : '#64748b', weight: 1, fillOpacity: 0.8 }).bindTooltip(F.esc(d.name)).on('click', (ev) => { L.DomEvent.stop(ev); choose(d); drawList(); }).addTo(dots));
    };
    el.querySelector('#dlist').onclick = (e) => { const r = e.target.closest('tr[data-q]'); if (!r) return; choose(all.find((d) => d.qid === r.dataset.q)); drawList(); };
    el.querySelector('#dq').oninput = drawList;
    map.on('click', (e) => { choose({ name: `Custom site (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`, lat: e.latlng.lat, lng: e.latlng.lng }); drawList(); });
    FS.api.get('/api/dams?limit=5000').then((r) => { all = r.dams; drawList(); }).catch((e) => (el.querySelector('#dcount').textContent = 'Catalogue error: ' + e.message));
    const preview = async () => {
      const box = el.querySelector('#bprev');
      if (!(c.heightM > 0 && c.storageMCM > 0)) { box.innerHTML = '<div class="note">Enter dam height and released storage to compute breach parameters.</div>'; bp = null; return; }
      try {
        const p = LIVE_PRESETS[c.preset];
        bp = await FS.api.post('/api/breach', { heightM: c.heightM, storageMCM: c.storageMCM * (p ? p.sf : 1), mode: c.type === 'River Blockage / Lake Burst' ? 'piping' : 'overtopping' });
        box.innerHTML = `<div class="kpis">${U.kpi('Breach width (Froehlich 2008)', F.n(bp.breachWidthM), 'm', 'cyan')}${U.kpi('Formation time', F.n(bp.failureTimeMin), 'min')}${U.kpi('Qp Froehlich 1995', F.n(bp.peakQ_Froehlich1995), 'm³/s', 'amber')}${U.kpi('Qp MacDonald–LM 1984', F.n(bp.peakQ_MLM1984), 'm³/s')}</div><div class="dim" style="font-size:11px;margin-top:6px">Empirical regression estimates from historical dam failures; empty fields above use these values (scaled by the preset).</div>`;
      } catch (e) { box.innerHTML = `<div class="note">Breach estimate failed: ${F.esc(e.message)}</div>`; }
    };
    const num = (q, k) => (el.querySelector(q).oninput = (e) => { c[k] = +e.target.value || null; if (['breachWidth', 'breachTime', 'peakDischarge'].includes(k)) { c.preset = 'custom'; el.querySelectorAll('#lpre .preset').forEach((b) => b.classList.toggle('on', b.dataset.p === 'custom')); } clearTimeout(num.t); num.t = setTimeout(preview, 300); FS.app.save(); });
    num('#lh', 'heightM'); num('#ls', 'storageMCM'); num('#lbw', 'breachWidth'); num('#lbt', 'breachTime'); num('#lqp', 'peakDischarge');
    el.querySelector('#lpre').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; c.preset = b.dataset.p; el.querySelectorAll('#lpre .preset').forEach((x) => x.classList.toggle('on', x === b)); if (c.preset !== 'custom') { c.breachWidth = 0; c.breachTime = 0; c.peakDischarge = 0; ['#lbw', '#lbt', '#lqp'].forEach((q) => (el.querySelector(q).value = '')); } preview(); };
    const seg = (id, k, cb) => (el.querySelector(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; c[k] = b.dataset.v; el.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('on', x === b)); cb && cb(); });
    seg('#ltype', 'type', preview); seg('#lmodel', 'model');
    const bind = (q, k, cast) => (el.querySelector(q).onchange = (e) => { c[k] = cast ? cast(e.target.value) : e.target.value; FS.app.save(); });
    bind('#lreach', 'reachKm', Number); bind('#lbuf', 'bufferKm', Number); bind('#lres', 'resolution'); bind('#ldur', 'duration', Number); bind('#lpart', 'maxParticles', Number); bind('#ldate', 'eventDate');
    el.querySelector('#lterr').onchange = (e) => { c.terrain = e.target.value; el.querySelector('#ldem').classList.toggle('hidden', c.terrain !== 'upload'); el.querySelector('#ldemnote').textContent = c.terrain === 'aster' ? 'ASTER is not connected — SRTM (AWS Terrain Tiles) will be used.' : ''; };
    el.querySelector('#ldem').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      el.querySelector('#ldemnote').textContent = 'Uploading…';
      try { const r = await FS.api.post('/api/dem', await f.text(), true); c.demUploadId = r.id; el.querySelector('#ldemnote').textContent = `Uploaded ${r.cols}×${r.rows} grid (${r.id}). It must cover the dam and the downstream reach.`; } catch (err) { c.demUploadId = null; el.querySelector('#ldemnote').textContent = 'Upload failed: ' + err.message; }
    };
    el.querySelector('#lhyd').onchange = (e) => { c.hydro = e.target.value; el.querySelector('#lcsv').classList.toggle('hidden', c.hydro !== 'csv'); if (c.hydro !== 'csv') c.hydrographCsv = null; };
    el.querySelector('#lcsv').onchange = async (e) => { const f = e.target.files[0]; if (f) { c.hydrographCsv = await f.text(); FS.app.toast('Hydrograph CSV loaded (' + c.hydrographCsv.split(/\n/).length + ' lines)'); } };
    el.querySelector('#lrun').onclick = () => {
      const d = s.live.dam;
      if (!d) return FS.app.toast('Select a dam or a custom site first');
      if (!(c.heightM > 0 && c.storageMCM > 0)) return FS.app.toast('Dam height and released storage are required');
      const p = LIVE_PRESETS[c.preset] || { sf: 1, wm: 1, tm: 1 };
      const config = { type: c.type, heightM: c.heightM, storageMCM: c.storageMCM * (c.preset === 'custom' ? 1 : p.sf), breachWidth: c.breachWidth || (bp ? Math.round(bp.breachWidthM * p.wm) : 0), breachTime: c.breachTime || (bp ? Math.round(bp.failureTimeMin * p.tm) : 0), peakDischarge: c.peakDischarge || 0, reachKm: c.reachKm, bufferKm: c.bufferKm, resolution: c.resolution, duration: c.duration, maxParticles: c.maxParticles, eventDate: c.eventDate, model: c.model || 'both', preset: c.preset, demUploadId: c.terrain === 'upload' ? c.demUploadId : null, hydrographCsv: c.hydro === 'csv' ? c.hydrographCsv : null, terrain: c.terrain, satellite: el.querySelector('#lsat').value };
      FS.app.modal('Before running the simulation', `<p>Run <b>${F.esc(c.type)}</b> for <b>${F.esc(d.name)}</b> with ${F.n(config.storageMCM)} MCM released over ${c.duration / 60} h?</p>
        <div class="note">Simulation results are intended for decision-support and scenario analysis. Validate with authoritative hydrological and field data before operational use.</div>
        <p class="muted" style="font-size:12px">The backend fetches SRTM-derived terrain and OpenStreetMap data, then runs the in-house SPH-SWE particle solver and 2D finite-volume shallow-water solver (Delft3D-class; a Delft3D-FLOW input deck is also written). Expect roughly 1–4 minutes depending on resolution. A dam failure here is a hypothetical scenario, not a prediction.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn" onclick="FS.app.closeModal()">Cancel</button><button class="btn btn-primary" id="goRun">Acknowledge &amp; run</button></div>`,
        (b) => (b.querySelector('#goRun').onclick = () => { FS.app.closeModal(); FS.app.runLive({ dam: d, config }); }));
    };
    selCard(); preview();
    setTimeout(() => map.invalidateSize(), 60);
    return () => map.remove();
  }

  function demoBuilder(el) {
    const s = st(), c = s.cfg;
    const slider = (k, label, min, max, step, unit) => `<div class="field"><label>${label} <b id="v_${k}">${c[k]} ${unit}</b></label><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${c[k]}"/></div>`;
    el.innerHTML = `<div class="card mb"><h3>Indian river / dam demonstration library ${U.demo('OFFLINE DEMO')}</h3><div class="lib">${D.scenarioLibrary.map((l) => `<div class="lib-item ${l.status === 'READY' ? 'on' : 'off'}" title="${l.note}"><div class="row between"><b>${l.river}</b>${l.status === 'READY' ? '<span class="tag tag-demo">DEMO READY</span>' : '<span class="tag tag-nc">USE LIVE MODE</span>'}</div><div class="muted" style="font-size:11.5px">${l.region}</div><div class="dim" style="font-size:11px;margin-top:3px">${l.status === 'READY' ? l.note : 'Any Indian dam can be simulated in Live mode (backend) from the Wikidata catalogue.'}</div></div>`).join('')}</div></div>
    <div class="grid g2">
      <div class="card"><h3>Scenario configuration</h3>
        <div class="field"><label>Scenario type</label><div class="seg" id="type">${['Dam Break', 'Sudden Water Release', 'River Blockage / Lake Burst'].map((t) => `<button data-v="${t}" class="${c.type === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        <div class="field"><label>Scenario presets</label><div class="preset-grid" id="presets">${Object.entries(D.presets).map(([k, p]) => `<button class="preset ${c.preset === k ? 'on' : ''}" data-p="${k}"><b>${p.label}</b><span>${p.breachWidth} m · ${p.waterLevel} m head</span></button>`).join('')}<button class="preset ${c.preset === 'custom' ? 'on' : ''}" data-p="custom"><b>Custom Scenario</b><span>Edit parameters</span></button></div></div>
        ${slider('waterLevel', 'Initial water level (head above breach invert)', 5, 40, 1, 'm')}${slider('breachWidth', 'Dam break width', 20, 600, 10, 'm')}${slider('breachTime', 'Break formation time', 5, 180, 5, 'min')}${slider('storage', 'Reservoir storage released', 50, 1500, 25, 'MCM')}
        <div class="grid g2"><div class="field"><label>Peak discharge (m³/s) <span class="dim">0 = auto</span></label><input type="number" id="qp" min="0" step="500" value="${c.peakDischarge || 0}"/></div>
        <div class="field"><label>Simulation duration</label><select id="dur">${[[180, '3 hours'], [360, '6 hours'], [720, '12 hours']].map(([v, l]) => `<option value="${v}" ${c.duration === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      </div>
      <div class="card"><h3>Model &amp; run</h3>
        <div class="field"><label>Model</label><div class="seg" id="model">${[['sph', 'SPH'], ['delft3d', 'Delft3D'], ['both', 'Compare Both']].map(([k, l]) => `<button data-v="${k}" class="${c.model === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="kpis" id="derived" style="grid-template-columns:1fr 1fr"></div>
        <div class="note mt">Offline demo: synthetic DEM and settlements, browser surrogate instead of numerical solvers. Use Live mode for real computations.</div>
        <button class="btn btn-primary btn-lg mt" style="width:100%" id="runBtn">${T('run')} (DEMO)</button>
      </div></div>`;
    const derived = () => { const q = FS.app.effectiveCfg(); const Q = q.peakDischarge > 0 ? q.peakDischarge : FS.demo.peakDischarge(q); el.querySelector('#derived').innerHTML = U.kpi('Peak discharge', F.n(Q), 'm³/s', 'cyan') + U.kpi('Release volume', F.n(c.storage), 'MCM') + U.kpi('Recession (≈V/Qp)', F.n((c.storage * 1e6) / Q / 60), 'min') + U.kpi('Duration', c.duration / 60, 'h'); };
    el.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => { c[r.dataset.k] = +r.value; c.preset = 'custom'; el.querySelector('#v_' + r.dataset.k).textContent = `${r.value} ${r.dataset.k === 'breachTime' ? 'min' : r.dataset.k === 'storage' ? 'MCM' : 'm'}`; el.querySelectorAll('#presets .preset').forEach((b) => b.classList.toggle('on', b.dataset.p === 'custom')); derived(); }));
    el.querySelector('#presets').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; FS.app.applyPreset(b.dataset.p); demoBuilder(el); };
    const segs = (id, key) => (el.querySelector(id).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; c[key] = b.dataset.v; el.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('on', x === b)); derived(); });
    segs('#type', 'type'); segs('#model', 'model');
    el.querySelector('#qp').oninput = (e) => { c.peakDischarge = +e.target.value || 0; derived(); };
    el.querySelector('#dur').onchange = (e) => { c.duration = +e.target.value; derived(); };
    el.querySelector('#runBtn').onclick = () => FS.app.runDemo();
    derived();
  }

  // ---------- FLOOD SIMULATION ----------
  V.simulation = function (view) {
    const s = st();
    view.classList.add('fill');
    view.innerHTML = `<div class="dash" style="grid-template-columns:400px minmax(0,1fr)">
      <div class="dash-side">
        <div class="card"><h3>Simulation workflow <span id="wtag"></span></h3><div class="progress mb"><i id="prog" style="width:0"></i></div><div id="pmsg" class="muted mb" style="font-size:12px"></div><ul class="steps" id="steps"></ul></div>
        <div class="card" id="logCard"><h3>Backend log</h3><div class="alert-box" id="log" style="min-height:0;max-height:180px;overflow:auto;font-size:11px"></div></div>
        <div class="card" id="resCard"><h3>Simulation results ${U.demo()}</h3><div class="seg mb" id="modelSeg"><button data-m="sph">SPH</button><button data-m="delft3d">Delft3D${FS.app.isLive() ? '-class' : ''}</button></div><div class="kpis" id="sk" style="grid-template-columns:1fr 1fr"></div></div>
      </div>
      <div class="dash-map"><div class="map-wrap" id="smap"></div><div id="stl"></div></div></div>`;
    const mv = U.mountMap(view.querySelector('#smap'), { mode: 'depth' });
    let tl = U.timeline(view.querySelector('#stl'), s.scn.config.duration, (t) => { s.t = t; mv.update(U.mapData(t)); }, { speed: 70 });
    const drawSteps = () => {
      const live = s.runKind === 'live' && s.job;
      const n = FS.app.STEPS.length, k = s.running ? s.step : n;
      view.querySelector('#wtag').innerHTML = live || FS.app.isLive() ? '<span class="tag tag-sim">BACKEND · NUMERICAL</span>' : '<span class="tag tag-demo">BROWSER SURROGATE</span>';
      view.querySelector('#prog').style.width = `${Math.min(100, (live ? s.job.progress || 0 : k / (n - 1)) * 100)}%`;
      view.querySelector('#pmsg').textContent = live ? `${s.job.status.toUpperCase()} · ${s.job.message || ''}${s.job.error ? ' — ' + s.job.error : ''}` : s.running ? 'Running offline demo…' : `Last run: ${s.runSource}`;
      view.querySelector('#steps').innerHTML = FS.app.STEPS.map(([l, d], i) => {
        const cls = i < k ? 'ok' : i === k && s.running ? 'run' : '';
        const tm = i < k && s.stepTimes && s.stepTimes[i] != null ? (s.stepTimes[i] > 1500 ? (s.stepTimes[i] / 1000).toFixed(1) + ' s' : s.stepTimes[i].toFixed(0) + ' ms') : '';
        const note = !live && !FS.app.isLive() ? FS.app.demoNote(i) || d : d;
        return `<li class="${cls}"><span class="si">${i < k ? '✓' : i + 1}</span><div><div>Step ${i + 1}: ${l}</div>${note ? `<div class="dim" style="font-size:11px">${note}</div>` : ''}</div><span class="sd">${tm}</span></li>`;
      }).join('');
      const logs = live ? s.job.log : FS.app.isLive() ? s.scn.log : null;
      view.querySelector('#logCard').classList.toggle('hidden', !logs);
      if (logs) { const lb = view.querySelector('#log'); lb.textContent = logs.join('\n'); lb.scrollTop = lb.scrollHeight; }
    };
    const drawRes = () => {
      const c = FS.app.cur();
      view.querySelector('#resCard').style.opacity = s.running ? 0.35 : 1;
      view.querySelector('#sk').innerHTML = U.kpis(c.ana.kpi, true);
      view.querySelectorAll('#modelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === s.activeModel));
      mv.update(U.mapData(s.t));
    };
    view.querySelector('#modelSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { s.activeModel = b.dataset.m; drawRes(); FS.app.renderStatus(); } };
    V._simStep = (done) => {
      drawSteps();
      if (done) {
        tl.destroy(); tl = U.timeline(view.querySelector('#stl'), s.scn.config.duration, (t) => { s.t = t; mv.update(U.mapData(t)); }, { speed: 70 });
        drawRes(); tl.set(0); tl.start(); FS.app.toast('Simulation complete — ' + FS.app.dataTag());
      }
    };
    drawSteps();
    if (!s.running) drawRes(); else { view.querySelector('#resCard').style.opacity = 0.35; mv.update({ scn: s.scn, M: null, ana: null, t: 0 }); }
    tl.set(s.running ? 0 : s.t, false);
    return () => { V._simStep = null; tl.destroy(); mv.destroy(); };
  };

  // ---------- MODEL COMPARISON ----------
  V.models = function (view) {
    const s = st(), scn = s.scn, live = FS.app.isLive();
    const Asph = { M: scn.models.sph, ana: s.ana.sph }, Bd = { M: scn.models.delft3d, ana: s.ana.delft3d };
    const bName = live ? 'Delft3D-class 2D SWE' : 'Delft3D';
    view.innerHTML = `<div class="page-head"><div><h1>${T('nav_models')}: SPH vs ${bName}</h1><p>Side-by-side maximum flood depth with synchronised zoom/pan, difference map, profiles and solver diagnostics.</p></div>${U.demo()}</div>
    <div class="note mb">${live ? `<b>SPH</b>: ${F.esc(Asph.M.engine)}. <b>${bName}</b>: ${F.esc(Bd.M.engine)}. Both are genuine numerical solutions computed by the backend on the same DEM, breach hydrograph and roughness. The ${bName} solver is <b>not</b> Delft3D itself; a Delft3D-FLOW input deck for the same case is available under Export &amp; Reports.` : 'Offline demo: both outputs come from the browser surrogate with model-specific calibration offsets and are <b>not</b> results of SPH or Delft3D numerical runs. Start the backend for real solver comparisons.'}</div>
    <div class="split mb"><div class="map-wrap" id="mA"><div class="map-title">Smooth Particle Hydrodynamics</div></div><div class="map-wrap" id="mB"><div class="map-title">${bName}</div></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
      <div class="card"><h3>Comparison metrics ${U.demo()}</h3><table class="tbl" id="mt"></table></div>
      <div class="card"><h3>Relative difference (SPH vs ${bName}, %)</h3><div style="height:250px"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>SPH vs ${bName} Difference</h3><div class="map-wrap" id="mD" style="height:340px"></div></div>
      <div class="card"><h3>Longitudinal profile along the river — peak depth &amp; arrival</h3><div style="height:340px"><canvas id="c2"></canvas></div></div>
      <div class="card" style="grid-column:1/-1"><h3>Solver diagnostics</h3><table class="tbl" id="diag"></table></div>
    </div>`;
    const opts = { tools: false, modes: false, legend: true, layers: { river: true, dam: true, villages: true, labels: false, extent: true } };
    const ma = U.mountMap(view.querySelector('#mA'), opts), mb = U.mountMap(view.querySelector('#mB'), opts);
    const T0 = scn.config.duration;
    ma.update({ scn, M: Asph.M, ana: Asph.ana, t: T0 }); mb.update({ scn, M: Bd.M, ana: Bd.ana, t: T0 });
    let lock = false;
    const sync = (a, b) => a.map.on('move', () => { if (lock) return; lock = true; b.map.setView(a.map.getCenter(), a.map.getZoom(), { animate: false }); lock = false; });
    sync(ma, mb); sync(mb, ma);
    const md = U.mountMap(view.querySelector('#mD'), { tools: false, modes: false, legend: false, layers: { river: true, dam: true } });
    md.update({ scn, M: null, ana: null, t: 0 });
    L.imageOverlay(FS.mapkit.renderDiff(scn, Asph.M, Bd.M), FS.mapkit.gridBounds(scn.grid), { pane: 'floodPane', className: 'flood-img' }).addTo(md.map);
    const lg = document.createElement('div'); lg.className = 'map-ctl legend';
    const P = FS.mapkit.PAL.diff;
    lg.innerHTML = `<div class="legend-t">${P.title}</div>` + P.labels.map((l, i) => `<div class="legend-row"><i style="background:${P.colors[i]}"></i>${l}</div>`).join('');
    view.querySelector('#mD').appendChild(lg);
    const Ka = Asph.ana.kpi, Kb = Bd.ana.kpi;
    const rows = [['Inundated area', Ka.area, Kb.area, 'km²', 1], ['Maximum depth', Ka.maxDepth, Kb.maxDepth, 'm', 2], ['Peak velocity', Ka.maxVel, Kb.maxVel, 'm/s', 2], ['First arrival (settlement)', Ka.firstArrival, Kb.firstArrival, 'min', 0], ['Affected villages', Ka.villages, Kb.villages, '', 0], ['Affected population', Ka.population, Kb.population, '', 0], ['Affected infrastructure', Ka.infra, Kb.infra, '', 0], ['Roads flooded', Ka.roads, Kb.roads, 'seg', 0], ['Bridges at risk', Ka.bridges, Kb.bridges, '', 0]];
    view.querySelector('#mt').innerHTML = `<tr><th>Metric</th><th class="num">SPH</th><th class="num">${bName}</th><th class="num">Δ</th></tr>` + rows.map(([l, a, b, u, d]) => `<tr><td>${l}</td><td class="num">${F.n(a, d)} ${u}</td><td class="num">${F.n(b, d)} ${u}</td><td class="num" style="color:${a - b > 0 ? '#fdba74' : '#93c5fd'}">${isFinite(a - b) ? (a - b > 0 ? '+' : '') + F.n(a - b, d) : '—'}</td></tr>`).join('');
    const pct = rows.filter((r) => r[2] && isFinite(r[1]) && isFinite(r[2])).map((r) => [r[0], ((r[1] - r[2]) / r[2]) * 100]);
    const c1 = new Chart(view.querySelector('#c1'), { type: 'bar', data: { labels: pct.map((p) => p[0]), datasets: [{ data: pct.map((p) => +p[1].toFixed(1)), backgroundColor: pct.map((p) => (p[1] >= 0 ? '#f97316' : '#3b82f6')) }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: `% difference (SPH − ${bName}) / ${bName}` } } } } });
    const pa = A.riverProfile(scn, Asph.M, 1), pb = A.riverProfile(scn, Bd.M, 1);
    const fin = (v) => (isFinite(v) ? Math.round(v) : null);
    const c2 = new Chart(view.querySelector('#c2'), { type: 'line', data: { labels: pa.map((p) => p.km.toFixed(0)), datasets: [
      { label: 'SPH peak depth (m)', data: pa.map((p) => +p.depth.toFixed(2)), borderColor: '#f97316', pointRadius: 0, yAxisID: 'y' },
      { label: `${bName} peak depth (m)`, data: pb.map((p) => +p.depth.toFixed(2)), borderColor: '#38bdf8', pointRadius: 0, yAxisID: 'y' },
      { label: 'SPH arrival (min)', data: pa.map((p) => fin(p.arrival)), borderColor: '#f97316', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y1', spanGaps: true },
      { label: `${bName} arrival (min)`, data: pb.map((p) => fin(p.arrival)), borderColor: '#38bdf8', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y1', spanGaps: true }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { title: { display: true, text: 'Distance downstream along river (km)' } }, y: { title: { display: true, text: 'Depth (m)' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Arrival (min)' } } } } });
    const sa = Asph.M.stats || {}, sb = Bd.M.stats || {};
    const dRow = (l, f) => `<tr><td>${l}</td><td class="num">${f(sa)}</td><td class="num">${f(sb)}</td></tr>`;
    view.querySelector('#diag').innerHTML = `<tr><th>Quantity</th><th class="num">SPH</th><th class="num">${bName}</th></tr>` + (live ? [
      dRow('Engine', (x) => F.esc(x.engine || '—')), dRow('Time steps', (x) => F.n(x.steps)), dRow('Runtime', (x) => (x.runtimeMs / 1000).toFixed(1) + ' s'),
      dRow('Mass balance error', (x) => (+x.massErrorPct).toFixed(2) + ' %'), dRow('Inflow volume', (x) => F.n(x.volumeIn / 1e6, 1) + ' Mm³'), dRow('Outflow (left domain)', (x) => F.n(x.volumeOut / 1e6, 1) + ' Mm³'),
      dRow('Time step range', (x) => (x.dtMin != null ? `${(+x.dtMin).toFixed(2)} – ${(+x.dtMax).toFixed(2)} s` : '—')), dRow('Peak particle count', (x) => (x.particles ? F.n(x.particles) : '—'))
    ].join('') + `<tr><td>Grid</td><td class="num" colspan="2">${scn.grid.cols} × ${scn.grid.rows} cells · ${Math.round(scn.grid.dx)} × ${Math.round(scn.grid.dy)} m</td></tr>` : `<tr><td colspan="3" class="muted">Offline demo surrogate — no numerical solver diagnostics. Run a live scenario for time-step, mass-balance and particle statistics.</td></tr>`);
    setTimeout(() => [ma, mb, md].forEach((m) => !m.dead && m.map.invalidateSize()), 60);
    return () => { c1.destroy(); c2.destroy(); ma.destroy(); mb.destroy(); md.destroy(); };
  };
})();
