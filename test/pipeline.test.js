'use strict';
/* End-to-end pipeline test on a real Indian dam (network required for first run; cached afterwards).
 * Dam location/height from the Wikidata snapshot; released storage is a user-style input (hypothetical). */
const assert = require('assert');
const { runPipeline } = require('../server/pipeline.js');
const dams = require('../server/data/dams.js');

(async () => {
  const d = dams.listDams().dams.find((x) => /^Hirakud/i.test(x.name));
  assert(d, 'Hirakud Dam missing from snapshot');
  const req = {
    dam: { qid: d.qid, name: d.name, lat: d.lat, lng: d.lng, river: d.river, state: d.state, heightM: d.heightM, storageMCM: null, source: d.source },
    config: { type: 'Dam Break', storageMCM: 300, reachKm: 30, bufferKm: 8, resolution: 250, duration: 180, maxParticles: 5000, preset: 'test' }
  };
  const t0 = Date.now();
  let last = -1;
  const meta = await runPipeline(req, (p) => { if (p.step !== last) { last = p.step; console.log(`  step ${p.step + 1}: ${p.stepName}`); } });
  console.log(`\nScenario ${meta.id} in ${((Date.now() - t0) / 1000).toFixed(1)} s, grid ${meta.grid.cols}×${meta.grid.rows} @ ${meta.grid.res} m`);
  ['sph', 'delft3d'].forEach((k) => {
    const K = meta.kpi[k], S = meta.stats[k];
    console.log(`  ${k.padEnd(8)} area ${K.area.toFixed(1)} km² · max depth ${K.maxDepth.toFixed(2)} m · vmax ${K.maxVel.toFixed(2)} m/s · villages ${K.villages} · pop ${K.population} · roads ${K.roads} · mass err ${(+S.massErrorPct).toFixed(2)}% · ${(S.runtimeMs / 1000).toFixed(1)} s`);
    assert(K.area > 1, `${k}: no inundation`);
    assert(Math.abs(+S.massErrorPct) < 5, `${k}: mass error too large`);
  });
  console.log('  OSM:', JSON.stringify(meta.osm));
  console.log('\nPIPELINE TEST PASSED');
})().catch((e) => { console.error('PIPELINE TEST FAILED:', e); process.exit(1); });
