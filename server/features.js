'use strict';
/* Builds scenario features (villages, groups, infrastructure, routable road graph, bridges, safe zones)
 * from OpenStreetMap data + simulated flood rasters. Population uses the OSM `population` tag when
 * present, otherwise a documented place-type default (flagged ESTIMATE). */
const A = require('../public/js/analysis.js');

const POP_DEFAULT = { hamlet: 300, village: 1500, town: 25000, city: 150000 };
const CLS = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', unclassified: 'unclassified' };
const round = (v) => Math.round(v * 1e5) / 1e5;

function inGrid(g, lat, lng) { return A.cellIndex(g, lat, lng) >= 0; }

function buildFeatures(osm, scn, opts) {
  opts = opts || {};
  const g = scn.grid;
  const places = (osm.places || []).filter((p) => p.name && inGrid(g, p.lat, p.lng));
  // ---- villages ----
  const villages = places.map((p, k) => {
    const osmPop = Number.isFinite(+p.population) && +p.population > 0 ? Math.round(+p.population) : null;
    return { id: 'V' + (k + 1), osmId: p.id, name: p.name, nameHi: p.nameHi || null, lat: round(p.lat), lng: round(p.lng), place: p.place, pop: osmPop ?? POP_DEFAULT[p.place] ?? 1000, popSource: osmPop ? 'OSM' : 'ESTIMATE', footprint: p.place === 'town' || p.place === 'city' ? 2 : 1 };
  });
  // ---- groups: nearest town/city (Gram Panchayat boundaries are not in open data) ----
  let centres = villages.filter((v) => v.place === 'town' || v.place === 'city');
  if (!centres.length) centres = villages.length ? [villages.reduce((a, v) => (v.pop > a.pop ? v : a))] : [];
  const groups = centres.map((c, k) => ({ id: 'G' + (k + 1), name: `${c.name} cluster`, block: null, kind: 'Proxy group (nearest town) — GP/LGD boundaries not in open data' }));
  const nearestCentre = (lat, lng) => { let b = Infinity, id = groups[0] ? groups[0].id : 'G1'; centres.forEach((c, k) => { const d = A.distKm([lat, lng], [c.lat, c.lng]); if (d < b) { b = d; id = groups[k].id; } }); return id; };
  villages.forEach((v) => (v.group = nearestCentre(v.lat, v.lng)));
  const nearestVillage = (lat, lng, maxKm) => { let b = maxKm, best = null; villages.forEach((v) => { const d = A.distKm([lat, lng], [v.lat, v.lng]); if (d < b) { b = d; best = v; } }); return best; };
  // ---- infrastructure ----
  const infra = (osm.amenities || []).filter((a) => inGrid(g, a.lat, a.lng)).map((a, k) => {
    const v = nearestVillage(a.lat, a.lng, 2.5);
    return { id: 'F' + (k + 1), osmId: a.id, type: a.type, name: a.name || `${a.type} (unnamed)`, lat: round(a.lat), lng: round(a.lng), village: v ? v.id : null, group: v ? v.group : nearestCentre(a.lat, a.lng) };
  });

  // ---- road graph ----
  let ways = (osm.roads || []).filter((w) => w.geom && w.geom.length > 1 && w.nodeIds && w.nodeIds.length === w.geom.length && w.geom.some((p) => inGrid(g, p[0], p[1])));
  if (ways.length > 5000) ways = ways.filter((w) => !/unclassified/.test(w.highway));
  const deg = new Map();
  ways.forEach((w) => w.nodeIds.forEach((id, i) => deg.set(id, (deg.get(id) || 0) + (i === 0 || i === w.nodeIds.length - 1 ? 2 : 1))));
  const nodes = {}, edges = [], bridgeWays = [];
  let ec = 0;
  const addNode = (id, p, kind) => { if (!nodes[id]) nodes[id] = { id, lat: round(p[0]), lng: round(p[1]), kind: kind || 'junction' }; return id; };
  ways.forEach((w) => {
    const cls = CLS[w.highway] || (/_link$/.test(w.highway) ? 'link' : 'unclassified');
    let start = 0;
    for (let i = 1; i < w.nodeIds.length; i++) {
      if (i < w.nodeIds.length - 1 && (deg.get(w.nodeIds[i]) || 0) < 2) continue;
      const geom = w.geom.slice(start, i + 1).map((p) => [round(p[0]), round(p[1])]);
      const a = addNode('n' + w.nodeIds[start], w.geom[start]), b = addNode('n' + w.nodeIds[i], w.geom[i]);
      if (a !== b) {
        const e = { id: 'R' + ++ec, a, b, name: w.name || w.ref || `${w.highway} road`, ref: w.ref || null, cls, len: A.lineKm(geom), geom, osmId: w.id };
        if (w.bridge) { e.bridge = { id: 'B' + w.id, name: `Bridge on ${e.name}` }; bridgeWays.push(e); }
        edges.push(e);
      }
      start = i;
    }
  });
  // connect villages to nearest graph nodes (≤ 3 km)
  const nodeList = Object.values(nodes);
  const connect = (id, lat, lng, kind, maxKm, count, cls) => {
    addNode(id, [lat, lng], kind);
    nodeList.filter((n) => n.kind === 'junction').map((n) => ({ n, d: A.distKm([lat, lng], [n.lat, n.lng]) })).filter((x) => x.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, count)
      .forEach(({ n, d }) => edges.push({ id: 'R' + ++ec, a: id, b: n.id, name: `Access road (${kind === 'village' ? 'village' : 'safe zone'})`, cls, len: Math.max(0.05, d * 1.25), geom: [[lat, lng], [n.lat, n.lng]] }));
  };
  villages.forEach((v) => connect(v.id, v.lat, v.lng, 'village', 3, 2, 'village'));

  // ---- bridges (OSM bridge ways); river crossings flagged where they cross permanent water ----
  const bridges = bridgeWays.map((e) => {
    const mid = e.geom[Math.floor(e.geom.length / 2)];
    const crossing = scn.channel ? A.densify(e.geom, 0.05).some((p) => { const i = A.cellIndex(g, p[0], p[1]); return i >= 0 && scn.channel[i]; }) : false;
    e.crossing = crossing;
    const v = nearestVillage(mid[0], mid[1], 5);
    return { id: e.bridge.id, name: e.bridge.name, lat: mid[0], lng: mid[1], edge: e.id, crossing, group: v ? v.group : nearestCentre(mid[0], mid[1]) };
  });

  // ---- safe zones: named places / junctions outside the simulated flood (both models) with clearance ----
  const models = Object.values(scn.models);
  const wetAny = new Uint8Array(g.n);
  models.forEach((M) => { for (let i = 0; i < g.n; i++) if (M.dmax[i] > 0.05) wetAny[i] = 1; });
  // distance (cells) to nearest wet cell via two-pass chamfer transform
  const dist = new Float32Array(g.n).fill(1e9);
  for (let i = 0; i < g.n; i++) if (wetAny[i]) dist[i] = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const i = r * g.cols + c; if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1); if (r > 0) dist[i] = Math.min(dist[i], dist[i - g.cols] + 1); }
  for (let r = g.rows - 1; r >= 0; r--) for (let c = g.cols - 1; c >= 0; c--) { const i = r * g.cols + c; if (c < g.cols - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1); if (r < g.rows - 1) dist[i] = Math.min(dist[i], dist[i + g.cols] + 1); }
  const cellKm = Math.min(g.dx, g.dy) / 1000;
  const clearKm = opts.safeClearanceKm || 1.5;
  let wse = -Infinity;
  models.forEach((M) => { for (let i = 0; i < g.n; i++) if (M.dmax[i] > 0.05 && !(scn.channel && scn.channel[i])) wse = Math.max(wse, scn.dem[i] + M.dmax[i]); });
  const cands = villages.map((v) => ({ lat: v.lat, lng: v.lng, name: v.name, src: 'place' }))
    .concat(nodeList.filter((n) => n.kind === 'junction').map((n) => ({ lat: n.lat, lng: n.lng, name: null, src: 'junction' })))
    .map((p) => { const i = A.cellIndex(g, p.lat, p.lng); return Object.assign(p, { i, dWet: i >= 0 ? dist[i] * cellKm : 0 }); })
    .filter((p) => p.i >= 0 && p.dWet >= clearKm && p.dWet <= 15);
  // pick spread-out candidates along the river on both banks
  const river = scn.river, zones = [];
  const side = (p) => {
    const nr = A.nearestOnLine(river, [p.lat, p.lng]);
    const pts = A.densify(river, 0.5);
    let k = 0, b = Infinity; pts.forEach((q, j) => { const d = A.distKm(q, [p.lat, p.lng]); if (d < b) { b = d; k = j; } });
    const a = pts[Math.max(0, k - 1)], c = pts[Math.min(pts.length - 1, k + 1)];
    const cross = (c[1] - a[1]) * (p.lat - a[0]) - (c[0] - a[0]) * (p.lng - a[1]);
    return { ch: nr.chainage, s: cross > 0 ? 'L' : 'R' };
  };
  cands.forEach((p) => Object.assign(p, side(p)));
  const segKm = Math.max(8, A.lineKm(river) / 5);
  const buckets = {};
  cands.forEach((p) => { const k = Math.floor(p.ch / segKm) + p.s; const score = (p.src === 'place' ? 0 : 3) + Math.abs(p.dWet - clearKm - 1); if (!buckets[k] || score < buckets[k].score) buckets[k] = Object.assign(p, { score }); });
  Object.values(buckets).sort((a, b) => a.ch - b.ch).slice(0, 12).forEach((p, k) => {
    const id = 'SZ' + (k + 1);
    const elevAbove = isFinite(wse) ? scn.dem[p.i] - wse : null;
    zones.push({ id, name: `Safe Zone ${k + 1} — ${p.name ? p.name + ' (outside flood)' : 'high-ground junction'}`, lat: p.lat, lng: p.lng, capacity: null, dWetKm: +p.dWet.toFixed(1), elevAbove: elevAbove != null && elevAbove > 0 ? elevAbove : null, note: 'Auto-selected candidate: outside the simulated flood extent of both models with ≥ ' + clearKm + ' km clearance. Not an officially notified relief camp.' });
    connect(id, p.lat, p.lng, 'safe', 2, 1, 'link');
  });

  return {
    villages, groups: groups.length ? groups : [{ id: 'G1', name: 'Study area', kind: 'Single group' }], infra,
    roads: { nodes, edges }, bridges, safeZones: zones,
    counts: { places: places.length, ways: ways.length, edges: edges.length, amenities: infra.length, bridges: bridges.length, safeZones: zones.length }
  };
}

module.exports = { buildFeatures, POP_DEFAULT };
