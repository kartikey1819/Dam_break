/* FloodSim HADR — demonstration dataset.
 * EVERYTHING in this file is DEMO / SYNTHETIC data for prototype demonstration.
 * Settlement names, populations, infrastructure, roads, safe zones and dam parameters
 * are illustrative placeholders. They are NOT census, survey or official records.
 * Positions of assets are defined in river coordinates:
 *   s = chainage downstream of the dam (km), d = lateral offset from river centreline (km, + = east bank)
 */
window.FS = window.FS || {};

FS.data = {
  scenarioLibrary: [
    { id: 'kosi-demo', river: 'Kosi', dam: 'Demo Dam (hypothetical structure)', region: 'North Bihar plains (approx. Kosi reach)', status: 'READY', note: 'Packaged demo scenario: OSM river centreline + synthetic DEM, settlements & road network.' },
    { id: 'ganga', river: 'Ganga', dam: '—', region: 'Uttarakhand / UP', status: 'NOT PACKAGED', note: 'Requires DEM, cross-sections & GIS layers to be loaded via backend.' },
    { id: 'godavari', river: 'Godavari', dam: '—', region: 'Maharashtra / Telangana / AP', status: 'NOT PACKAGED', note: 'Requires DEM, cross-sections & GIS layers to be loaded via backend.' },
    { id: 'narmada', river: 'Narmada', dam: '—', region: 'MP / Gujarat', status: 'NOT PACKAGED', note: 'Requires DEM, cross-sections & GIS layers to be loaded via backend.' },
    { id: 'mahanadi', river: 'Mahanadi', dam: '—', region: 'Chhattisgarh / Odisha', status: 'NOT PACKAGED', note: 'Requires DEM, cross-sections & GIS layers to be loaded via backend.' },
    { id: 'rishiganga', river: 'Rishi Ganga (lake-burst context)', dam: '—', region: 'Chamoli, Uttarakhand', status: 'NOT PACKAGED', note: 'Himalayan valley case — needs high-resolution DEM; not included in MVP.' }
  ],

  // Kosi River centreline (~81 km downstream of the demo dam site), simplified from OpenStreetMap
  // waterway ways 166018880, 45322552, 198730909. © OpenStreetMap contributors (ODbL).
  river: [
    [26.5276, 86.9284], [26.5211, 86.9101], [26.5039, 86.8897], [26.4919, 86.8894], [26.4571, 86.9019],
    [26.4361, 86.8797], [26.4368, 86.8725], [26.4308, 86.8685], [26.4290, 86.8593], [26.4190, 86.8550],
    [26.4141, 86.8440], [26.4012, 86.8362], [26.3942, 86.8255], [26.3756, 86.7865], [26.3745, 86.7758],
    [26.3664, 86.7757], [26.3587, 86.7351], [26.3413, 86.7099], [26.3234, 86.6993], [26.3132, 86.6729],
    [26.3056, 86.6682], [26.2888, 86.6668], [26.2762, 86.6524], [26.2737, 86.6426], [26.2785, 86.6291],
    [26.2565, 86.5968], [26.2458, 86.5987], [26.2276, 86.5913], [26.2097, 86.5631], [26.1794, 86.5573],
    [26.1662, 86.5481], [26.1596, 86.5360], [26.1504, 86.5293], [26.1147, 86.5190], [26.1084, 86.5147],
    [26.0970, 86.4905], [26.0701, 86.4802], [26.0482, 86.4629]
  ],

  dam: {
    name: 'Demo Dam (hypothetical)',
    lat: 26.5276, lng: 86.9284,
    type: 'Hypothetical structure placed at the upstream end of the demo reach. Parameters are illustrative and do NOT represent the Kosi Barrage (Bhimnagar) or any real dam.',
    crestLevel: 'Illustrative', storageMCM: 400
  },

  panchayats: [
    { id: 'GP01', name: 'Rampur GP', block: 'Demo Block A' },
    { id: 'GP02', name: 'Madhopur GP', block: 'Demo Block A' },
    { id: 'GP03', name: 'Chandpur GP', block: 'Demo Block B' },
    { id: 'GP04', name: 'Lakshmipur GP', block: 'Demo Block B' },
    { id: 'GP05', name: 'Nayanagar GP', block: 'Demo Block C' }
  ],

  villages: [
    { id: 'V01', name: 'Rampur', gp: 'GP01', s: 3, d: 2.2, pop: 2140 },
    { id: 'V02', name: 'Kishanpur', gp: 'GP01', s: 6, d: -2.8, pop: 1620 },
    { id: 'V03', name: 'Sonbarsa Tola', gp: 'GP01', s: 9, d: 5.5, pop: 980 },
    { id: 'V04', name: 'Madhopur', gp: 'GP02', s: 13, d: -1.8, pop: 3050 },
    { id: 'V05', name: 'Belahi', gp: 'GP02', s: 16, d: 3.0, pop: 1420 },
    { id: 'V06', name: 'Parsa', gp: 'GP02', s: 19, d: -6.5, pop: 860 },
    { id: 'V07', name: 'Chandpur', gp: 'GP03', s: 24, d: 1.6, pop: 2680 },
    { id: 'V08', name: 'Harinagar', gp: 'GP03', s: 28, d: -3.4, pop: 1930 },
    { id: 'V09', name: 'Dumari', gp: 'GP03', s: 31, d: 7.8, pop: 740 },
    { id: 'V10', name: 'Lakshmipur', gp: 'GP04', s: 37, d: -2.2, pop: 2410 },
    { id: 'V11', name: 'Basantpur', gp: 'GP04', s: 41, d: 4.2, pop: 1560 },
    { id: 'V12', name: 'Jagatpur', gp: 'GP04', s: 45, d: -8.5, pop: 1120 },
    { id: 'V13', name: 'Nayanagar', gp: 'GP05', s: 52, d: 2.6, pop: 2890 },
    { id: 'V14', name: 'Gopalpur', gp: 'GP05', s: 57, d: -4.0, pop: 1340 },
    { id: 'V15', name: 'Sikandarpur', gp: 'GP05', s: 63, d: 6.0, pop: 1010 },
    { id: 'V16', name: 'Rajpur Tola', gp: 'GP05', s: 68, d: -1.5, pop: 760 }
  ],

  // Critical infrastructure (synthetic). type: school | health | public | emergency | utility
  infra: [
    { id: 'SC01', type: 'school', name: 'Govt. Primary School, Rampur', s: 3.4, d: 2.5, village: 'V01' },
    { id: 'SC02', type: 'school', name: 'Govt. Middle School, Madhopur', s: 13.3, d: -2.2, village: 'V04' },
    { id: 'SC03', type: 'school', name: 'Govt. Primary School, Chandpur', s: 24.4, d: 1.9, village: 'V07' },
    { id: 'SC04', type: 'school', name: 'Govt. High School, Harinagar', s: 28.3, d: -3.8, village: 'V08' },
    { id: 'SC05', type: 'school', name: 'Govt. Middle School, Lakshmipur', s: 37.4, d: -2.6, village: 'V10' },
    { id: 'SC06', type: 'school', name: 'Govt. Primary School, Basantpur', s: 41.3, d: 4.6, village: 'V11' },
    { id: 'SC07', type: 'school', name: 'Govt. High School, Nayanagar', s: 52.4, d: 3.0, village: 'V13' },
    { id: 'HC01', type: 'health', name: 'PHC Madhopur', s: 12.6, d: -2.0, village: 'V04' },
    { id: 'HC02', type: 'health', name: 'Health Sub-Centre Chandpur', s: 23.7, d: 1.3, village: 'V07' },
    { id: 'HC03', type: 'health', name: 'APHC Lakshmipur', s: 36.6, d: -2.0, village: 'V10' },
    { id: 'HC04', type: 'health', name: 'PHC Nayanagar', s: 51.6, d: 2.3, village: 'V13' },
    { id: 'PB01', type: 'public', name: 'Panchayat Bhawan, Rampur', s: 2.7, d: 1.9, village: 'V01' },
    { id: 'PB02', type: 'public', name: 'Block Office (Demo Block B)', s: 26, d: -9, village: null },
    { id: 'PB03', type: 'public', name: 'Police Station (Demo)', s: 14, d: 9.5, village: null },
    { id: 'PB04', type: 'public', name: 'Panchayat Bhawan, Lakshmipur', s: 37.8, d: -1.9, village: 'V10' },
    { id: 'EM01', type: 'emergency', name: 'Fire & Rescue Post (Demo)', s: 40, d: 10, village: null },
    { id: 'EM02', type: 'emergency', name: 'SDRF Staging Point (Demo)', s: 22, d: 13.5, village: null },
    { id: 'UT01', type: 'utility', name: '33/11 kV Power Substation', s: 35, d: -5, village: null },
    { id: 'UT02', type: 'utility', name: 'Rural Water Supply Plant', s: 50, d: 3.5, village: 'V13' },
    { id: 'UT03', type: 'utility', name: 'Grain Storage Godown', s: 9, d: -4, village: 'V02' }
  ],

  safeZones: [
    { id: 'SZ1', name: 'Safe Zone 1 — High-ground relief camp', s: 8, d: 17, capacity: 4000 },
    { id: 'SZ2', name: 'Safe Zone 2 — School campus (upland)', s: 22, d: -17, capacity: 3500 },
    { id: 'SZ3', name: 'Safe Zone 3 — Raised embankment camp', s: 36, d: 17, capacity: 5000 },
    { id: 'SZ4', name: 'Safe Zone 4 — College ground (upland)', s: 50, d: -17, capacity: 4500 },
    { id: 'SZ5', name: 'Safe Zone 5 — Block HQ relief camp', s: 64, d: 16.5, capacity: 3000 }
  ],

  // Road network spec (synthetic). Built into a graph by the engine.
  roadSpec: {
    stations: [2, 10, 18, 26, 34, 42, 50, 58, 66],
    innerOffset: 3.6,   // km from river
    outerOffset: 10.5,
    bridges: [ // river crossings between inner roads
      { id: 'BR1', name: 'Bridge BR-1 (NH crossing, demo)', s: 18 },
      { id: 'BR2', name: 'Bridge BR-2 (SH crossing, demo)', s: 42 }
    ],
    minorBridges: [ // culvert/minor bridges on inner roads
      { id: 'BR3', name: 'Minor Bridge BR-3 (side channel)', s: 30, side: 1 },
      { id: 'BR4', name: 'Minor Bridge BR-4 (side channel)', s: 54, side: -1 }
    ]
  },

  presets: {
    small:  { label: 'Small Breach',  waterLevel: 18, breachWidth: 120, breachTime: 45, storage: 200 },
    medium: { label: 'Medium Breach', waterLevel: 22, breachWidth: 200, breachTime: 40, storage: 400 },
    severe: { label: 'Severe Breach', waterLevel: 32, breachWidth: 420, breachTime: 20, storage: 800 }
  }
};
