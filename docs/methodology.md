# Methodology
**Data.** N sensor points with slope s (deg), moisture m (%), elevation e (m) and position (lat, lon → local metres via equirectangular projection).
**Cleaning.** Remove NaN/non-numeric, duplicates, physically impossible values and |z|>4 outliers.
**Features.** z-score each of s, m, e. Optional coordinates are centred and divided by one shared std (keeps aspect ratio), then multiplied by a spatial weight.
**DBSCAN.** Core point: ≥ MinPts points within ε. ε chosen from the sorted k-distance curve (k = MinPts); the knee marks where noise begins. Using a value slightly below the knee avoids chaining neighbouring terraces. Robustness is shown by the ε × MinPts sensitivity grid.
**Zone classification.** Cluster mean slope ≤ S_max and mean moisture ≥ M_min.
**Polygons.** Grid labelled by nearest sensor point (max reach 2.5 × median 3rd-neighbour spacing) → per-cluster mask → closing/opening, drop specks < 200 m², fill holes < 400 m² → boundary tracing → Douglas–Peucker (0.8 cell) → Chaikin smoothing → GeoJSON.
**Validation.** Terrace polygons rasterised on the same grid. IoU = |A∩B|/|A∪B|; precision, recall, F1; boundary distance = symmetric mean nearest distance between mask edges; HD95; per-terrace best-zone IoU. Baselines: DBSCAN without coordinates (ε from k-distance), K-Means (k = 2×terraces), slope/moisture threshold.
