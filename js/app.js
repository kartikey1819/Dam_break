/* FloodSim HADR — application state, simulation workflow, navigation. */
(function () {
  const E = FS.engine, D = FS.data;
  const CACHE_KEY = 'floodsim_hadr_cache_v1';

  // Backend adapter: when a real modelling backend exists, set FS.backend.url and implement the
  // POST contract below. Until then every run uses the browser-side parametric surrogate.
  FS.backend = {
    url: null, // e.g. 'https://floodsim.example.gov.in/api'
    connected: false,
    contract: 'POST {url}/models/{sph|delft3d}/run  body: scenario config → returns gridded max depth, arrival, velocity rasters (GeoTIFF/COG) + hydrographs',
    async run(cfg, model) { return E.runModel(cfg, model); }
  };

  const defaultCfg = () => Object.assign({ scenarioId: 'kosi-demo', type: 'Dam Break', preset: 'medium', peakDischarge: 0, duration: 360, terrain: 'DEM Demo Dataset', satellite: 'Demo Dataset', model: 'both' }, pick(D.presets.medium));
  function pick(p) { return { waterLevel: p.waterLevel, breachWidth: p.breachWidth, breachTime: p.breachTime, storage: p.storage }; }

  const S = (FS.state = {
    page: 'dashboard', lang: 'en', forceOffline: false, netOnline: navigator.onLine,
    cfg: defaultCfg(), res: null, ana: null, activeModel: 'delft3d', t: 180, lastRun: null, runSource: 'Preloaded demo scenario',
    weights: Object.assign({}, E.DEFAULT_WEIGHTS), roadThreshold: 0.3, t0: 15,
    running: false, step: -1, evac: { start: 'V04', dest: 'auto', mode: 'vehicle' }, selVillage: null,
    fromCache: false
  });
  Object.defineProperty(S, 'online', { get: () => S.netOnline && !S.forceOffline });

  FS.app = {};
  FS.app.cur = () => ({ res: S.res && S.res[S.activeModel], ana: S.ana && S.ana[S.activeModel] });
  FS.app.other = () => { const k = S.activeModel === 'sph' ? 'delft3d' : 'sph'; return { res: S.res[k], ana: S.ana[k] }; };
  FS.app.scenarioName = () => `Kosi Demo Dam — ${S.cfg.preset === 'custom' ? 'Custom' : D.presets[S.cfg.preset].label} (${S.cfg.type})`;
  FS.app.effectiveCfg = () => {
    const c = Object.assign({}, S.cfg);
    if (c.type === 'Sudden Water Release' && !(c.peakDischarge > 0)) c.peakDischarge = Math.round(E.peakDischarge(c) * 0.45);
    return c;
  };

  function computeAll() {
    const cfg = FS.app.effectiveCfg();
    S.res = { sph: E.runModel(cfg, 'sph'), delft3d: E.runModel(cfg, 'delft3d') };
    const o = { weights: S.weights, roadThreshold: S.roadThreshold, t0: S.t0 };
    S.ana = { sph: E.analyse(S.res.sph, o), delft3d: E.analyse(S.res.delft3d, o) };
  }
  FS.app.recomputeAnalysis = function () {
    const o = { weights: S.weights, roadThreshold: S.roadThreshold, t0: S.t0 };
    S.ana = { sph: E.analyse(S.res.sph, o), delft3d: E.analyse(S.res.delft3d, o) };
    save();
  };

  // ---------- simulation workflow ----------
  FS.app.STEPS = [
    ['Loading DEM', 'DEM Demo Dataset (synthetic) — SRTM/ASTER not connected'],
    ['Preparing hydrological inputs', 'River centreline, bed slope, reservoir storage'],
    ['Generating dam-break scenario', 'Breach hydrograph & peak discharge estimate'],
    ['Running SPH model', 'Surrogate with SPH calibration offsets — SPH backend NOT CONNECTED'],
    ['Running Delft3D model', 'Surrogate with Delft3D calibration offsets — Delft3D backend NOT CONNECTED'],
    ['Generating inundation map', 'Depth / extent rasters on 400 m grid'],
    ['Calculating impact statistics', 'Area, depth, velocity, hazard rating'],
    ['Generating village/infrastructure impact', 'Villages, panchayats, roads, bridges, facilities'],
    ['Calculating flood arrival-time zones', 'Arrival & duration classification'],
    ['Generating HADR priority analysis', 'Rule-based weighted scoring + evacuation routing'],
    ['Simulation complete', '']
  ];
  FS.app.runSimulation = function () {
    if (S.running) return;
    S.running = true; S.step = 0; S.stepTimes = [];
    S.activeModel = S.cfg.model === 'sph' ? 'sph' : 'delft3d';
    go('simulation');
    const t0 = performance.now();
    const tick = () => {
      const k = S.step;
      const st = performance.now();
      if (k === 4) computeAll(); // actual computation happens here (fast, surrogate)
      S.stepTimes[k] = performance.now() - st;
      S.step++;
      FS.views._simStep && FS.views._simStep();
      if (S.step < FS.app.STEPS.length - 1) setTimeout(tick, 260 + Math.random() * 260);
      else {
        S.step = FS.app.STEPS.length;
        S.running = false;
        S.lastRun = new Date();
        S.runSource = 'Browser surrogate run';
        S.runMs = performance.now() - t0;
        S.t = 0;
        save();
        renderStatus();
        FS.views._simStep && FS.views._simStep(true);
      }
    };
    setTimeout(tick, 300);
  };
  FS.app.applyPreset = function (key) {
    S.cfg.preset = key;
    if (D.presets[key]) Object.assign(S.cfg, pick(D.presets[key]));
    S.cfg.peakDischarge = 0;
  };
  FS.app.reset = function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    S.cfg = defaultCfg(); S.weights = Object.assign({}, E.DEFAULT_WEIGHTS); S.roadThreshold = 0.3; S.t0 = 15;
    S.activeModel = 'delft3d'; S.t = 180; S.lastRun = new Date(); S.runSource = 'Preloaded demo scenario'; S.whatIf = null; S.fromCache = false;
    S.evac = { start: 'V04', dest: 'auto', mode: 'vehicle' };
    computeAll(); save(); renderStatus(); go('dashboard');
    toast('Demo scenario reset');
  };

  // ---------- cache (low-connectivity support) ----------
  function save() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ cfg: S.cfg, weights: S.weights, lang: S.lang, lastRun: S.lastRun, roadThreshold: S.roadThreshold, t0: S.t0, forceOffline: S.forceOffline, savedAt: new Date() })); } catch (e) {}
  }
  FS.app.save = save;
  function load() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c) return;
      Object.assign(S.cfg, c.cfg); Object.assign(S.weights, c.weights);
      S.lang = c.lang || 'en'; S.roadThreshold = c.roadThreshold || 0.3; S.t0 = c.t0 ?? 15; S.forceOffline = !!c.forceOffline;
      S.lastRun = c.lastRun ? new Date(c.lastRun) : null; S.fromCache = true; S.cacheSavedAt = c.savedAt;
      S.runSource = 'Restored from local cache';
    } catch (e) {}
  }

  // ---------- UI shell ----------
  const NAV = [
    ['dashboard', '◉'], ['builder', '⚙'], ['simulation', '▶'], ['models', '⇄'], ['impact', '▦'], ['nrt', '◐'], ['evac', '➜'], ['priority', '⚑'], ['whatif', '≡'],
    ['sep'], ['export', '⤓'], ['data', '▤'], ['arch', '⌘'], ['settings', '☰']
  ];
  function renderNav() {
    document.getElementById('nav').innerHTML = NAV.map(([k, i]) => k === 'sep' ? '<div class="nav-sep"></div>' : `<button class="nav-item ${S.page === k ? 'active' : ''}" data-go="${k}"><span class="ni">${i}</span><span class="nl">${FS.t('nav_' + k)}</span></button>`).join('');
  }
  function renderStatus() {
    const K = S.ana && S.ana[S.activeModel].kpi;
    const sev = K ? K.severity : 'LOW';
    const sevCls = sev === 'SEVERE' ? 'bad' : sev === 'HIGH' || sev === 'MODERATE' ? 'warn' : '';
    document.getElementById('statusbar').innerHTML = `
      <span class="chip ${S.online ? '' : 'warn'}"><span class="led"></span><b>${S.online ? FS.t('online') : FS.t('offline')}</b></span>
      <span class="chip warn"><span class="led"></span><b>${FS.t('demoMode')}</b></span>
      <span class="chip warn" title="Real data sources connected: 0. Demo/synthetic datasets in use."><span class="led"></span>${FS.t('data')}: <b>DEMO · 0 live</b></span>
      <span class="chip"><span class="led" style="background:var(--cyan)"></span>${FS.t('lastSim')}: <b>${S.lastRun ? S.lastRun.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</b></span>
      <span class="chip ${sevCls}"><span class="led"></span>${FS.t('severity')}: <b>${sev}</b></span>`;
    document.getElementById('langBtn').textContent = S.lang === 'en' ? 'हिन्दी' : 'English';
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = FS.t(el.dataset.i18n)));
  }
  FS.app.renderStatus = renderStatus;

  let cleanup = null;
  function go(page) {
    if (page === 'landing') {
      if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
      document.getElementById('landing').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
      history.replaceState(null, '', '#');
      return;
    }
    if (!FS.views[page]) page = 'dashboard';
    history.replaceState(null, '', '#/' + page);
    document.getElementById('landing').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    S.page = page;
    renderNav();
    const view = document.getElementById('view');
    view.className = 'view';
    view.onclick = null;
    view.innerHTML = '';
    view.scrollTop = 0;
    const fn = FS.views[page] || FS.views.dashboard;
    cleanup = fn(view) || null;
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
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  FS.app.modal = modal; FS.app.closeModal = closeModal; FS.app.toast = toast;

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
  const toggleLang = () => { S.lang = S.lang === 'en' ? 'hi' : 'en'; save(); renderStatus(); renderNav(); if (!document.getElementById('app').classList.contains('hidden')) go(S.page); };
  document.getElementById('langBtn').onclick = toggleLang;
  document.getElementById('landingLang').onclick = () => { S.lang = S.lang === 'en' ? 'hi' : 'en'; save(); renderStatus(); };
  document.getElementById('resetBtn').onclick = () => { if (confirm('Reset the demonstration scenario and clear locally cached settings?')) FS.app.reset(); };
  const netChange = () => { S.netOnline = navigator.onLine; renderStatus(); toast(S.online ? 'Connection restored — ONLINE MODE' : 'Connection lost — OFFLINE / CACHED DEMO MODE'); if (S.page) go(S.page); };
  window.addEventListener('online', netChange);
  window.addEventListener('offline', netChange);

  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#8ea0b8';
    Chart.defaults.borderColor = '#1d2c44';
    Chart.defaults.font.family = 'Inter, Segoe UI, sans-serif';
    Chart.defaults.font.size = 11;
  }

  // ---------- boot ----------
  load();
  computeAll();
  if (!S.lastRun) S.lastRun = new Date();
  renderStatus();
  renderNav();
  const h = location.hash.replace(/^#\/?/, '');
  if (h) go(h);
})();
