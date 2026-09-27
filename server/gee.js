'use strict';
/* Google Earth Engine near-real-time flood-mapping script generator.
 * The backend has no GEE credentials, so the script is generated for the scenario AOI and dates and
 * run by the analyst in the GEE Code Editor (or by a future service-account integration). */

function script({ bbox, eventDate, name, preDays = 30, postDays = 12, thresholdDb = -16 }) {
  const d = new Date(eventDate || Date.now());
  const iso = (x) => x.toISOString().slice(0, 10);
  const add = (n) => new Date(d.getTime() + n * 864e5);
  return `// FloodSim HADR — near-real-time flood extent (Sentinel-1 SAR change detection)
// Scenario: ${name}
// Generated ${new Date().toISOString()} — paste into https://code.earthengine.google.com and Run.
// Open data: Copernicus Sentinel-1 GRD, JRC Global Surface Water, SRTM (all in the GEE public catalogue).

var aoi = ee.Geometry.Rectangle([${bbox.west.toFixed(4)}, ${bbox.south.toFixed(4)}, ${bbox.east.toFixed(4)}, ${bbox.north.toFixed(4)}]);
var PRE  = ['${iso(add(-preDays))}', '${iso(add(-2))}'];
var POST = ['${iso(add(0))}', '${iso(add(postDays))}'];
var THRESHOLD_DB = ${thresholdDb};   // VV backscatter below this is treated as open water

function s1(range) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(aoi).filterDate(range[0], range[1])
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .select('VV');
}
var pre = s1(PRE), post = s1(POST);
print('Sentinel-1 scenes (pre, post):', pre.size(), post.size());

var smooth = function (img) { return img.focal_median(50, 'circle', 'meters'); };
var before = smooth(pre.mosaic()).clip(aoi);
var after  = smooth(post.mosaic()).clip(aoi);

var waterBefore = before.lt(THRESHOLD_DB);
var waterAfter  = after.lt(THRESHOLD_DB);

// remove permanent water and steep terrain (radar shadow / layover)
var permanent = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('seasonality').gte(10).unmask(0);
var slope = ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003'));
var flood = waterAfter.and(waterBefore.not()).and(permanent.not()).and(slope.lt(5)).selfMask();
// remove speckle-size patches (< 8 connected pixels)
flood = flood.updateMask(flood.connectedPixelCount(8, true).gte(8));

var areaKm2 = flood.multiply(ee.Image.pixelArea()).reduceRegion({ reducer: ee.Reducer.sum(), geometry: aoi, scale: 20, maxPixels: 1e10 });
print('Detected new flood water (km²):', ee.Number(areaKm2.get('VV')).divide(1e6));

Map.centerObject(aoi, 10);
Map.addLayer(before, {min: -25, max: 0}, 'Before (VV dB)', false);
Map.addLayer(after,  {min: -25, max: 0}, 'After (VV dB)', false);
Map.addLayer(flood, {palette: ['#22d3ee']}, 'Detected flood extent');

// Optional: compare with the FloodSim simulated extent (upload the exported SHP as a table asset)
// var sim = ee.FeatureCollection('users/<you>/floodsim_delft3d');
// var simImg = ee.Image(0).paint(sim, 1).selfMask();
// var inter = simImg.and(flood).multiply(ee.Image.pixelArea()).reduceRegion({reducer: ee.Reducer.sum(), geometry: aoi, scale: 30, maxPixels: 1e10});
// print('Overlap area (m²):', inter);

var vectors = flood.reduceToVectors({ geometry: aoi, scale: 30, geometryType: 'polygon', eightConnected: true, maxPixels: 1e10 });
Export.table.toDrive({ collection: vectors, description: 'floodsim_observed_flood_shp', fileFormat: 'SHP' });
Export.table.toDrive({ collection: vectors, description: 'floodsim_observed_flood_kml', fileFormat: 'KML' });
`;
}

module.exports = { script };
