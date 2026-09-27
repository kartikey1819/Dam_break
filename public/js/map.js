/* FloodSim HADR — map toolkit (Leaflet), scenario-generic. */
(function () {
  const A = FS.analysis;

  // ---------- formatting helpers ----------
  FS.fmt = {
    n: (v, d = 0) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })),
    min: (v) => (v == null || !isFinite(v) ? '—' : v < 60 ? `${Math.round(v)} min` : `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')} min`),
    m: (v) => (v == null || !(v > 0.05) ? '0.0 m' : `${v.toFixed(1)} m`),
    km: (v) => (v == null || !isFinite(v) ? '—' : `${v.toFixed(1)} km`),
    inr: (v) => (v == null ? '—' : v >= 1e7 ? `₹${(v / 1e7).toFixed(1)} Cr` : `₹${(v / 1e5).toFixed(1)} L`),
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  };
  const F = FS.fmt;

  // ---------- colour scales ----------
  const PAL = {
    depth: { labels: ['0–0.5 m', '0.5–1 m', '1–2 m', '2–5 m', '> 5 m'], colors: ['#7dd3fc', '#38bdf8', '#2563eb', '#f97316', '#dc2626'], title: 'Flood depth' },
    arrival: { labels: ['0–15 min', '15–30 min', '30–60 min', '60–120 min', '120+ min'], colors: ['#dc2626', '#f97316', '#f59e0b', '#facc15', '#a3e635'], title: 'Flood arrival time' },
    duration: { labels: ['< 1 h', '1–3 h', '3–6 h', '6–12 h', '> 12 h'], colors: ['#bae6fd', '#60a5fa', '#3b82f6', '#6366f1', '#8b5cf6'], title: 'Flood duration' },
    risk: { labels: ['Low (HR < 0.75)', 'Moderate (0.75–1.25)', 'Significant (1.25–2)', 'Extreme (> 2)'], colors: ['#22c55e', '#facc15', '#f97316', '#dc2626'], title: 'Hazard / risk zone' },
    diff: { labels: ['SPH lower > 1 m', 'SPH lower 0.25–1 m', '± 0.25 m', 'SPH higher 0.25–1 m', 'SPH higher > 1 m', 'Only one model wet'], colors: ['#2563eb', '#60a5fa', '#475569', '#fb923c', '#dc2626', '#e879f9'], title: 'SPH − Delft3D-class depth' }
  };
  const RISK_COL = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#22c55e', NONE: '#64748b' };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RGB = {}; Object.keys(PAL).forEach((k) => (RGB[k] = PAL[k].colors.map(hex)));

  const gridBounds = (g) => [[g.north - g.rows * g.dLat, g.west], [g.north, g.west + g.cols * g.dLng]];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  function img(g, fill) {
    canvas.width = g.cols; canvas.height = g.rows;
    const im = ctx.createImageData(g.cols, g.rows);
    fill(im.data);
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL();
  }
  // mode: depth | arrival | duration | risk ; t in minutes
  function renderRaster(scn, M, mode, t, alpha) {
    const g = scn.grid, a = Math.round((alpha ?? 0.78) * 255), ch = scn.channel;
    return img(g, (px) => {
      for (let i = 0; i < g.n; i++) {
        if (!(M.dmax[i] > 0.05) || !(M.arr[i] <= t) || (ch && ch[i] && mode !== 'depth')) continue;
        let c = -1;
        if (mode === 'depth') { const d = A.depthAt(M, i, t); if (d > 0.05) c = A.depthClass(d); }
        else if (mode === 'arrival') c = A.arrClass(M.arr[i]);
        else if (mode === 'duration') c = A.durClass(M.dur[i]);
        else if (mode === 'risk') c = A.hazClass(M.hz[i]);
        if (c < 0) continue;
        const col = RGB[mode][c], o = i * 4;
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = ch && ch[i] ? a * 0.6 : a;
      }
    });
  }
  // flood boundary (cells wet at time t with a dry 4-neighbour)
  function renderOutline(scn, M, t) {
    const g = scn.grid, wet = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) wet[i] = M.dmax[i] > 0.05 && M.arr[i] <= t ? 1 : 0;
    return img(g, (px) => {
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (!wet[i]) continue;
        if (r > 0 && r < g.rows - 1 && c > 0 && c < g.cols - 1 && wet[i - 1] && wet[i + 1] && wet[i - g.cols] && wet[i + g.cols]) continue;
        const o = i * 4; px[o] = 34; px[o + 1] = 211; px[o + 2] = 238; px[o + 3] = 230;
      }
    });
  }
  function renderDiff(scn, a, b) {
    const g = scn.grid;
    return img(g, (px) => {
      for (let i = 0; i < g.n; i++) {
        const wa = a.dmax[i] > 0.05, wb = b.dmax[i] > 0.05;
        if ((!wa && !wb) || (scn.channel && scn.channel[i])) continue;
        let c;
        if (wa !== wb) c = 5;
        else { const d = a.dmax[i] - b.dmax[i]; c = d < -1 ? 0 : d < -0.25 ? 1 : d <= 0.25 ? 2 : d <= 1 ? 3 : 4; }
        const col = RGB.diff[c], o = i * 4;
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 200;
      }
    });
  }
  function renderCats(scn, fn) {
    const g = scn.grid;
    return img(g, (px) => { for (let i = 0; i < g.n; i++) { const c = fn(i); if (c) px.set(c, i * 4); } });
  }
  const hillCache = new WeakMap();
  function renderHillshade(scn) {
    if (!scn.dem) return null;
    if (hillCache.has(scn)) return hillCache.get(scn);
    const g = scn.grid, Z = scn.dem;
    let zmin = 1e9, zmax = -1e9;
    for (let i = 0; i < g.n; i++) { if (Z[i] < zmin) zmin = Z[i]; if (Z[i] > zmax) zmax = Z[i]; }
    const k = 1 / Math.max(1, g.dx || 400);
    const url = img(g, (px) => {
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        const dzx = (Z[r * g.cols + Math.min(g.cols - 1, c + 1)] - Z[r * g.cols + Math.max(0, c - 1)]) * k / 2;
        const dzy = (Z[Math.min(g.rows - 1, r + 1) * g.cols + c] - Z[Math.max(0, r - 1) * g.cols + c]) * k / 2;
        const shade = Math.max(0, Math.min(1, 0.55 + (-dzx + dzy) * 6));
        const h = (Z[i] - zmin) / (zmax - zmin || 1);
        const f = 0.6 + shade * 0.7, o = i * 4;
        px[o] = (22 + 60 * h) * f; px[o + 1] = (36 + 62 * h) * f; px[o + 2] = (44 + 40 * h) * f; px[o + 3] = 235;
      }
    });
    const out = { url, zmin, zmax };
    hillCache.set(scn, out);
    return out;
  }

  // ---------- basemaps ----------
  const BASEMAPS = {
    dark: { name: 'Dark canvas (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxNative: 16 },
    satellite: { name: 'Satellite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    terrain: { name: 'Terrain (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, USGS, © OpenStreetMap contributors' },
    streets: { name: 'Streets (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
    offline: { name: 'Offline (scenario DEM hillshade)', url: null, attr: 'Scenario DEM' }
  };

  // ---------- geometry ----------
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function groupPolys(scn) {
    if (scn._gp) return scn._gp;
    const F2 = scn.features, cos = Math.cos((scn.grid.north * Math.PI) / 180);
    const polys = F2.groups.map((p) => {
      const pts = [];
      F2.villages.filter((v) => v.group === p.id).forEach((v) => { for (let a = 0; a < 12; a++) pts.push([v.lat + 0.018 * Math.sin((a / 12) * 2 * Math.PI), v.lng + (0.018 / cos) * Math.cos((a / 12) * 2 * Math.PI)]); });
      return { gp: p, ring: pts.length ? hull(pts) : [] };
    });
    Object.defineProperty(scn, '_gp', { value: polys, enumerable: false, writable: true });
    return polys;
  }

  const INFRA_STYLE = { school: ['S', '#fde047'], health: ['H', '#f87171'], public: ['P', '#c4b5fd'], emergency: ['E', '#fb923c'], police: ['P', '#93c5fd'], fire: ['F', '#fb923c'], shelter: ['R', '#86efac'], utility: ['U', '#93c5fd'] };
  const INFRA_NAME = { school: 'School / college', health: 'Hospital / PHC / clinic', public: 'Public building', emergency: 'Emergency facility', police: 'Police station', fire: 'Fire station', shelter: 'Shelter / assembly point', utility: 'Utility / other critical' };

  // ---------- popups ----------
  const tagFor = (scn) => (scn.mode === 'live' ? 'SIMULATED — open data inputs' : 'SIMULATED DEMO DATA');
  const foot = (scn) => `<div class="pop-foot">${tagFor(scn)} — prototype decision-support output</div>`;
  function villagePopup(scn, v) {
    const gp = scn.features.groups.find((p) => p.id === v.group) || { name: '—', kind: '' };
    const sz = scn.features.safeZones.find((z) => z.id === v.safeZone);
    return `<div class="pop-h">${F.esc(v.name)} ${v.popSource === 'DEMO' ? '<span class="tag tag-demo">DEMO</span>' : '<span class="tag tag-real">OSM</span>'}</div>
      <div class="pop-sub">${F.esc(gp.name)} · ${F.esc(gp.kind || '')}</div>
      <div class="pop-grid">
        <span>Flood depth</span><span>${F.m(v.depth)}</span>
        <span>Arrival time</span><span>${v.affected ? 'T+' + F.min(v.arrival) : 'Not reached'}</span>
        <span>Flood duration</span><span>${v.affected ? F.min(v.duration) : '—'}</span>
        <span>Population</span><span>${F.n(v.pop)} <span class="dim">(${v.popSource === 'OSM' ? 'OSM tag' : v.popSource === 'DEMO' ? 'demo' : 'estimate'})</span></span>
        <span>Risk</span><span><span class="risk risk-${v.risk}">${v.risk}</span></span>
        <span>HADR priority</span><span><span class="risk risk-${v.priority}">${v.priority}</span> ${v.affected ? F.n(v.score) : ''}</span>
        <span>From river / dam</span><span>${F.km(v.distRiver)} / ${F.km(v.distDam)}</span>
        <span>Evacuation zone</span><span>${sz ? F.esc(sz.id) : v.affected ? 'No safe route' : '—'}</span>
      </div>
      <div class="pop-actions"><button class="btn btn-sm" data-act="evac" data-id="${v.id}">Plan evacuation</button><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>${foot(scn)}`;
  }
  const infraPopup = (scn, f) => `<div class="pop-h">${F.esc(f.name)}</div><div class="pop-sub">${INFRA_NAME[f.type] || f.type} · ${scn.mode === 'live' ? 'OpenStreetMap' : 'synthetic asset'}</div>
      <div class="pop-grid"><span>Flood depth</span><span>${F.m(f.depth)}</span><span>Arrival</span><span>${f.depth > 0.05 ? 'T+' + F.min(f.arrival) : '—'}</span>
      <span>Risk</span><span><span class="risk risk-${f.risk}">${f.risk}</span></span><span>From river</span><span>${F.km(f.distRiver)}</span></div>${foot(scn)}`;
  const roadPopup = (scn, e, ev) => `<div class="pop-h">${F.esc(e.name)}</div><div class="pop-sub">${e.cls} road · ${F.km(e.len)} · ${scn.mode === 'live' ? 'OpenStreetMap' : 'synthetic network'}</div>
      <div class="pop-grid"><span>Status</span><span><span class="risk risk-${ev.status.replace(' ', '.')}">${ev.status}</span></span>
      <span>Max water depth</span><span>${F.m(ev.maxDepth)}</span><span>Impassable from</span><span>${isFinite(ev.blockTime) ? 'T+' + F.min(ev.blockTime) : '—'}</span></div>${foot(scn)}`;
  const bridgePopup = (scn, b, ev) => `<div class="pop-h">${F.esc(b.name)}</div><div class="pop-sub">${b.crossing ? 'River crossing' : 'Bridge / culvert'} · assumed deck clearance ${A.BRIDGE_CLEARANCE} m</div>
      <div class="pop-grid"><span>Status</span><span><span class="risk risk-${b.risk}">${F.esc(b.status)}</span></span>
      ${ev && ev.stage != null ? `<span>Peak rise at crossing</span><span>${ev.stage.toFixed(1)} m</span>` : `<span>Max water depth</span><span>${F.m(b.depth)}</span>`}
      <span>Impassable from</span><span>${ev && isFinite(ev.blockTime) ? 'T+' + F.min(ev.blockTime) : '—'}</span></div>${foot(scn)}`;
  const gpPopup = (scn, g) => `<div class="pop-h">${F.esc(g.name)}</div><div class="pop-sub">${F.esc(g.kind || '')}</div>
      <div class="pop-grid"><span>Affected villages</span><span>${g.affectedVillages} / ${g.villages.length}</span><span>Population</span><span>${F.n(g.population)}</span>
      <span>Flooded area</span><span>${F.n(g.area, 1)} km²</span><span>Schools / health</span><span>${g.schools} / ${g.health}</span><span>Roads / bridges</span><span>${g.roads} / ${g.bridges}</span>
      <span>Risk</span><span><span class="risk risk-${g.risk}">${g.risk}</span></span></div>${foot(scn)}`;

  // ---------- layer registry ----------
  const LAYER_DEFS = [
    ['Hydrology', [['river', 'River'], ['dam', 'Dam'], ['arrows', 'Water-flow direction'], ['extent', 'Flood inundation boundary']]],
    ['Flood raster', [['r_depth', 'Flood depth'], ['r_arrival', 'Flood arrival-time zones'], ['r_duration', 'Flood duration'], ['r_risk', 'Risk zones']]],
    ['Terrain & imagery', [['dem', 'DEM / elevation (hillshade)'], ['satellite', 'Satellite imagery']]],
    ['Settlements', [['villages', 'Villages'], ['panchayats', 'Panchayats / groups'], ['labels', 'Village labels']]],
    ['Infrastructure', [['roads', 'Roads'], ['bridges', 'Bridges'], ['infra', 'Critical infrastructure']]],
    ['Response', [['routes', 'Evacuation routes'], ['safe', 'Safe zones']]]
  ];
  const DEFAULT_LAYERS = { river: true, dam: true, arrows: true, extent: true, dem: false, satellite: false, villages: true, panchayats: false, labels: true, roads: true, bridges: true, infra: true, routes: false, safe: true };
  const RMODE = { depth: 'depth', arrival: 'arrival', duration: 'duration', risk: 'risk', infra: 'depth', evac: 'depth' };

  class MapView {
    constructor(wrap, opts) {
      this.opts = Object.assign({ tools: true, modes: true, legend: true, layers: Object.assign({}, DEFAULT_LAYERS), mode: 'depth', basemap: 'dark' }, opts || {});
      this.wrap = wrap; this.layers = this.opts.layers; this.mode = this.opts.mode;
      const el = document.createElement('div'); el.className = 'lmap'; wrap.appendChild(el);
      this.map = L.map(el, { preferCanvas: true, zoomControl: true, zoomSnap: 0.25 });
      this.map.setView([22.5, 80], 5);
      [['floodPane', 390], ['demPane', 250], ['satPane', 260], ['outlinePane', 395]].forEach(([p, z]) => (this.map.createPane(p).style.zIndex = z));
      this.g = {};
      ['dem', 'satellite', 'flood', 'extent', 'panchayats', 'roads', 'routes', 'river', 'arrows', 'bridges', 'infra', 'safe', 'villages', 'dam', 'focus', 'measure'].forEach((k) => (this.g[k] = L.layerGroup()));
      this.setBasemap(this.opts.basemap);
      this.g.satellite.addLayer(L.tileLayer(BASEMAPS.satellite.url, { pane: 'satPane', opacity: 0.75, attribution: BASEMAPS.satellite.attr }));
      Object.values(this.g).forEach((g) => g.addTo(this.map));
      if (this.opts.tools) this.buildTools();
      if (this.opts.legend) { this.legendEl = document.createElement('div'); this.legendEl.className = 'map-ctl legend'; wrap.appendChild(this.legendEl); }
      if (this.opts.modes) this.buildModeBar();
      this.applyVisibility();
    }
    fit() {
      if (!this.scn || this.dead) return;
      const pts = this.scn.river && this.scn.river.length ? this.scn.river : [[this.scn.dam.lat, this.scn.dam.lng]];
      this.map.invalidateSize();
      this.map.fitBounds(L.latLngBounds(pts).pad(0.12), { animate: false });
    }
    setBasemap(key) {
      this.basemap = key;
      if (this.base) this.map.removeLayer(this.base);
      this.base = null;
      const b = BASEMAPS[key];
      if (b.url) this.base = L.tileLayer(b.url, { attribution: b.attr, maxZoom: 18, maxNativeZoom: b.maxNative || 18 }).addTo(this.map);
      if (key === 'offline') this.layers.dem = true;
      if (this.g) this.applyVisibility();
      if (this.panel) this.renderPanel();
    }
    setScenario(scn) {
      if (this.scn === scn) return;
      this.scn = scn;
      ['dem', 'river', 'dam', 'safe'].forEach((k) => this.g[k].clearLayers());
      const hs = renderHillshade(scn);
      if (hs) L.imageOverlay(hs.url, gridBounds(scn.grid), { pane: 'demPane', opacity: 0.9, className: 'flood-img' }).addTo(this.g.dem);
      L.polyline(scn.river, { color: '#0ea5e9', weight: 9, opacity: 0.3 }).addTo(this.g.river);
      L.polyline(scn.river, { color: '#67e8f9', weight: 3, opacity: 0.95 }).bindTooltip(`${F.esc(scn.dam.river || 'River')} — ${F.esc(scn.riverSource || '')}`, { sticky: true }).addTo(this.g.river);
      const d = scn.dam;
      L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', html: '<div class="dam-icon">D</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000 })
        .bindPopup(`<div class="pop-h">${F.esc(d.name)}</div><div class="pop-sub">${F.esc([d.river, d.state].filter(Boolean).join(' · '))}</div><div class="pop-grid">
          <span>Height</span><span>${d.heightM != null ? d.heightM + ' m' : '—'}</span><span>Storage used</span><span>${F.n(scn.config.storage)} MCM</span>
          <span>Source</span><span>${F.esc(d.source || (scn.mode === 'demo' ? 'Hypothetical (demo)' : '—'))}</span></div>${d.note ? `<div class="pop-foot">${F.esc(d.note)}</div>` : ''}`).addTo(this.g.dam);
      scn.features.safeZones.forEach((z) => {
        L.marker([z.lat, z.lng], { icon: L.divIcon({ className: '', html: `<div class="sz-icon">${F.esc(String(z.id).replace(/^SZ/, ''))}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindPopup(`<div class="pop-h">${F.esc(z.name)}</div><div class="pop-sub">Candidate safe location</div><div class="pop-grid"><span>Capacity</span><span>${z.capacity ? F.n(z.capacity) : 'unknown'}</span>${z.elevAbove != null ? `<span>Height above peak flood level</span><span>${z.elevAbove.toFixed(1)} m</span>` : ''}</div><div class="pop-foot">${F.esc(z.note || 'Not an officially notified relief camp.')}</div>`).addTo(this.g.safe);
      });
      setTimeout(() => this.fit(), 30);
    }
    // data = {scn, M, ana, t}
    update(data) {
      this.data = data;
      const { scn, M, ana, t } = data;
      if (!scn) return;
      this.setScenario(scn);
      const rmode = RMODE[this.mode];
      this.g.flood.clearLayers(); this.g.extent.clearLayers(); this.g.arrows.clearLayers();
      if (M && this.mode !== 'none') L.imageOverlay(renderRaster(scn, M, rmode, t, this.mode === 'infra' || this.mode === 'evac' ? 0.45 : 0.78), gridBounds(scn.grid), { pane: 'floodPane', className: 'flood-img', interactive: false }).addTo(this.g.flood);
      if (M) L.imageOverlay(renderOutline(scn, M, t), gridBounds(scn.grid), { pane: 'outlinePane', className: 'px-img', interactive: false }).addTo(this.g.extent);
      if (M) this.drawArrows(scn, M, t);
      if (!ana) return this.applyVisibility();
      const F2 = scn.features;
      // roads
      this.g.roads.clearLayers();
      F2.roads.edges.forEach((e) => {
        if (e.crossing) return;
        const ev = ana.roadEval[e.id];
        if (e.cls === 'village' && !ev.blocked && !ev.risky && F2.roads.edges.length > 400) return;
        const now = isFinite(ev.blockTime) && ev.blockTime <= t;
        const col = ev.blocked ? (now ? '#ef4444' : '#f97316') : ev.risky ? '#f59e0b' : '#94a3b8';
        const w = /motorway|trunk|primary|state/.test(e.cls) ? 3 : e.cls === 'village' ? 1.4 : 2.2;
        L.polyline(e.geom, { color: col, weight: w, opacity: ev.blocked || ev.risky ? 0.95 : 0.5, dashArray: e.cls === 'village' ? '3 4' : null }).bindPopup(() => roadPopup(scn, e, ev)).addTo(this.g.roads);
      });
      // bridges
      this.g.bridges.clearLayers();
      ana.bridges.forEach((b) => {
        const ev = ana.roadEval[b.edge];
        const e = F2.roads.edges.find((x) => x.id === b.edge);
        if (b.crossing && e) L.polyline(e.geom, { color: RISK_COL[b.risk], weight: 4 }).bindPopup(() => bridgePopup(scn, b, ev)).addTo(this.g.bridges);
        L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', html: `<div class="infra-icon" style="background:${RISK_COL[b.risk]}">B</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).bindPopup(() => bridgePopup(scn, b, ev)).addTo(this.g.bridges);
      });
      // infra
      this.g.infra.clearLayers();
      ana.infra.forEach((f) => {
        const [ch, col] = INFRA_STYLE[f.type] || ['•', '#e2e8f0'];
        const ring = f.risk !== 'NONE' ? `box-shadow:0 0 0 2px ${RISK_COL[f.risk]}` : 'opacity:.85';
        L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: `<div class="infra-icon" style="background:${col};${ring}">${ch}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).bindPopup(() => infraPopup(scn, f)).addTo(this.g.infra);
      });
      // groups
      this.g.panchayats.clearLayers();
      groupPolys(scn).forEach((p) => {
        if (p.ring.length < 3) return;
        const g = ana.panchayats.find((x) => x.id === p.gp.id);
        L.polygon(p.ring, { color: '#c4b5fd', weight: 1.2, dashArray: '6 4', fillColor: RISK_COL[g.risk], fillOpacity: 0.07 }).bindTooltip(F.esc(p.gp.name), { sticky: true }).bindPopup(() => gpPopup(scn, g)).addTo(this.g.panchayats);
      });
      // routes
      this.g.routes.clearLayers();
      ana.villages.forEach((v) => { const r = v.evac.recommended; if (v.affected && r) L.polyline(r.coords, { color: '#22c55e', weight: 3, opacity: 0.85 }).bindTooltip(`Evacuation: ${F.esc(v.name)} → ${F.esc(v.safeZone)} (simulated)`, { sticky: true }).addTo(this.g.routes); });
      // villages
      this.g.villages.clearLayers();
      const many = ana.villages.length > 60;
      ana.villages.forEach((v) => {
        const reached = v.affected && v.arrival <= t;
        const m = L.circleMarker([v.lat, v.lng], { radius: Math.min(14, 4 + Math.sqrt(v.pop || 100) / 14), color: '#0b1424', weight: 1.5, fillColor: v.affected ? RISK_COL[v.risk] : '#64748b', fillOpacity: reached ? 0.95 : 0.55 }).bindPopup(() => villagePopup(scn, v), { maxWidth: 320 });
        if (this.layers.labels && (!many || v.affected)) m.bindTooltip(F.esc(v.name), { permanent: true, direction: 'right', offset: [7, 0], className: 'vlabel' });
        m.addTo(this.g.villages);
      });
      this.applyVisibility();
      if (this.legendEl) this.renderLegend();
    }
    drawArrows(scn, M, t) {
      const pts = A.densify(scn.river, 0.5);
      let acc = 0, next = 2;
      for (let k = 1; k < pts.length - 1; k++) {
        acc += A.distKm(pts[k - 1], pts[k]);
        if (acc < next) continue;
        next += 4;
        const i = A.cellIndex(scn.grid, pts[k][0], pts[k][1]);
        if (i < 0 || !(M.arr[i] <= t)) continue;
        const a = pts[Math.max(0, k - 2)], b = pts[Math.min(pts.length - 1, k + 2)];
        const cos = Math.cos((a[0] * Math.PI) / 180), ang = (-Math.atan2(b[0] - a[0], (b[1] - a[1]) * cos) * 180) / Math.PI;
        L.marker(pts[k], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="arrow-icon" style="transform:rotate(${ang}deg)">➤</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(this.g.arrows);
      }
    }
    focusRoute(plan, villages) {
      this.g.focus.clearLayers();
      if (!plan) return;
      if (plan.naive) L.polyline(plan.naive.coords, { color: '#ef4444', weight: 5, opacity: 0.9, dashArray: '8 6' }).bindTooltip('UNSAFE: shortest path ignoring flood', { sticky: true }).addTo(this.g.focus);
      if (plan.alternative) L.polyline(plan.alternative.coords, { color: '#facc15', weight: 4, opacity: 0.9, dashArray: '2 6' }).bindTooltip('Alternative route (simulated)', { sticky: true }).addTo(this.g.focus);
      if (plan.recommended) {
        L.polyline(plan.recommended.coords, { color: '#052e16', weight: 9, opacity: 0.7 }).addTo(this.g.focus);
        L.polyline(plan.recommended.coords, { color: '#22c55e', weight: 5 }).bindTooltip('Recommended route (simulated)', { sticky: true }).addTo(this.g.focus);
        plan.recommended.blocked.concat(plan.recommended.risky).forEach((e) => L.polyline(e.geom, { color: '#f59e0b', weight: 7, opacity: 0.5 }).addTo(this.g.focus));
      }
      const v = villages.find((x) => x.id === plan.villageId);
      if (v) L.circleMarker([v.lat, v.lng], { radius: 11, color: '#ef4444', weight: 3, fillColor: '#ef4444', fillOpacity: 0.5 }).addTo(this.g.focus);
      const z = this.scn.features.safeZones.find((x) => x.id === plan.dest);
      if (z) L.circleMarker([z.lat, z.lng], { radius: 14, color: '#22c55e', weight: 3, fillOpacity: 0.2 }).addTo(this.g.focus);
      const b = plan.recommended ? plan.recommended.coords : v ? [[v.lat, v.lng]] : null;
      if (b && !this.dead) { if (b.length > 1) this.map.fitBounds(L.latLngBounds(b).pad(0.3), { animate: false }); else this.map.setView(b[0], 12, { animate: false }); }
    }
    setMode(m) {
      this.mode = m;
      if (m === 'infra') Object.assign(this.layers, { roads: true, bridges: true, infra: true });
      if (m === 'evac') Object.assign(this.layers, { routes: true, safe: true });
      if (this.data) this.update(this.data);
      if (this.modeBar) this.modeBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      if (this.panel) this.renderPanel();
    }
    applyVisibility() {
      Object.keys(this.g).forEach((k) => {
        if (k === 'flood' || k === 'focus' || k === 'measure') return;
        const on = !!this.layers[k];
        if (on && !this.map.hasLayer(this.g[k])) this.g[k].addTo(this.map);
        if (!on && this.map.hasLayer(this.g[k])) this.map.removeLayer(this.g[k]);
      });
    }
    renderLegend() {
      const P = PAL[RMODE[this.mode]];
      let h = '';
      if (P) h += `<div class="legend-t">${P.title}</div>` + P.labels.map((l, i) => `<div class="legend-row"><i style="background:${P.colors[i]}"></i>${l}</div>`).join('');
      if (this.layers.villages) h += `<div class="legend-t" style="margin-top:6px">Settlement risk</div>` + ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'].map((r) => `<div class="legend-row"><i style="background:${RISK_COL[r]};border-radius:50%;width:10px"></i>${r === 'NONE' ? 'Not affected' : r}</div>`).join('');
      if (this.mode === 'evac') h += `<div class="legend-row"><i style="background:#22c55e;height:4px"></i>Recommended route</div><div class="legend-row"><i style="background:#ef4444;height:4px"></i>Flooded / unsafe road</div>`;
      if (this.mode === 'infra') h += `<div class="legend-row"><i style="background:#ef4444;height:4px"></i>Road flooded now</div><div class="legend-row"><i style="background:#f97316;height:4px"></i>Road floods later</div><div class="legend-row"><i style="background:#f59e0b;height:4px"></i>Shallow water (caution)</div>`;
      h += `<div class="legend-demo">${this.scn ? tagFor(this.scn) : ''}</div>`;
      this.legendEl.innerHTML = h;
    }
    buildModeBar() {
      const d = document.createElement('div');
      d.className = 'map-ctl mode-bar';
      d.innerHTML = `<div class="seg">${[['depth', 'Flood Depth'], ['arrival', 'Arrival Time'], ['duration', 'Flood Duration'], ['risk', 'Risk'], ['infra', 'Affected Infrastructure'], ['evac', 'Evacuation Routes']].map(([k, l]) => `<button data-m="${k}" class="${k === this.mode ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      d.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.setMode(b.dataset.m); });
      L.DomEvent.disableClickPropagation(d);
      this.wrap.appendChild(d);
      this.modeBar = d;
    }
    buildTools() {
      const t = document.createElement('div');
      t.className = 'map-ctl map-tools';
      t.innerHTML = `<div class="row" style="gap:6px"><button class="tool-btn" data-t="layers">Layers ▾</button><button class="tool-btn" data-t="measure" title="Measure distance">Measure</button><button class="tool-btn" data-t="fs" title="Full screen">⛶</button></div><div class="layer-panel hidden"></div>`;
      this.wrap.appendChild(t);
      L.DomEvent.disableClickPropagation(t); L.DomEvent.disableScrollPropagation(t);
      this.panel = t.querySelector('.layer-panel');
      this.renderPanel();
      t.addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]'); if (!b) return;
        if (b.dataset.t === 'layers') { this.panel.classList.toggle('hidden'); b.classList.toggle('on'); }
        if (b.dataset.t === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else this.wrap.requestFullscreen && this.wrap.requestFullscreen(); }
        if (b.dataset.t === 'measure') this.toggleMeasure(b);
      });
      this._fs = () => setTimeout(() => !this.dead && this.map.invalidateSize(), 150);
      document.addEventListener('fullscreenchange', this._fs);
      this.panel.addEventListener('change', (e) => {
        const i = e.target;
        if (i.name === 'basemap') return this.setBasemap(i.value);
        if (i.name === 'raster') return this.setMode(i.value);
        this.layers[i.dataset.k] = i.checked;
        if (i.dataset.k === 'labels' && this.data) this.update(this.data);
        this.applyVisibility();
      });
    }
    renderPanel() {
      const rm = 'r_' + (RMODE[this.mode] || 'none');
      let h = `<h4>Basemap</h4><select name="basemap">${Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}" ${k === this.basemap ? 'selected' : ''}>${b.name}</option>`).join('')}</select>`;
      LAYER_DEFS.forEach(([grp, items]) => {
        h += `<h4>${grp}</h4>`;
        items.forEach(([k, l]) => { h += k.startsWith('r_') ? `<label><input type="radio" name="raster" value="${k.slice(2)}" ${rm === k ? 'checked' : ''}/> ${l}</label>` : `<label><input type="checkbox" data-k="${k}" ${this.layers[k] ? 'checked' : ''}/> ${l}</label>`; });
        if (grp === 'Flood raster') h += `<label><input type="radio" name="raster" value="none" ${this.mode === 'none' ? 'checked' : ''}/> None</label>`;
      });
      this.panel.innerHTML = h;
    }
    toggleMeasure(btn) {
      if (this.measuring) {
        this.measuring = false; btn.classList.remove('on');
        this.map.off('click', this._mclick); this.g.measure.clearLayers();
        if (this.mOut) this.mOut.remove();
        this.map.getContainer().style.cursor = '';
        return;
      }
      this.measuring = true; btn.classList.add('on');
      this.map.getContainer().style.cursor = 'crosshair';
      const pts = [];
      this.mOut = document.createElement('div'); this.mOut.className = 'map-ctl measure-out';
      this.mOut.textContent = 'Click on map to measure distance';
      this.wrap.appendChild(this.mOut);
      this._mclick = (e) => {
        pts.push(e.latlng);
        this.g.measure.clearLayers();
        L.polyline(pts, { color: '#22d3ee', weight: 2, dashArray: '4 4' }).addTo(this.g.measure);
        pts.forEach((p) => L.circleMarker(p, { radius: 3, color: '#22d3ee' }).addTo(this.g.measure));
        let d = 0; for (let i = 1; i < pts.length; i++) d += this.map.distance(pts[i - 1], pts[i]);
        this.mOut.textContent = `Distance: ${(d / 1000).toFixed(2)} km · ${pts.length} pts (click Measure to clear)`;
      };
      this.map.on('click', this._mclick);
    }
    destroy() { this.dead = true; if (this._fs) document.removeEventListener('fullscreenchange', this._fs); try { this.map.stop(); this.map.off(); this.map.remove(); } catch (e) {} }
  }

  FS.mapkit = { MapView, PAL, RISK_COL, BASEMAPS, renderRaster, renderDiff, renderCats, renderHillshade, gridBounds, INFRA_NAME, INFRA_STYLE, villagePopup };
})();
