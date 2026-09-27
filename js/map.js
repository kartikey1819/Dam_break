/* FloodSim HADR — map toolkit (Leaflet). */
(function () {
  const E = FS.engine, G = E.G, D = FS.data;

  // ---------- formatting helpers ----------
  FS.fmt = {
    n: (v, d = 0) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })),
    min: (v) => (v == null || !isFinite(v) ? '—' : v < 60 ? `${Math.round(v)} min` : `${Math.floor(v / 60)} h ${String(Math.round(v % 60)).padStart(2, '0')} min`),
    m: (v) => (v == null || !(v > 0.05) ? '0.0 m' : `${v.toFixed(1)} m`),
    km: (v) => (v == null ? '—' : `${v.toFixed(1)} km`),
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  };
  const F = FS.fmt;

  // ---------- colour scales ----------
  const PAL = {
    depth: { labels: ['0–0.5 m', '0.5–1 m', '1–2 m', '2–5 m', '> 5 m'], colors: ['#7dd3fc', '#38bdf8', '#2563eb', '#f97316', '#dc2626'], title: 'Flood depth' },
    arrival: { labels: ['0–15 min', '15–30 min', '30–60 min', '60–120 min', '120+ min'], colors: ['#dc2626', '#f97316', '#f59e0b', '#facc15', '#a3e635'], title: 'Flood arrival time' },
    duration: { labels: ['< 1 h', '1–3 h', '3–6 h', '6–12 h', '> 12 h'], colors: ['#bae6fd', '#60a5fa', '#3b82f6', '#6366f1', '#8b5cf6'], title: 'Flood duration' },
    risk: { labels: ['Low (HR < 0.75)', 'Moderate (0.75–1.25)', 'Significant (1.25–2)', 'Extreme (> 2)'], colors: ['#22c55e', '#facc15', '#f97316', '#dc2626'], title: 'Hazard / risk zone' },
    diff: { labels: ['SPH lower > 1 m', 'SPH lower 0.25–1 m', '± 0.25 m', 'SPH higher 0.25–1 m', 'SPH higher > 1 m', 'Only one model wet'], colors: ['#2563eb', '#60a5fa', '#475569', '#fb923c', '#dc2626', '#e879f9'], title: 'SPH − Delft3D depth' }
  };
  const RISK_COL = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#22c55e', NONE: '#64748b' };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RGB = {}; Object.keys(PAL).forEach((k) => (RGB[k] = PAL[k].colors.map(hex)));

  const gridBounds = () => [[G.north - G.rows * G.dLat, G.west], [G.north, G.west + G.cols * G.dLng]];
  const canvas = document.createElement('canvas');
  canvas.width = G.cols; canvas.height = G.rows;
  const ctx = canvas.getContext('2d');

  // mode: depth | arrival | duration | risk ; t in minutes
  function renderRaster(res, mode, t, alpha) {
    const img = ctx.createImageData(G.cols, G.rows), px = img.data;
    const A = Math.round((alpha ?? 0.78) * 255);
    for (let i = 0; i < G.n; i++) {
      if (!(res.dmax[i] > 0.05) || !(res.arr[i] <= t)) continue;
      let c = -1;
      if (mode === 'depth') { const d = E.depthAt(res, i, t); if (d > 0.05) c = E.depthClass(d); }
      else if (mode === 'arrival') c = E.arrClass(res.arr[i]);
      else if (mode === 'duration') c = E.durClass(res.dur[i]);
      else if (mode === 'risk') c = E.hazClass(res.hz[i]);
      if (c < 0) continue;
      const col = RGB[mode][c], o = i * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = A;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
  function renderDiff(a, b) {
    const img = ctx.createImageData(G.cols, G.rows), px = img.data;
    for (let i = 0; i < G.n; i++) {
      const wa = a.dmax[i] > 0.05, wb = b.dmax[i] > 0.05;
      if (!wa && !wb) continue;
      let c;
      if (wa !== wb) c = 5;
      else { const d = a.dmax[i] - b.dmax[i]; c = d < -1 ? 0 : d < -0.25 ? 1 : d <= 0.25 ? 2 : d <= 1 ? 3 : 4; }
      const col = RGB.diff[c], o = i * 4;
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 200;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
  function renderMask(mask, color, alpha) {
    const img = ctx.createImageData(G.cols, G.rows), px = img.data, col = hex(color), A = Math.round(alpha * 255);
    for (let i = 0; i < G.n; i++) if (mask[i]) { const o = i * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = A; }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
  let hillCache = null;
  function renderHillshade() {
    if (hillCache) return hillCache;
    const img = ctx.createImageData(G.cols, G.rows), px = img.data;
    let zmin = 1e9, zmax = -1e9;
    for (let i = 0; i < G.n; i++) { zmin = Math.min(zmin, G.Z[i]); zmax = Math.max(zmax, G.Z[i]); }
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      const i = r * G.cols + c;
      const zl = G.Z[r * G.cols + Math.max(0, c - 1)], zr = G.Z[r * G.cols + Math.min(G.cols - 1, c + 1)];
      const zu = G.Z[Math.max(0, r - 1) * G.cols + c], zd = G.Z[Math.min(G.rows - 1, r + 1) * G.cols + c];
      const dx = (zr - zl) / 800, dy = (zd - zu) / 800;
      const shade = Math.max(0, Math.min(1, 0.55 + (-dx * 0.7 + dy * 0.7) * 90));
      const h = (G.Z[i] - zmin) / (zmax - zmin);
      const base = [22 + 60 * h, 36 + 62 * h, 44 + 40 * h];
      const o = i * 4;
      px[o] = base[0] * (0.6 + shade * 0.7); px[o + 1] = base[1] * (0.6 + shade * 0.7); px[o + 2] = base[2] * (0.6 + shade * 0.7); px[o + 3] = 235;
    }
    ctx.putImageData(img, 0, 0);
    hillCache = { url: canvas.toDataURL(), zmin, zmax };
    return hillCache;
  }

  // ---------- basemaps ----------
  const BASEMAPS = {
    dark: { name: 'Dark canvas (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxNative: 16 },
    satellite: { name: 'Satellite (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Imagery © Esri, Maxar, Earthstar Geographics' },
    terrain: { name: 'Terrain (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, USGS, © OpenStreetMap contributors' },
    streets: { name: 'Streets (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
    offline: { name: 'Offline (bundled demo DEM)', url: null, attr: 'Bundled synthetic DEM (demo)' }
  };

  // ---------- geometry helpers ----------
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const gpPolys = D.panchayats.map((p) => {
    const pts = [];
    D.villages.filter((v) => v.gp === p.id).forEach((v) => {
      const [x, y] = E.toXY(...E.sdToLL(v.s, v.d));
      for (let a = 0; a < 16; a++) pts.push([x + 2.4 * Math.cos((a / 16) * 2 * Math.PI), y + 2.4 * Math.sin((a / 16) * 2 * Math.PI)]);
    });
    return { gp: p, ring: hull(pts).map((q) => E.toLL(q[0], q[1])) };
  });

  const INFRA_STYLE = { school: ['S', '#fde047'], health: ['H', '#f87171'], public: ['P', '#c4b5fd'], emergency: ['E', '#fb923c'], utility: ['U', '#93c5fd'] };
  const INFRA_NAME = { school: 'School', health: 'PHC / Health centre', public: 'Public building', emergency: 'Emergency facility', utility: 'Utility / other critical' };

  // ---------- popups ----------
  const demoFoot = '<div class="pop-foot">SIMULATED DEMO DATA — prototype decision-support output</div>';
  function villagePopup(v) {
    const gp = D.panchayats.find((p) => p.id === v.gp);
    const sz = D.safeZones.find((z) => z.id === v.safeZone);
    return `<div class="pop-h">${F.esc(v.name)} <span class="tag tag-demo">DEMO</span></div>
      <div class="pop-sub">${gp.name} · ${gp.block}</div>
      <div class="pop-grid">
        <span>Flood depth</span><span>${F.m(v.depth)}</span>
        <span>Arrival time</span><span>${v.affected ? 'T+' + F.min(v.arrival) : 'Not reached'}</span>
        <span>Flood duration</span><span>${v.affected ? F.min(v.duration) : '—'}</span>
        <span>Population (est.)</span><span>${F.n(v.pop)}</span>
        <span>Risk</span><span><span class="risk risk-${v.risk}">${v.risk}</span></span>
        <span>HADR priority</span><span><span class="risk risk-${v.priority === 'NONE' ? 'NONE' : v.priority}">${v.priority}</span> ${v.affected ? F.n(v.score) : ''}</span>
        <span>From river / dam</span><span>${F.km(v.distRiver)} / ${F.km(v.distDam)}</span>
        <span>Evacuation zone</span><span>${sz ? sz.id : 'No safe route'}</span>
      </div>
      <div class="pop-actions"><button class="btn btn-sm" data-act="evac" data-id="${v.id}">Plan evacuation</button><button class="btn btn-sm" data-act="alert" data-id="${v.id}">Generate alert</button></div>${demoFoot}`;
  }
  function infraPopup(f) {
    return `<div class="pop-h">${F.esc(f.name)}</div><div class="pop-sub">${INFRA_NAME[f.type]} · synthetic asset</div>
      <div class="pop-grid"><span>Flood depth</span><span>${F.m(f.depth)}</span><span>Arrival</span><span>${f.depth > 0.05 ? 'T+' + F.min(f.arrival) : '—'}</span>
      <span>Risk</span><span><span class="risk risk-${f.risk}">${f.risk}</span></span><span>From river</span><span>${F.km(f.distRiver)}</span></div>${demoFoot}`;
  }
  function roadPopup(e, ev) {
    return `<div class="pop-h">${F.esc(e.name)}</div><div class="pop-sub">${e.cls} road · ${F.km(e.len)} · synthetic network</div>
      <div class="pop-grid"><span>Status</span><span><span class="risk risk-${ev.status.replace(' ', '.')}">${ev.status}</span></span>
      <span>Max water depth</span><span>${F.m(ev.maxDepth)}</span><span>Impassable from</span><span>${isFinite(ev.blockTime) ? 'T+' + F.min(ev.blockTime) : '—'}</span></div>${demoFoot}`;
  }
  function bridgePopup(b, ev) {
    return `<div class="pop-h">${F.esc(b.name)}</div><div class="pop-sub">${b.crossing ? 'River crossing' : 'Minor bridge / culvert'} · illustrative deck clearance ${E.DECK_CLEARANCE} m</div>
      <div class="pop-grid"><span>Status</span><span><span class="risk risk-${b.risk}">${b.status}</span></span>
      ${ev.stage ? `<span>Peak stage at crossing</span><span>${ev.stage.toFixed(1)} m</span>` : `<span>Max water depth</span><span>${F.m(b.depth)}</span>`}
      <span>Impassable from</span><span>${isFinite(ev.blockTime) ? 'T+' + F.min(ev.blockTime) : '—'}</span></div>${demoFoot}`;
  }
  function gpPopup(g) {
    return `<div class="pop-h">${g.name}</div><div class="pop-sub">${g.block} · Gram Panchayat (demo boundary)</div>
      <div class="pop-grid"><span>Affected villages</span><span>${g.affectedVillages} / ${g.villages.length}</span><span>Population (est.)</span><span>${F.n(g.population)}</span>
      <span>Flooded area</span><span>${F.n(g.area, 1)} km²</span><span>Schools / PHCs</span><span>${g.schools} / ${g.health}</span><span>Roads / bridges</span><span>${g.roads} / ${g.bridges}</span>
      <span>Risk</span><span><span class="risk risk-${g.risk}">${g.risk}</span></span></div>${demoFoot}`;
  }

  // ---------- layer registry ----------
  const LAYER_DEFS = [
    ['Hydrology', [['river', 'River'], ['dam', 'Dam (demo)'], ['arrows', 'Water-flow direction'], ['extent', 'Flood inundation boundary']]],
    ['Flood raster', [['r_depth', 'Flood depth'], ['r_arrival', 'Flood arrival-time zones'], ['r_duration', 'Flood duration'], ['r_risk', 'Risk zones']]],
    ['Terrain & imagery', [['dem', 'DEM / elevation (demo)'], ['satellite', 'Satellite imagery']]],
    ['Settlements', [['villages', 'Villages'], ['panchayats', 'Panchayats'], ['labels', 'Village labels']]],
    ['Infrastructure', [['roads', 'Roads'], ['bridges', 'Bridges'], ['infra', 'Critical infrastructure']]],
    ['Response', [['routes', 'Evacuation routes'], ['safe', 'Safe zones']]]
  ];
  const DEFAULT_LAYERS = { river: true, dam: true, arrows: true, extent: true, dem: false, satellite: false, villages: true, panchayats: false, labels: true, roads: true, bridges: true, infra: true, routes: false, safe: true };

  class MapView {
    constructor(wrap, opts) {
      this.opts = Object.assign({ tools: true, modes: true, legend: true, layers: Object.assign({}, DEFAULT_LAYERS), mode: 'depth', basemap: 'dark', interactive: true }, opts || {});
      this.wrap = wrap;
      this.layers = this.opts.layers;
      this.mode = this.opts.mode;
      const el = document.createElement('div');
      el.className = 'lmap';
      wrap.appendChild(el);
      this.map = L.map(el, { preferCanvas: true, zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
      const home = L.latLngBounds(D.river).pad(0.12);
      this.map.fitBounds(home);
      setTimeout(() => { if (this.dead) return; this.map.invalidateSize(); this.map.fitBounds(home, { animate: false }); }, 40);
      this.map.createPane('floodPane').style.zIndex = 390;
      this.map.createPane('demPane').style.zIndex = 250;
      this.map.createPane('satPane').style.zIndex = 260;
      this.g = {};
      ['dem', 'satellite', 'flood', 'extent', 'panchayats', 'roads', 'routes', 'river', 'arrows', 'bridges', 'infra', 'safe', 'villages', 'dam', 'focus', 'measure'].forEach((k) => (this.g[k] = L.layerGroup()));
      this.setBasemap(this.opts.basemap);
      const hs = renderHillshade();
      this.demImg = L.imageOverlay(hs.url, gridBounds(), { pane: 'demPane', opacity: 0.9, className: 'flood-img' });
      this.g.dem.addLayer(this.demImg);
      this.g.satellite.addLayer(L.tileLayer(BASEMAPS.satellite.url, { pane: 'satPane', opacity: 0.75, attribution: BASEMAPS.satellite.attr }));
      this.floodImg = null;
      this.buildStatic();
      Object.values(this.g).forEach((g) => g.addTo(this.map));
      if (this.opts.tools) this.buildTools();
      if (this.opts.legend) { this.legendEl = document.createElement('div'); this.legendEl.className = 'map-ctl legend'; wrap.appendChild(this.legendEl); }
      if (this.opts.modes) this.buildModeBar();
      this.applyVisibility();
    }
    setBasemap(key) {
      this.basemap = key;
      if (this.base) this.map.removeLayer(this.base);
      this.base = null;
      const b = BASEMAPS[key];
      if (b.url) this.base = L.tileLayer(b.url, { attribution: b.attr, maxZoom: 18, maxNativeZoom: b.maxNative || 18 }).addTo(this.map);
      if (key === 'offline') { this.layers.dem = true; }
      this.applyVisibility && this.g && this.applyVisibility();
      if (this.panel) this.renderPanel();
    }
    buildStatic() {
      L.polyline(D.river, { color: '#0ea5e9', weight: 9, opacity: 0.35 }).addTo(this.g.river);
      L.polyline(D.river, { color: '#67e8f9', weight: 3, opacity: 0.95 }).bindTooltip('Kosi River — centreline © OpenStreetMap contributors (simplified)', { sticky: true }).addTo(this.g.river);
      const dam = D.dam;
      L.marker([dam.lat, dam.lng], { icon: L.divIcon({ className: '', html: '<div class="dam-icon">D</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000 })
        .bindPopup(`<div class="pop-h">${dam.name}</div><div class="pop-sub">${dam.type}</div><div class="pop-grid"><span>River</span><span>Kosi (demo reach)</span><span>Storage (demo)</span><span>${FS.state ? FS.state.cfg.storage : dam.storageMCM} MCM</span></div><div class="pop-foot">Hypothetical structure — parameters are illustrative, not the characteristics of any real dam or barrage.</div>`)
        .addTo(this.g.dam);
      D.safeZones.forEach((z) => {
        const ll = E.sdToLL(z.s, z.d);
        L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="sz-icon">${z.id.slice(2)}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindPopup(`<div class="pop-h">${z.name}</div><div class="pop-sub">Designated safe location (demo)</div><div class="pop-grid"><span>Capacity (est.)</span><span>${F.n(z.capacity)}</span><span>Terrain above river</span><span>${(G.Z[E.cellIndexLL(ll[0], ll[1])] - E.bedLevel(z.s)).toFixed(1)} m</span></div><div class="pop-foot">Illustrative location — not an officially notified relief camp.</div>`)
          .addTo(this.g.safe);
      });
    }
    // data = {res, ana, t, routesFor?}
    update(data) {
      this.data = data;
      const { res, ana, t } = data;
      // flood raster
      const rmode = { depth: 'depth', arrival: 'arrival', duration: 'duration', risk: 'risk', infra: 'depth', evac: 'depth' }[this.mode];
      const alpha = this.mode === 'infra' || this.mode === 'evac' ? 0.45 : 0.78;
      this.g.flood.clearLayers();
      if (res && this.mode !== 'none') {
        this.floodImg = L.imageOverlay(renderRaster(res, rmode, t, alpha), gridBounds(), { pane: 'floodPane', className: 'flood-img', interactive: false });
        this.g.flood.addLayer(this.floodImg);
      }
      // extent
      this.g.extent.clearLayers();
      if (res) {
        const ring = E.envelope(res, t);
        if (ring) L.polygon(ring, { color: '#22d3ee', weight: 1.4, dashArray: '5 4', fill: false, interactive: false }).addTo(this.g.extent);
      }
      // arrows
      this.g.arrows.clearLayers();
      if (res) {
        const st = E.R.stations;
        for (let k = 4; k < st.length; k += 8) {
          if (res.st.ta[k] > t) break;
          const p = st[k];
          const add = (d, rot, op) => {
            const ll = E.sdToLL(p.s, d);
            const i = E.cellIndexLL(ll[0], ll[1]);
            if (d !== 0 && !(E.depthAt(res, i, t) > 0.1)) return;
            L.marker(ll, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="arrow-icon" style="transform:rotate(${rot}deg);opacity:${op}">➤</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(this.g.arrows);
          };
          const ang = (-Math.atan2(p.ty, p.tx) * 180) / Math.PI;
          add(0, ang, 1);
          add(3, ang - 28, 0.75); add(-3, ang + 28, 0.75);
          add(7, ang - 40, 0.6); add(-7, ang + 40, 0.6);
        }
      }
      if (!ana) return this.applyVisibility();
      // roads
      this.g.roads.clearLayers();
      E.ROADS.edges.forEach((e) => {
        if (e.crossing) return;
        const ev = ana.roadEval[e.id];
        const wetNow = isFinite(ev.blockTime) && ev.blockTime <= t;
        const col = ev.blocked ? (wetNow ? '#ef4444' : '#f97316') : ev.risky ? '#f59e0b' : '#94a3b8';
        const w = e.cls === 'state' ? 3 : e.cls === 'village' ? 1.6 : 2.3;
        L.polyline(e.geom.map((g) => g.ll), { color: col, weight: w, opacity: ev.blocked || ev.risky ? 0.95 : 0.55, dashArray: e.cls === 'village' ? '3 4' : null })
          .bindPopup(() => roadPopup(e, ev)).addTo(this.g.roads);
      });
      // bridges
      this.g.bridges.clearLayers();
      ana.bridges.forEach((b) => {
        const ev = ana.roadEval[b.edge];
        if (b.crossing) {
          const e = E.ROADS.edges.find((x) => x.id === b.edge);
          L.polyline(e.geom.map((g) => g.ll), { color: RISK_COL[b.risk], weight: 4, opacity: 0.95 }).bindPopup(() => bridgePopup(b, ev)).addTo(this.g.bridges);
        }
        L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', html: `<div class="infra-icon" style="background:${RISK_COL[b.risk]}">B</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup(() => bridgePopup(b, ev)).addTo(this.g.bridges);
      });
      // infra
      this.g.infra.clearLayers();
      ana.infra.forEach((f) => {
        const [ch, col] = INFRA_STYLE[f.type];
        const ring = f.risk !== 'NONE' ? `box-shadow:0 0 0 2px ${RISK_COL[f.risk]}` : 'opacity:.85';
        L.marker([f.lat, f.lng], { icon: L.divIcon({ className: '', html: `<div class="infra-icon" style="background:${col};${ring}">${ch}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup(() => infraPopup(f)).addTo(this.g.infra);
      });
      // panchayats
      this.g.panchayats.clearLayers();
      gpPolys.forEach((p) => {
        const g = ana.panchayats.find((x) => x.id === p.gp.id);
        L.polygon(p.ring, { color: '#c4b5fd', weight: 1.2, dashArray: '6 4', fillColor: RISK_COL[g.risk], fillOpacity: 0.07 })
          .bindTooltip(p.gp.name, { sticky: true }).bindPopup(() => gpPopup(g)).addTo(this.g.panchayats);
      });
      // routes
      this.g.routes.clearLayers();
      ana.villages.forEach((v) => {
        if (!v.affected) return;
        const r = v.evac.recommended;
        if (r) L.polyline(r.coords, { color: '#22c55e', weight: 3, opacity: 0.85 }).bindTooltip(`Recommended evacuation: ${v.name} → ${v.safeZone} (simulated)`, { sticky: true }).addTo(this.g.routes);
      });
      // villages
      this.g.villages.clearLayers();
      ana.villages.forEach((v) => {
        const reached = v.affected && v.arrival <= t;
        const col = v.affected ? RISK_COL[v.risk] : '#64748b';
        const m = L.circleMarker([v.lat, v.lng], { radius: 5 + Math.sqrt(v.pop) / 12, color: '#0b1424', weight: 2, fillColor: col, fillOpacity: reached ? 0.95 : 0.55 })
          .bindPopup(() => villagePopup(v), { maxWidth: 300 });
        if (this.layers.labels) m.bindTooltip(v.name, { permanent: true, direction: 'right', offset: [8, 0], className: 'vlabel' });
        m.addTo(this.g.villages);
      });
      this.applyVisibility();
      if (this.legendEl) this.renderLegend();
    }
    focusRoute(plan, villages) {
      this.g.focus.clearLayers();
      if (!plan) return;
      if (plan.naive) L.polyline(plan.naive.coords, { color: '#ef4444', weight: 5, opacity: 0.9, dashArray: '8 6' }).bindTooltip('UNSAFE: shortest path ignoring flood', { sticky: true }).addTo(this.g.focus);
      if (plan.alternative) L.polyline(plan.alternative.coords, { color: '#facc15', weight: 4, opacity: 0.9, dashArray: '2 6' }).bindTooltip('Alternative route (simulated)', { sticky: true }).addTo(this.g.focus);
      if (plan.recommended) {
        L.polyline(plan.recommended.coords, { color: '#052e16', weight: 9, opacity: 0.7 }).addTo(this.g.focus);
        L.polyline(plan.recommended.coords, { color: '#22c55e', weight: 5 }).bindTooltip('Recommended route (simulated)', { sticky: true }).addTo(this.g.focus);
        plan.recommended.blocked.concat(plan.recommended.risky).forEach((e) => L.polyline(e.geom.map((g) => g.ll), { color: '#f59e0b', weight: 7, opacity: 0.5 }).addTo(this.g.focus));
      }
      const v = villages.find((x) => x.id === plan.villageId);
      if (v) L.circleMarker([v.lat, v.lng], { radius: 11, color: '#ef4444', weight: 3, fillColor: '#ef4444', fillOpacity: 0.5 }).addTo(this.g.focus);
      const z = D.safeZones.find((x) => x.id === plan.dest);
      if (z) L.circleMarker(E.sdToLL(z.s, z.d), { radius: 14, color: '#22c55e', weight: 3, fillOpacity: 0.2 }).addTo(this.g.focus);
      const b = plan.recommended ? plan.recommended.coords : v ? [[v.lat, v.lng]] : null;
      if (b && b.length > 1 && !this.dead) this.map.fitBounds(L.latLngBounds(b).pad(0.3), { animate: false });
    }
    setMode(m) {
      this.mode = m;
      if (m === 'infra') Object.assign(this.layers, { roads: true, bridges: true, infra: true });
      if (m === 'evac') Object.assign(this.layers, { routes: true, safe: true });
      if (this.data) this.update(this.data);
      if (this.modeBar) this.modeBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      if (this.panel) this.renderPanel();
      if (this.onMode) this.onMode(m);
    }
    applyVisibility() {
      Object.keys(this.g).forEach((k) => {
        if (k === 'flood' || k === 'focus' || k === 'measure') return;
        const on = this.layers[k] !== false && this.layers[k] !== undefined ? this.layers[k] : false;
        if (on && !this.map.hasLayer(this.g[k])) this.g[k].addTo(this.map);
        if (!on && this.map.hasLayer(this.g[k])) this.map.removeLayer(this.g[k]);
      });
    }
    renderLegend() {
      const rmode = { depth: 'depth', arrival: 'arrival', duration: 'duration', risk: 'risk', infra: 'depth', evac: 'depth' }[this.mode];
      const P = PAL[rmode];
      let h = '';
      if (P) h += `<div class="legend-t">${P.title}</div>` + P.labels.map((l, i) => `<div class="legend-row"><i style="background:${P.colors[i]}"></i>${l}</div>`).join('');
      if (this.mode === 'infra' || this.mode === 'evac' || this.layers.villages) {
        h += `<div class="legend-t" style="margin-top:6px">Settlement risk</div>` + ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'].map((r) => `<div class="legend-row"><i style="background:${RISK_COL[r]};border-radius:50%;width:10px"></i>${r === 'NONE' ? 'Not affected' : r}</div>`).join('');
      }
      if (this.mode === 'evac') h += `<div class="legend-row"><i style="background:#22c55e;height:4px"></i>Recommended route</div><div class="legend-row"><i style="background:#ef4444;height:4px"></i>Flooded / unsafe road</div>`;
      if (this.mode === 'infra') h += `<div class="legend-row"><i style="background:#ef4444;height:4px"></i>Road flooded now</div><div class="legend-row"><i style="background:#f97316;height:4px"></i>Road floods later</div><div class="legend-row"><i style="background:#f59e0b;height:4px"></i>Shallow water (caution)</div>`;
      h += '<div class="legend-demo">SIMULATED DEMO DATA</div>';
      this.legendEl.innerHTML = h;
    }
    buildModeBar() {
      const d = document.createElement('div');
      d.className = 'map-ctl mode-bar';
      const modes = [['depth', 'Flood Depth'], ['arrival', 'Arrival Time'], ['duration', 'Flood Duration'], ['risk', 'Risk'], ['infra', 'Affected Infrastructure'], ['evac', 'Evacuation Routes']];
      d.innerHTML = `<div class="seg">${modes.map(([k, l]) => `<button data-m="${k}" class="${k === this.mode ? 'on' : ''}">${l}</button>`).join('')}</div>`;
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
      L.DomEvent.disableClickPropagation(t);
      L.DomEvent.disableScrollPropagation(t);
      this.panel = t.querySelector('.layer-panel');
      this.renderPanel();
      t.addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        if (b.dataset.t === 'layers') { this.panel.classList.toggle('hidden'); b.classList.toggle('on'); }
        if (b.dataset.t === 'fs') { if (document.fullscreenElement) document.exitFullscreen(); else this.wrap.requestFullscreen && this.wrap.requestFullscreen(); }
        if (b.dataset.t === 'measure') this.toggleMeasure(b);
      });
      document.addEventListener('fullscreenchange', () => setTimeout(() => this.map.invalidateSize(), 150));
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
      const rm = { depth: 'r_depth', arrival: 'r_arrival', duration: 'r_duration', risk: 'r_risk', infra: 'r_depth', evac: 'r_depth' }[this.mode];
      let h = `<h4>Basemap</h4><select name="basemap">${Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}" ${k === this.basemap ? 'selected' : ''}>${b.name}</option>`).join('')}</select>`;
      LAYER_DEFS.forEach(([grp, items]) => {
        h += `<h4>${grp}</h4>`;
        items.forEach(([k, l]) => {
          if (k.startsWith('r_')) h += `<label><input type="radio" name="raster" value="${k.slice(2)}" ${rm === k ? 'checked' : ''}/> ${l}</label>`;
          else h += `<label><input type="checkbox" data-k="${k}" ${this.layers[k] ? 'checked' : ''}/> ${l}</label>`;
        });
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
    destroy() { this.dead = true; try { this.map.stop(); this.map.off(); this.map.remove(); } catch (e) {} }
  }

  FS.mapkit = { MapView, PAL, RISK_COL, BASEMAPS, renderRaster, renderDiff, renderMask, renderHillshade, gridBounds, INFRA_NAME, INFRA_STYLE, villagePopup };
})();
