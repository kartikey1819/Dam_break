'use strict';
// Indian dam catalogue from Wikidata (CC0). listDams() serves the committed
// snapshot; refreshDams() rebuilds it from the live SPARQL endpoint.
//
// Property findings (tested 2026-09 on Tehri, Bhakra, Hirakud, Sardar Sarovar,
// Nagarjuna Sagar, Koyna, Idukki): height P2048 and length P2043 are
// reasonably populated; storage is rare. It lives as P2234 "volume as
// quantity" either on the dam itself or on the reservoir item linked by
// P4661 "reservoir created" (or reverse P4792 "dam"). River is P206, else
// P706 "located in/on physical feature". Quantities are read via psn:
// (SI-normalised) so units come out as m and m^3.

const fs = require('fs');
const path = require('path');

const UA = 'FloodSimHADR/1.0 (SIH26161 prototype)';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const SNAPSHOT = path.join(__dirname, '..', '..', 'data', 'dams_india.json');
// Largest Indian reservoir (Indira Sagar) is ~12,200 MCM; anything far above
// is a Wikidata unit error and is dropped rather than guessed.
const MAX_PLAUSIBLE_MCM = 25000;

let cache = null;

function listDams() {
  if (!cache) cache = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  return cache;
}

async function sparql(query, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'query=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90000)
      });
      if (res.ok) return (await res.json()).results.bindings;
      lastErr = new Error('Wikidata HTTP ' + res.status);
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 3000 * (i + 1)));
  }
  throw lastErr;
}

const qid = uri => uri.slice(uri.lastIndexOf('/') + 1);
const val = (b, k) => (b[k] ? b[k].value : null);
const num = (b, k) => (b[k] ? Number(b[k].value) : null);

function parsePoint(wkt) {
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(wkt || '');
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
}

const round = (v, d) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// Step 1: all dam/barrage/weir items in India that have coordinates.
const LIST_QUERY = `
SELECT DISTINCT ?d ?coord ?en ?hi WHERE {
  VALUES ?cls { wd:Q12323 wd:Q350495 wd:Q1066997 }
  ?d wdt:P17 wd:Q668 ; wdt:P31/wdt:P279* ?cls ; wdt:P625 ?coord .
  OPTIONAL { ?d rdfs:label ?en FILTER(lang(?en) = 'en') }
  OPTIONAL { ?d rdfs:label ?hi FILTER(lang(?hi) = 'hi') }
}`;

// Step 2: attributes, batched by VALUES to avoid endpoint timeouts.
const detailQuery = ids => `
SELECT ?d ?river ?riverL ?feat ?featL ?admin ?adminL ?state ?stateL
       ?h ?len ?volSelf ?volRes ?opened ?incep WHERE {
  VALUES ?d { ${ids.map(i => 'wd:' + i).join(' ')} }
  OPTIONAL { ?d wdt:P206 ?river . ?river rdfs:label ?riverL FILTER(lang(?riverL) = 'en') }
  OPTIONAL { ?d wdt:P706 ?feat . ?feat rdfs:label ?featL FILTER(lang(?featL) = 'en') }
  OPTIONAL { ?d wdt:P131 ?admin . ?admin rdfs:label ?adminL FILTER(lang(?adminL) = 'en') }
  OPTIONAL { ?d wdt:P131+ ?state .
             VALUES ?stType { wd:Q12443800 wd:Q467745 }
             ?state wdt:P31 ?stType .
             ?state rdfs:label ?stateL FILTER(lang(?stateL) = 'en') }
  OPTIONAL { ?d p:P2048/psn:P2048/wikibase:quantityAmount ?h }
  OPTIONAL { ?d p:P2043/psn:P2043/wikibase:quantityAmount ?len }
  OPTIONAL { ?d p:P2234/psn:P2234/wikibase:quantityAmount ?volSelf }
  OPTIONAL { { ?d wdt:P4661 ?res } UNION { ?res wdt:P4792 ?d }
             ?res p:P2234/psn:P2234/wikibase:quantityAmount ?volRes }
  OPTIONAL { ?d wdt:P1619 ?opened }
  OPTIONAL { ?d wdt:P571 ?incep }
}`;

const year = s => {
  const m = /^(-?\d{1,4})-/.exec(s || '');
  return m ? Number(m[1]) : null;
};

const minOf = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

async function refreshDams(outPath = SNAPSHOT, { log = () => {} } = {}) {
  const rows = await sparql(LIST_QUERY);
  const dams = new Map();
  for (const b of rows) {
    const id = qid(b.d.value);
    const pt = parsePoint(val(b, 'coord'));
    if (!pt) continue;
    if (!dams.has(id)) {
      dams.set(id, {
        qid: id,
        name: val(b, 'en'),
        nameHi: /[ऀ-ॿ]/.test(val(b, 'hi') || '') ? val(b, 'hi') : null,
        lat: round(pt.lat, 6),
        lng: round(pt.lng, 6),
        river: null,
        state: null,
        district: null,
        heightM: null,
        lengthM: null,
        capacityMCM: null,
        yearOpened: null,
        source: 'Wikidata (CC0)',
        wikidataUrl: 'https://www.wikidata.org/wiki/' + id
      });
    }
  }
  log('Wikidata: ' + dams.size + ' dams with coordinates');

  // Items without an English label: fall back to 'mul' / regional labels
  const unnamed = [...dams.values()].filter(d => !d.name).map(d => d.qid);
  if (unnamed.length) {
    const lb = await sparql(`SELECT ?d ?l WHERE {
      VALUES ?d { ${unnamed.map(i => 'wd:' + i).join(' ')} } ?d rdfs:label ?l }`);
    const pref = ['mul', 'en-gb', 'en-in', 'en-ca', 'en-us', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'ml', 'bn', 'or', 'pa'];
    const best = {};
    for (const b of lb) {
      const id = qid(b.d.value), lang = b.l['xml:lang'];
      const rank = pref.includes(lang) ? pref.indexOf(lang) : 99;
      if (!best[id] || rank < best[id].rank) best[id] = { rank, text: b.l.value, lang };
    }
    for (const id of unnamed) {
      if (best[id]) Object.assign(dams.get(id), { name: best[id].text, nameLang: best[id].lang });
    }
  }

  const ids = [...dams.keys()];
  const BATCH = 120;
  const rejected = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const det = await sparql(detailQuery(batch));
    const acc = {};
    for (const b of det) {
      const id = qid(b.d.value);
      const a = acc[id] || (acc[id] = {});
      a.river = a.river || val(b, 'riverL');
      a.feat = a.feat || val(b, 'featL');
      a.admin = a.admin || val(b, 'adminL');
      a.state = a.state || val(b, 'stateL');
      // Multiple statements: keep the largest height/length (structural max)
      a.h = maxOf(a.h, num(b, 'h'));
      a.len = maxOf(a.len, num(b, 'len'));
      a.vol = maxOf(a.vol, maxOf(num(b, 'volSelf'), num(b, 'volRes')));
      a.year = minOf(a.year, year(val(b, 'opened')));
      a.incep = minOf(a.incep, year(val(b, 'incep')));
    }
    for (const id of batch) {
      const d = dams.get(id), a = acc[id];
      if (!a) continue;
      d.river = a.river || a.feat || null;
      d.district = a.admin && a.admin !== a.state ? a.admin : null;
      d.state = a.state || a.admin || null;
      d.heightM = a.h > 0 && a.h < 400 ? round(a.h, 2) : null;
      d.lengthM = a.len > 0 && a.len < 50000 ? round(a.len, 1) : null;
      if (a.vol > 0) {
        const mcm = a.vol / 1e6;
        if (mcm <= MAX_PLAUSIBLE_MCM) d.capacityMCM = round(mcm, 3);
        else rejected.push({ qid: id, name: d.name, valueMCM: mcm });
      }
      d.yearOpened = a.year != null ? a.year : a.incep != null ? a.incep : null;
    }
    log('  details ' + Math.min(i + BATCH, ids.length) + '/' + ids.length);
  }

  const list = [...dams.values()]
    .map(d => ({ ...d, name: d.name || d.qid }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: 'Wikidata SPARQL (query.wikidata.org): items P31/P279* of dam (Q12323), barrage (Q350495) or weir (Q1066997), country India (Q668), with P625',
    license: 'CC0 1.0 (Wikidata)',
    count: list.length,
    stats: {
      withHeight: list.filter(d => d.heightM != null).length,
      withLength: list.filter(d => d.lengthM != null).length,
      withCapacity: list.filter(d => d.capacityMCM != null).length,
      withRiver: list.filter(d => d.river != null).length,
      withYear: list.filter(d => d.yearOpened != null).length
    },
    notes: [
      'Numeric fields are null when Wikidata has no value; nothing is estimated.',
      'capacityMCM = P2234 (volume as quantity) on the dam or its reservoir (P4661 / P4792), SI-normalised, in million m^3.',
      'Capacity values above ' + MAX_PLAUSIBLE_MCM + ' MCM were rejected as unit errors: ' +
        (rejected.map(r => r.name + ' (' + r.qid + ', ' + Math.round(r.valueMCM) + ' MCM)').join('; ') || 'none'),
      'state = first P131 ancestor that is a state/UT of India, else first P131 label.',
      'yearOpened = P1619 (date of official opening) if present, else P571 (inception, which may be the construction start year).',
      'river = P206 (located in or next to body of water), else P706 (located in/on physical feature).'
    ],
    dams: list
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 1));
  if (path.resolve(outPath) === path.resolve(SNAPSHOT)) cache = snapshot;
  return snapshot;
}

module.exports = { listDams, refreshDams, SNAPSHOT };

if (require.main === module) {
  refreshDams(process.argv[2] || SNAPSHOT, { log: console.log })
    .then(s => console.log('saved', s.count, 'dams', JSON.stringify(s.stats), '\n' + s.notes[2]))
    .catch(e => { console.error(e); process.exit(1); });
}
