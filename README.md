# CultivaMap AI
**DBSCAN-Based Delineation of Irregular Cultivable Zones in Hilly Terrain Using Slope, Moisture and Elevation Features**

React + FastAPI web application. Sensor points (slope, soil moisture, elevation, lat/lon) are cleaned, standardised and clustered with
DBSCAN; clusters that satisfy a cultivability rule become irregular zone polygons, which are validated against terrace-farming
boundaries (IoU, boundary distance, baselines).

| Objective | Where it is done |
|---|---|
| 1. Compile slope / moisture / elevation sensor data | **Dataset** + **Preprocessing** pages |
| 2. DBSCAN irregular cultivable zones | **DBSCAN Analysis**, **Suitability** and **GIS Map** pages |
| 3. Validate against terrace boundaries | **Evaluation** page (IoU, precision/recall, ARI, boundary distance, K-Means / hierarchical / threshold baselines) |

## What is in version 2 (the six "professional" parts)
1. **DBSCAN analysis** – k-distance guidance, ε × MinPts comparison grid with ranked best combinations, core/border/noise points, cluster-wise mean ± std, per-cluster feature distributions.
2. **GIS map** – Leaflet map (street/satellite basemap) with sensor points, coloured clusters, noise shown separately, irregular zone polygons, terrace outlines; offline schematic map as fallback.
3. **Terrain suitability** – Potentially / Moderately / Less suitable per cluster from editable slope, moisture and elevation thresholds (limiting-factor rule).
4. **Evaluation** – Silhouette, Davies-Bouldin, Calinski-Harabasz, ARI, NMI, IoU, precision, recall, boundary distance; comparison with K-Means, hierarchical (Ward), threshold rule and DBSCAN without coordinates.
5. **Data & reports** – server-side paginated/searchable/sortable full dataset, processed CSV, GeoJSON, PDF report, sample dataset download, saved run history with Restore, dataset validation messages.
6. **UI & quality** – olive/green dashboard, responsive layout, tooltips, loading and error states, 13 automated tests.

## Run it (Windows, Anaconda Prompt)
You need Python 3.10+ and Node.js 18+.

```bat
cd CultivaMap_AI
conda create -n cultivamap_env python=3.11 -y
conda activate cultivamap_env
pip install -r backend\requirements.txt
```
**Terminal 1 – backend** (from the project root):
```bat
conda activate cultivamap_env
uvicorn backend.app.main:app --reload --port 8010
```
**Terminal 2 – frontend:**
```bat
cd frontend
npm install
npm run dev
```
Open http://localhost:5180. A synthetic demo hillside is loaded automatically, so every page has content immediately.

**One-terminal mode (for the demo/viva):** `cd frontend && npm install && npm run build`, then run only the backend and open
http://127.0.0.1:8010 – FastAPI serves the built UI. API docs: http://127.0.0.1:8010/docs

Tests: `pytest backend/tests -q`

## Using your own data
* **Points CSV** – required `slope` (degrees), `moisture` (%), `elevation` (m); optional `latitude`, `longitude`, `point_id`.
  Without lat/lon you still get clusters, but no zone polygons or validation.
* **Terrace boundaries** – GeoJSON Polygon/MultiPolygon features in lon/lat (WGS84). Digitise terrace treads in QGIS and export as GeoJSON.
  Boundaries are used **only for validation**, never as clustering input.
* Slope/moisture/elevation at points from a DEM or sensor logger: sample them to a CSV first (QGIS "Sample raster values").

## How it works
1. **Preprocessing** – drop missing/duplicate rows, remove impossible values (slope ∉ 0–90°, moisture ∉ 0–100 %) and |z| > 4 outliers, standardise.
2. **DBSCAN** – features: slope, moisture, elevation (+ x/y metres, optional, weight adjustable). ε guided by the k-distance graph; sensitivity grid over ε × MinPts.
3. **Suitability** – per cluster (mean values): slope ≤ 8° and moisture ≥ 22 % = potentially suitable; slope ≤ 15° and moisture ≥ 15 % = moderately suitable; otherwise less suitable (most limiting factor decides; optional elevation range lowers the class). Thresholds are illustrative defaults – edit them and cite sources for your crop. Noise is never a zone.
4. **Delineation** – each cell of a ~3 m grid takes the cluster of its nearest sensor point (within 2.5× point spacing); masks are cleaned and
   polygonised (simplified + smoothed) into GeoJSON. Boundaries fall midway between points of different clusters.
5. **Validation** – zone raster vs terrace raster: IoU, precision, recall, F1, mean boundary distance, HD95, per-terrace best-match IoU, and baselines
   (DBSCAN on terrain features only, K-Means, slope/moisture threshold) using the same rule and delineation.

## Project layout
```
backend/ml/geo.py        projection, raster, polygonise, IoU, boundary distance (numpy + scipy only)
backend/ml/pipeline.py   cleaning, features, k-distance, DBSCAN, zones, validation, sensitivity
backend/ml/sample.py     synthetic terraced hillside generator
backend/app/             FastAPI routes, state, SQLite run log, PDF report
frontend/src/            React pages + SVG map/charts (no heavy chart/map dependencies)
```

## Honest limitations (say these in your report)
* The Leaflet basemap needs internet and was written against the Leaflet 1.9 API but could not be run against the real package when this was built; the offline map and every other page were run in a browser. If the Leaflet map ever fails, the app falls back to the offline map automatically.
* ARI compares cluster labels with the terrace each point lies in. On the demo data, DBSCAN *without* coordinates scores a higher ARI (≈0.81) than DBSCAN with coordinates (≈0.40), because adding coordinates splits the steep riser points into many small clusters. Report this honestly and discuss it.
* The bundled dataset is **synthetic**. Its terraces come from the same model as the points, so the scores (IoU ≈ 0.79, mean boundary error ≈ 3.8 m)
  show the pipeline works, **not** that it works in the field. Re-run with real sensor data and surveyed terrace boundaries for findings.
* On the synthetic data, DBSCAN on terrain features alone also separates terraces (elevation steps differ). The advantage of adding coordinates
  is spatial compactness on real, noisier terrain – test both on your data.
* Terrace-level IoU is the fair comparison between methods; union IoU mostly reflects the cultivability rule and is similar for all of them.
* The slope/moisture thresholds are agronomic assumptions – justify them with literature for your crop.
* DEM / GeoTIFF raster ingestion is not included; sample rasters to CSV points instead.
* The app keeps one dataset per server session (single-user, local use).
