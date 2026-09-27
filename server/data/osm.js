'use strict';
// OpenStreetMap features (places, roads, critical facilities, rivers) for a
// bbox via Overpass API mirrors, with a JSON disk cache. Never throws.
// Data © OpenStreetMap contributors, ODbL 1.0.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'FloodSimHADR/1.0 (SIH26161 prototype)';
const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const DEFAULT_CACHE = path.join(__dirname, '..', '..', 'data', 'cache');
const CACHE_VERSION = 1;

const ALL_ROADS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified'];
const AMENITY = ['school', 'college', 'university', 'hospital', 'clinic', 'doctors', 'police',
  'fire_station', 'townhall', 'community_centre', 'shelter'];
const TYPE_OF = {
  school: 'school', college: 'school', university: 'school',
  hospital: 'health', clinic: 'health', doctors: 'health',
  police: 'police', fire_station: 'fire',
  townhall: 'public', community_centre: 'public',
  shelter: 'shelter', assembly_point: 'shelter'
};
// amenity=shelter is mostly bus stops / picnic huts in OSM; drop those
const SKIP_SHELTER = new Set(['public_transport', 'picnic_shelter', 'field_shelter', 'sun_shelter']);

// Unclassified roads only for small bboxes (<= ~0.6°×0.6°) to bound size;
// a 1.5°×1.5° bbox in Bihar with tertiary+ is ~5k ways / ~10 MB JSON.
function roadClassesFor(areaDeg2) {
  return areaDeg2 <= 0.35 ? ALL_ROADS : ALL_ROADS.slice(0, 5);
}

function buildQuery({ south, west, north, east }, roadClasses, timeoutSec) {
  const bb = [south, west, north, east].map(v => v.toFixed(5)).join(',');
  const hw = `^(${roadClasses.join('|')})(_link)?$`;
  const am = `^(${AMENITY.join('|')})$`;
  return `[out:json][timeout:${timeoutSec}][maxsize:536870912][bbox:${bb}];
node[place~"^(city|town|village|hamlet)$"];out body;
way[highway~"${hw}"];out geom;
(node[amenity~"${am}"];way[amenity~"${am}"];node[emergency=assembly_point];way[emergency=assembly_point];);out center;
way[waterway~"^(river|canal)$"];out geom;`;
}

const num = v => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};
const r6 = v => Math.round(v * 1e6) / 1e6;
const geomOf = el => (el.geometry || []).filter(Boolean).map(p => [r6(p.lat), r6(p.lon)]);

function parse(json) {
  const places = [], roads = [], amenities = [], waterways = [];
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'node' && t.place && /^(city|town|village|hamlet)$/.test(t.place) && !t.amenity) {
      places.push({
        id: 'n' + el.id,
        name: t.name || t['name:en'] || null,
        nameHi: t['name:hi'] || null,
        lat: r6(el.lat), lng: r6(el.lon),
        place: t.place,
        population: num(t.population)
      });
    } else if (el.type === 'way' && t.highway && el.geometry) {
      roads.push({
        id: 'w' + el.id,
        name: t.name || null,
        ref: t.ref || null,
        highway: t.highway,
        bridge: !!t.bridge && t.bridge !== 'no',
        nodeIds: el.nodes || [],
        geom: geomOf(el)
      });
    } else if (el.type === 'way' && t.waterway && el.geometry) {
      waterways.push({ id: 'w' + el.id, name: t.name || null, waterway: t.waterway, geom: geomOf(el) });
    } else if (t.amenity || t.emergency === 'assembly_point') {
      const kind = TYPE_OF[t.amenity] ? t.amenity : t.emergency === 'assembly_point' ? 'assembly_point' : null;
      if (!kind) continue;
      if (kind === 'shelter' && SKIP_SHELTER.has(t.shelter_type)) continue;
      const lat = el.type === 'node' ? el.lat : el.center && el.center.lat;
      const lng = el.type === 'node' ? el.lon : el.center && el.center.lon;
      if (lat == null || lng == null) continue;
      amenities.push({
        id: el.type[0] + el.id,
        name: t.name || null,
        nameHi: t['name:hi'] || null,
        type: TYPE_OF[kind],
        osmTag: kind,
        lat: r6(lat), lng: r6(lng)
      });
    }
  }
  return { places, roads, amenities, waterways };
}

async function queryMirror(url, query, timeoutMs, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('non-JSON response (' + text.slice(0, 80).replace(/\s+/g, ' ') + ')'); }
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('Overpass: ' + json.remark.slice(0, 160));
  return json;
}

// Hedged race: mirrors start staggered by hedgeMs; first success wins and
// the rest are aborted. Rejects with all errors if every mirror fails.
function raceMirrors(query, timeoutMs, hedgeMs) {
  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    const errors = [];
    let done = false, launched = 0, failed = 0, timer = null;
    const launchNext = () => {
      clearTimeout(timer);
      if (done || launched >= MIRRORS.length) return;
      const url = MIRRORS[launched++];
      const host = new URL(url).host;
      const t0 = Date.now();
      if (launched < MIRRORS.length) timer = setTimeout(launchNext, hedgeMs);
      queryMirror(url, query, timeoutMs, ctl.signal).then(json => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ctl.abort();
        resolve({ json, host, ms: Date.now() - t0, errors });
      }, e => {
        if (done) return;
        errors.push(host + ': ' + (e.name === 'TimeoutError' ? 'timeout' : e.message));
        if (++failed === MIRRORS.length) { done = true; reject(new Error(errors.join('; '))); }
        else launchNext(); // fast failure: don't wait for the hedge timer
      });
    };
    launchNext();
  });
}

/**
 * Fetch OSM features for a bbox.
 * opts: { cacheDir, timeoutMs = 90000 (per mirror), maxAgeDays = 30, roadClasses,
 *         refresh, hedgeMs = 15000 (delay before also trying the next mirror) }
 */
async function getFeatures(bbox, opts = {}) {
  const { cacheDir = DEFAULT_CACHE, timeoutMs = 90000, maxAgeDays = 30, refresh = false, hedgeMs = 15000 } = opts;
  const empty = { places: [], roads: [], amenities: [], waterways: [] };
  const { south, west, north, east } = bbox || {};
  if (![south, west, north, east].every(Number.isFinite) || north <= south || east <= west) {
    return { ok: false, error: 'invalid bbox', ...empty };
  }
  const area = (north - south) * (east - west);
  const roadClasses = opts.roadClasses || roadClassesFor(area);
  const key = crypto.createHash('sha1')
    .update(JSON.stringify([CACHE_VERSION, south, west, north, east].map(v => Math.round(v * 1000) / 1000).concat(roadClasses)))
    .digest('hex').slice(0, 16);
  const file = path.join(cacheDir, 'osm', key + '.json');

  let stale = null;
  if (fs.existsSync(file)) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      const age = (Date.now() - Date.parse(c.fetchedAt)) / 86400000;
      if (!refresh && age <= maxAgeDays) return { ...c, cached: true };
      stale = c;
    } catch (e) { /* corrupt cache: ignore */ }
  }

  const query = buildQuery({ south, west, north, east }, roadClasses, Math.ceil(timeoutMs / 1000));
  let res;
  try {
    res = await raceMirrors(query, timeoutMs + 5000, hedgeMs);
  } catch (e) {
    const msg = 'all Overpass mirrors failed: ' + e.message;
    if (stale) return { ...stale, cached: true, stale: true, error: msg + ' (serving stale cache)' };
    return { ok: false, source: 'Overpass API', fetchedAt: new Date().toISOString(), error: msg, ...empty };
  }
  const feats = parse(res.json);
  const out = {
    ok: true,
    source: 'OpenStreetMap contributors (ODbL 1.0) via Overpass API ' + res.host,
    license: 'ODbL 1.0',
    fetchedAt: new Date().toISOString(),
    osmBase: (res.json.osm3s && res.json.osm3s.timestamp_osm_base) || null,
    bbox: { south, west, north, east },
    roadClasses,
    counts: {
      places: feats.places.length,
      roads: feats.roads.length,
      bridges: feats.roads.filter(r => r.bridge).length,
      amenities: feats.amenities.length,
      waterways: feats.waterways.length
    },
    queryMs: res.ms,
    mirrorErrors: res.errors.slice(),
    ...feats
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
  } catch (e) { /* cache write failure is non-fatal */ }
  return { ...out, cached: false };
}

module.exports = { getFeatures, buildQuery, MIRRORS };
