# FloodSim HADR — Dam Break & Flood Inundation Decision Support (SIH26161 MVP)

A lightweight prototype command center for NTRO's SIH26161 problem statement. It covers the full scenario → simulation → impact → evacuation → priority → export → alert workflow on one packaged Indian demo scenario (Kosi River).

## Run it

Open `index.html` in Chrome or Edge by double-clicking it. There is no build step, no server, no database and nothing to install.

Leaflet, Chart.js and JSZip load from cdnjs, and the basemap tiles come from Esri. The first load needs internet. After that the browser usually serves the libraries from its cache, and all scenario data and analysis run locally.

Deep links work, for example `index.html#/evac` or `index.html#/models`.

## Scientific honesty — read before presenting

| Item | Status |
|---|---|
| River centreline | **REAL**: simplified from OpenStreetMap (© OSM contributors, ODbL) |
| Basemap tiles | **REAL** (Esri), visual context only |
| DEM | **DEMO**: procedurally generated synthetic terrain (SRTM/ASTER not connected) |
| Dam | **DEMO**: hypothetical structure; it does **not** represent the Kosi Barrage |
| Villages, panchayats, population, roads, bridges, facilities, safe zones | **DEMO**: synthetic |
| "SPH" and "Delft3D" results | **SIMULATED**: a browser-side parametric surrogate with model-specific calibration offsets. **No SPH or Delft3D solver runs.** |
| Satellite "after" image / observed water | **DEMO**: synthetic mask; Google Earth Engine is not connected |
| SMS / WhatsApp alerts | Text generation only; **nothing is sent** |

The surrogate (`js/engine.js`) combines a weir peak-discharge estimate, a Manning stage relation, downstream attenuation and a decaying front celerity. The hazard rating is HR = d·(v+0.5), after DEFRA/EA FD2320. Evacuation routing is time-aware: a road segment is used only if it can be cleared at least 10 min before simulated water on it exceeds 0.3 m.

## Structure

```
index.html        shell, landing page, script includes
css/styles.css    dark GIS command-center theme
js/i18n.js        English + Hindi strings (add more languages here)
js/data.js        demo scenario: river, dam, villages, panchayats, infra, roads, safe zones, presets
js/engine.js      grid, synthetic DEM, flood surrogate, impact, routing, HADR priority
js/map.js         Leaflet map view: 16 layers, 6 map modes, legend, measure, fullscreen, basemaps
js/export.js      KML, SHP (zip), GeoJSON, PNG map, printable report, alert text
js/views.js       Dashboard, Scenario Builder, Simulation, Model Comparison, Impact, NRT
js/views2.js      Evacuation, HADR Priority, What-if, Export, Data Sources, Architecture, Settings
js/app.js         state, simulation workflow, navigation, offline/cache, backend hook (FS.backend)
```

## Connecting a real backend later

Point `FS.backend.run(cfg, model)` in `js/app.js` at an API that runs SPH and Delft3D and returns gridded depth, arrival and velocity. The rest of the UI consumes the same result shape.
