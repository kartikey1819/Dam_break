/* FloodSim HADR — application state, backend client, simulation workflow, navigation. */
(function () {
  const A = FS.analysis, D = FS.data;
  const CACHE_KEY = 'floodsim_hadr_cache_v2';

  // ---------- backend API client ----------
  const API = (FS.api = {
    base: '',
    async get(p, opts) { const r = await fetch(API.base + p, Object.assign({ cache: 'no-store' }, opts || {})); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.headers.get('content-type')?.includes('json') ? r.json() : r.text(); },
    async post(p, body, raw) { const r = await fetch(API.base + p, { method: 'POST', headers: { 'Content-Type': raw ? 'text/plain' : 'application/json' }, body: raw ? body : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
    async health() {
      if (!/^https?:$/.test(location.protocol)) return null;
      try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500); const h = await API.get('/api/health', { signal: c.signal }); clearTimeout(t); return h; } catch (e) { return null; }
    },
    exportUrl: (id, fmt, model) => `${API.base}/api/scenarios/${id}/export/${fmt}${model ? '?model=' + model : ''}`
  });

  const defaultDemoCfg = () => Object.assign({ type: 'Dam Break', preset: 'medium', peakDischarge: 0, duration: 360, terrain: 'DEM Demo Dataset', satellite: 'Demo Dataset', model: 'both' }, pick(D.presets.medium));
  function pick(p) { return { waterLevel: p.waterLevel, breachWidth: p.breachWidth, breachTime: p.breachTime, storage: p.storage }; }
  const defaultLiveCfg = () => ({ type: 'Dam Break', preset: 'medium', heightM: null, storageMCM: null, breachWidth: 0, breachTime: 0, peakDischarge: 0, reachKm: 60, bufferKm: 10, resolution: 'auto', duration: 360, maxParticles: 12000, manning: 0.035, eventDate: new Date().toISOString().slice(0, 10), terrain: 'srtm', satellite: 'gibs', hydro: 'froehlich', demUploadId: null, hydrographCsv: null });

  const S = (FS.state = {
    page: 'dashboard', lang: 'en', forceOffline: false, netOnline: navigator.onLine,
    backend: { online: false, health: null },
    scn: null, ana: null, activeModel: 'delft3d', t: 180, lastRun: null, runSource: '',
    cfg: defaultDemoCfg(), live: { dam: null, cfg: defaultLiveCfg(), job: null }, builderMode: 'live',
    weights: Object.assign({}, A.DEFAULT_WEIGHTS), roadThreshold: 0.3, t0: 15,
    running: false, step: -1, stepTimes: [], evac: { start: null, dest: 'auto', mode: 'vehicle' }, selVillage: null
  });
  Object.defineProperty(S, 'online', { get: () => S.netOnline && !S.forceOffline });

  FS.app = {};
  FS.app.cur = () => ({ scn: S.scn, M: S.scn && S.scn.models[S.activeModel], res: S.scn && S.scn.models[S.activeModel], ana: S.ana && S.ana[S.activeModel] });
  FS.app.other = () => { const k = S.activeModel === 'sph' ? 'delft3d' : 'sph'; return { M: S.scn.models[k], ana: S.ana[k] }; };
  FS.app.isLive = () => !!(S.scn && S.scn.mode === 'live');
  FS.app.scenarioName = () => (S.scn ? (S.scn.mode === 'live' ? S.scn.name : `Kosi Demo Dam — ${S.cfg.preset === 'custom' ? 'Custom' : D.presets[S.cfg.preset].label} (${S.cfg.type})`) : '—');
  FS.app.dataTag = () => (FS.app.isLive() ? 'SIMULATED · OPEN-DATA INPUTS' : 'SIMULATED DEMO DATA');
  FS.app.effectiveCfg = () => {
    const c = Object.assign({}, S.cfg);
    if (c.type === 'Sudden Water Release' && !(c.peakDischarge > 0)) c.peakDischarge = Math.round(FS.demo.peakDischarge(c) * 0.45);
    return c;
  };

  FS.app.setScenario = function (scn, source) {
    S.scn = scn;
    S.runSource = source || S.runSource;
    S.t = Math.min(180, scn.config.duration || 360);
    const vs = scn.features.villages;
    if (!vs.find((v) => v.id === S.evac.start)) S.evac.start = null;
    S.selVillage = null; S.priSel = null; S.whatIf = null;
    FS.app.recomputeAnalysis(true);
    if (!S.evac.start) { const top = S.ana[S.activeModel].villages.filter((v) => v.affected).sort((a, b) => b.score - a.score)[0]; S.evac.start = top ? top.id : vs[0] && vs[0].id; }
  };
  FS.app.recomputeAnalysis = function (skipSave) {
    const o = { weights: S.weights, roadThreshold: S.roadThreshold, t0: S.t0 };
    S.ana = { sph: A.analyse(S.scn, 'sph', o), delft3d: A.analyse(S.scn, 'delft3d', o) };
    if (!skipSave) save();
  };
  function computeDemo() { FS.app.setScenario(FS.demo.buildScenario(FS.app.effectiveCfg()), 'Offline demo (browser surrogate)'); }

  // ---------- simulation workflow ----------
  FS.app.STEPS = [
    ['Loading DEM', 'Terrain grid'], ['Preparing hydrological inputs', 'Breach parameters & hydrograph'], ['Generating dam-break scenario', 'Domain, reservoir mask, breach cells'],
    ['Running SPH model', 'Particle solver'], ['Running Delft3D model', '2D shallow-water solver + Delft3D deck'], ['Generating inundation map', 'Depth / extent rasters'],
    ['Calculating impact statistics', 'Area, depth, velocity, hazard'], ['Generating village/infrastructure impact', 'Villages, groups, roads, bridges, facilities'],
    ['Calculating flood arrival-time zones', 'Arrival & duration classes'], ['Generating HADR priority analysis', 'Rule-based scoring + evacuation routing'], ['Simulation complete', '']
  ];
  const DEMO_NOTES = { 0: 'DEM Demo Dataset (synthetic)', 3: 'Browser surrogate with SPH offsets — backend not running', 4: 'Browser surrogate with Delft3D offsets — backend not running' };
  FS.app.runDemo = function () {
    if (S.running) return;
    S.running = true; S.runKind = 'demo'; S.step = 0; S.stepTimes = []; S.job = null;
    S.activeModel = S.cfg.model === 'sph' ? 'sph' : 'delft3d';
    go('simulation');
    const t0 = performance.now();
    const tick = () => {
      const st = performance.now();
      if (S.step === 4) computeDemo();
      S.stepTimes[S.step] = performance.now() - st;
      S.step++;
      FS.views._simStep && FS.views._simStep();
      if (S.step < FS.app.STEPS.length - 1) setTimeout(tick, 220 + Math.random() * 220);
      else finish(performance.now() - t0);
    };
    setTimeout(tick, 250);
  };
  FS.app.demoNote = (i) => DEMO_NOTES[i];
  function finish() {
    S.step = FS.app.STEPS.length; S.running = false; S.lastRun = new Date(); S.t = 0;
    save(); renderStatus();
    FS.views._simStep && FS.views._simStep(true);
  }
  FS.app.runLive = async function (req) {
    if (S.running) return FS.app.toast('A simulation is already running');
    let job;
    try { job = await API.post('/api/jobs', req); } catch (e) { return FS.app.toast('Could not start job: ' + e.message); }
    S.running = true; S.runKind = 'live'; S.job = job; S.step = 0; S.stepTimes = [];
    go('simulation');
    const poll = async () => {
      try { S.job = await API.get('/api/jobs/' + job.id); } catch (e) { S.job = Object.assign({}, S.job, { message: 'Connection to backend lost — retrying…' }); }
      S.step = S.job.step || 0; S.stepTimes = S.job.stepTimes || [];
      FS.views._simStep && FS.views._simStep();
      if (S.job.status === 'done') {
        try { await FS.app.loadLive(S.job.scenarioId, true); } catch (e) { FS.app.toast('Failed to load result: ' + e.message); }
        S.activeModel = req.config.model === 'sph' ? 'sph' : 'delft3d';
        finish();
      } else if (S.job.status === 'error' || S.job.status === 'cancelled') {
        S.running = false; FS.views._simStep && FS.views._simStep(); FS.app.toast('Simulation failed: ' + (S.job.error || S.job.status));
      } else setTimeout(poll, 1000);
    };
    setTimeout(poll, 600);
  };
  FS.app.loadLive = async function (id, silent) {
    const j = await API.get('/api/scenarios/' + id);
    FS.app.setScenario(A.unpackScenario(j), 'Backend numerical run (' + id + ')');
    S.lastRun = new Date(S.scn.createdAt); S.liveId = id;
    save();
    if (!silent) { renderStatus(); FS.app.toast('Loaded scenario: ' + S.scn.name); }
  };
  FS.app.loadDemo = function () { computeDemo(); S.lastRun = new Date(); S.liveId = null; save(); renderStatus(); };
  FS.app.applyPreset = function (key) {
    S.cfg.preset = key;
    if (D.presets[key]) Object.assign(S.cfg, pick(D.presets[key]));
    S.cfg.peakDischarge = 0;
  };
  FS.app.reset = function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    S.cfg = defaultDemoCfg(); S.live.cfg = defaultLiveCfg(); S.weights = Object.assign({}, A.DEFAULT_WEIGHTS); S.roadThreshold = 0.3; S.t0 = 15; S.activeModel = 'delft3d';
    FS.app.loadDemo(); go('dashboard'); toast('Demo scenario reset');
  };

  // ---------- cache (low-connectivity support) ----------
  function save() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ cfg: S.cfg, liveCfg: S.live.cfg, liveDam: S.live.dam, liveId: S.liveId || null, weights: S.weights, lang: S.lang, lastRun: S.lastRun, roadThreshold: S.roadThreshold, t0: S.t0, forceOffline: S.forceOffline, savedAt: new Date() })); } catch (e) {}
  }
  FS.app.save = save;
  function load() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c) return null;
      Object.assign(S.cfg, c.cfg); Object.assign(S.live.cfg, c.liveCfg || {}); S.live.dam = c.liveDam || null; Object.assign(S.weights, c.weights);
      S.lang = c.lang || 'en'; S.roadThreshold = c.roadThreshold || 0.3; S.t0 = c.t0 ?? 15; S.forceOffline = !!c.forceOffline;
      S.lastRun = c.lastRun ? new Date(c.lastRun) : null;
      return c;
    } catch (e) { return null; }
  }

  // ---------- UI shell ----------
  const NAV = [['dashboard', '◉'], ['builder', '⚙'], ['simulation', '▶'], ['models', '⇄'], ['impact', '▦'], ['nrt', '◐'], ['evac', '➜'], ['priority', '⚑'], ['whatif', '≡'], ['sep'], ['export', '⤓'], ['data', '▤'], ['arch', '⌘'], ['settings', '☰']];
  function renderNav() {
    document.getElementById('nav').innerHTML = NAV.map(([k, i]) => (k === 'sep' ? '<div class="nav-sep"></div>' : `<button class="nav-item ${S.page === k ? 'active' : ''}" data-go="${k}"><span class="ni">${i}</span><span class="nl">${FS.t('nav_' + k)}</span></button>`)).join('');
  }
  function renderStatus() {
    const K = S.ana && S.ana[S.activeModel].kpi;
    const sev = K ? K.severity : 'LOW';
    const sevCls = sev === 'SEVERE' ? 'bad' : sev === 'HIGH' || sev === 'MODERATE' ? 'warn' : '';
    const live = FS.app.isLive();
    document.getElementById('statusbar').innerHTML = `
      <span class="chip ${S.online ? '' : 'warn'}"><span class="led"></span><b>${S.online ? FS.t('online') : FS.t('offline')}</b></span>
      <span class="chip ${S.backend.online ? '' : 'warn'}" title="${S.backend.online ? 'Node backend connected — numerical solvers available' : 'Backend not reachable — offline demo surrogate only'}"><span class="led"></span>Backend: <b>${S.backend.online ? 'CONNECTED' : 'OFFLINE'}</b></span>
      <span class="chip ${live ? '' : 'warn'}"><span class="led"></span><b>${live ? 'LIVE SCENARIO' : FS.t('demoMode')}</b></span>
      <span class="chip"><span class="led" style="background:var(--cyan)"></span>${FS.t('lastSim')}: <b>${S.lastRun ? S.lastRun.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</b></span>
      <span class="chip ${sevCls}"><span class="led"></span>${FS.t('severity')}: <b>${sev}</b></span>`;
    document.getElementById('langBtn').textContent = S.lang === 'en' ? 'हिन्दी' : 'English';
    document.getElementById('demoStrip').innerHTML = live
      ? `LIVE SCENARIO — computed by the backend's in-house SPH and 2D shallow-water solvers on SRTM-derived terrain with OpenStreetMap exposure data. Dam failure is a hypothetical scenario; breach parameters are empirical estimates. Validate with authoritative hydrological and field data before operational use.`
      : `SIMULATED DEMO DATA — offline Kosi demo computed by a browser-side parametric surrogate (no numerical solver). ${S.backend.online ? 'Backend is connected: use Scenario Builder → Live to run the real solvers on any Indian dam.' : 'Start the backend (npm run dev) to run the SPH and 2D SWE solvers on real open data.'}`;
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = FS.t(el.dataset.i18n)));
  }
  FS.app.renderStatus = renderStatus;

  let cleanup = null;
  function go(page) {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    if (page === 'landing') {
      document.getElementById('landing').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
      history.replaceState(null, '', '#');
      return;
    }
    if (!FS.views[page]) page = 'dashboard';
    history.replaceState(null, '', '#/' + page);
    document.getElementById('landing').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    S.page = page;
    renderNav();
    const view = document.getElementById('view');
    view.className = 'view'; view.onclick = null; view.innerHTML = ''; view.scrollTop = 0;
    try { cleanup = FS.views[page](view) || null; } catch (e) { console.error(e); view.innerHTML = `<div class="note">Failed to render page: ${FS.fmt.esc(e.message)}</div>`; }
    renderStatus();
  }
  FS.app.go = go;

  // ---------- modal / toast ----------
  function modal(title, html, onMount) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
    if (onMount) onMount(document.getElementById('modalBody'));
  }
  const closeModal = () => document.getElementById('modal').classList.add('hidden');
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3600);
  }
  Object.assign(FS.app, { modal, closeModal, toast });

  // ---------- global events ----------
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const id = a.dataset.id;
    if (a.dataset.act === 'evac') { S.evac.start = id; closeModal(); go('evac'); }
    if (a.dataset.act === 'alert') FS.views.alertModal(id);
    if (a.dataset.act === 'village') { S.selVillage = id; closeModal(); go('impact'); }
  });
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  document.getElementById('langBtn').onclick = () => { S.lang = S.lang === 'en' ? 'hi' : 'en'; save(); renderStatus(); renderNav(); go(S.page); };
  document.getElementById('landingLang').onclick = () => { S.lang = S.lang === 'en' ? 'hi' : 'en'; save(); renderStatus(); };
  document.getElementById('resetBtn').onclick = () => { if (confirm('Reset to the offline demonstration scenario and clear locally cached settings?')) FS.app.reset(); };
  const netChange = () => { S.netOnline = navigator.onLine; renderStatus(); toast(S.online ? 'Connection restored — ONLINE MODE' : 'Connection lost — OFFLINE / CACHED MODE'); if (S.page && !document.getElementById('app').classList.contains('hidden')) go(S.page); };
  window.addEventListener('online', netChange);
  window.addEventListener('offline', netChange);
  if (typeof Chart !== 'undefined') { Chart.defaults.color = '#8ea0b8'; Chart.defaults.borderColor = '#1d2c44'; Chart.defaults.font.family = 'Inter, Segoe UI, sans-serif'; Chart.defaults.font.size = 11; }

  // ---------- boot ----------
  (async function boot() {
    const cached = load();
    computeDemo();
    if (!S.lastRun) S.lastRun = new Date();
    S.runSource = 'Offline demo (browser surrogate)';
    renderStatus(); renderNav();
    const h = await API.health();
    S.backend = { online: !!h, health: h };
    S.builderMode = h ? 'live' : 'demo';
    if (h) {
      try {
        const list = await API.get('/api/scenarios');
        const want = (cached && cached.liveId && list.find((x) => x.id === cached.liveId)) || list[0];
        if (want) await FS.app.loadLive(want.id, true);
      } catch (e) { console.warn('Could not load stored scenarios', e); }
    }
    renderStatus();
    const hash = location.hash.replace(/^#\/?/, '');
    if (hash) go(hash);
  })();
})();
