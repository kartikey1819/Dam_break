# FloodSim HADR — Dam Break Inundation Modelling & Decision Support (SIH26161)

An end-to-end dam-break and flash-flood modelling framework for Humanitarian Assistance and Disaster Relief (HADR). Built for NTRO's SIH26161 problem statement.

Pick any Indian dam, or any point such as a landslide lake. The system then runs these steps:
- Fetches open terrain data and derives the downstream river course from it.
- Builds a breach hydrograph.
- Runs **two numerical flood solvers**: SPH particle and 2D shallow-water finite-volume.
- Maps depth, velocity, arrival time and hazard.
- Assesses impact on real OpenStreetMap villages, roads, bridges and facilities.
- Plans evacuation routes and ranks HADR priorities.
- Exports `.shp` / `.kml` / GeoJSON / raster grids and a Delft3D input deck.

A near-real-time module compares the results with NASA satellite imagery.

## Run it

Requires Node.js 22 or later. The project has **zero npm dependencies**, so no `npm install` is needed.

```bash
npm run dev          # starts backend + dashboard on http://localhost:8080
```

Open http://localhost:8080. The first run of a new dam downloads terrain tiles and OSM data (needs internet). Everything is then cached under `data/cache/`.

**Offline demo:** opening `public/index.html` directly (or hosting `public/` on GitHub Pages) works without the backend. It shows a packaged Kosi demo computed by a browser surrogate, clearly labelled DEMO.

```bash
npm test                         # solver, data and end-to-end pipeline tests
node test/ui.test.js             # headless UI test (uses installed Chrome/Edge)
node test/ui.test.js http://localhost:8080
```

## How it maps to the problem statement

| Deliverable | Implementation |
|---|---|
| i. Generalised modelling framework, dam break / river blockage, sudden surge, loss & damage, SPH + Delft3D | `server/pipeline.js`: any dam or site, three scenario types. **SPH**: `server/solvers/sph.js`, a depth-integrated SPH-SWE particle solver. **Delft3D**: `server/solvers/swe.js` solves the same 2DH shallow-water equations as Delft3D-FLOW (Godunov FV, HLL, wet/dry), and `server/delft3d.js` writes a complete Delft3D-FLOW input deck for each run. Loss and damage uses the JRC depth-damage function × exposure. |
| ii. Custom tool with different input datasets | Dam catalogue (Wikidata) or custom site; SRTM terrain (AWS Terrain Tiles) **or an uploaded ESRI ASCII DEM**; Froehlich breach hydrograph **or an uploaded hydrograph CSV**; adjustable breach, domain, resolution and duration. |
| iii. Dashboard GUI; large data; .shp/.kml output | 13-page Leaflet dashboard. Jobs run in worker threads. Rasters travel as packed typed arrays with gzip, and are cached on disk. Exports: SHP (zip, WGS84), KML, GeoJSON, ESRI ASCII rasters, PNG, PDF report. |
| iv. Near-real-time flood analysis through GEE with open data | NRT page shows real MODIS/VIIRS imagery by date (NASA GIBS). It runs water detection in the browser (MODIS 7-2-1) with change detection and IoU against the simulation. Each run generates a ready-to-run **Google Earth Engine Sentinel-1 SAR** flood-mapping script; GEE credentials are not connected. |
| v. Any Indian river & dam with open data | 767 Indian dams and barrages from Wikidata (CC0). Terrain from SRTM-derived tiles, river course from D8 flow on the DEM, exposure from OpenStreetMap (ODbL). |

## Architecture

```
public/            dashboard (HTML/CSS/JS, Leaflet, Chart.js) — also the offline demo
  js/analysis.js   impact, routing, HADR priority, loss & damage   (shared with server)
  js/geoexport.js  KML / SHP / GeoJSON / ASCII grid / ZIP writers  (shared with server)
server/
  index.js         HTTP server + REST API + job queue (worker threads), no database
  pipeline.js      DEM → flow path → breach → SPH + SWE → features → impact → store
  solvers/         sph.js (SPH-SWE particles), swe.js (2D finite-volume SWE)
  data/            dem.js (Terrarium tiles, ASCII DEM), osm.js (Overpass), dams.js (Wikidata),
                   hydrology.js (Froehlich breach, hydrograph, priority-flood + D8 flow path), png.js
  features.js      OSM → villages, groups, facilities, routable road graph, bridges, safe zones
  delft3d.js       Delft3D-FLOW deck writer (+ runner if DELFT3D_HOME is set)
  gee.js           Sentinel-1 GEE script generator
data/dams_india.json   Wikidata dam snapshot · data/cache, data/results (runtime, git-ignored)
```

REST API: `GET /api/health`, `GET /api/dams?q=`, `POST /api/breach`, `POST /api/dem` (ASCII grid), `POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/scenarios`, `GET /api/scenarios/:id`, and `GET /api/scenarios/:id/export/{kml|shp|geojson|asc|delft3d|gee}?model=sph|delft3d`.

## Honesty notes (read before presenting)

- **Real inputs:** Wikidata dam attributes, SRTM-derived terrain, OpenStreetMap villages/roads/facilities, NASA GIBS imagery.
- **Derived:**
  - The river course is a D8 flow path on the DEM.
  - Breach parameters come from empirical regressions (Froehlich 1995/2008, MacDonald & Langridge-Monopolis 1984). These are fitted to smaller dams, so treat them as a range for very large dams.
  - Safe zones are auto-selected high ground outside the simulated flood, **not** notified relief camps.
- **Missing or estimated data:**
  - Wikidata rarely has reservoir capacity (5 of 767 dams), so released storage is a user input.
  - Where OSM lacks a `population` tag, population uses place-type defaults, labelled ESTIMATE.
  - Gram Panchayat boundaries are not open data, so live runs group villages by nearest town.
- **Model results** come from in-house numerical solvers. The "Delft3D-class" solver is **not Delft3D**. Real Delft3D runs need a local Delft3D installation using the exported deck.
- **Not connected:** Google Earth Engine (script generated only) and the SMS/WhatsApp gateways (alert text only).
- Every dam-failure scenario is hypothetical decision-support output and must be validated by authorised agencies before operational use.
