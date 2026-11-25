# Viva cheat-sheet
* **Why DBSCAN?** No need to fix the number of zones, finds arbitrary (irregular) shapes, labels noise, which suits terrain with steep risers and sensor faults.
* **Why standardise?** Degrees, percent and metres are on different scales; unscaled, elevation would dominate the distance.
* **How was ε chosen?** k-distance graph knee, then confirmed with the sensitivity grid.
* **Why add coordinates?** So zones are spatially contiguous; without them, distant but similar patches merge.
* **Why not use terrace boundaries as input?** They are the validation reference; using them for clustering would be circular.
* **What does IoU 0.79 mean?** 79 % overlap between delineated cultivable area and terrace area (synthetic data only).
* **Weaknesses?** Sensitive to ε; thresholds are assumptions; accuracy bounded by sensor spacing; synthetic demo is not field evidence.
* **Future work:** DEM raster input, field-measured data, per-crop suitability rules, HDBSCAN comparison.
* **How are zones classed suitable?** DBSCAN only groups. A separate module compares each cluster's mean slope/moisture/elevation with editable thresholds; the most limiting factor decides (FAO-style law of the minimum).
* **Which metrics and why?** Silhouette, Davies-Bouldin and Calinski-Harabasz need no reference; ARI/NMI/IoU/precision/recall need reference terrace boundaries, so they are only computed when those are loaded.
* **Why can DBSCAN look worse on ARI with coordinates?** Steep risers fragment into many small clusters; ARI counts every point, not just the terraces.
