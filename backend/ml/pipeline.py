"""CultivaMap AI core: preprocessing, DBSCAN, zone delineation, validation."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN, AgglomerativeClustering, KMeans
from sklearn.metrics import (adjusted_rand_score, calinski_harabasz_score, davies_bouldin_score,
                             normalized_mutual_info_score, silhouette_score)
from sklearn.preprocessing import StandardScaler

from backend.ml import geo

REQUIRED = ["slope", "moisture", "elevation"]
ALIASES = {"lat": "latitude", "lon": "longitude", "lng": "longitude", "long": "longitude",
           "slope_deg": "slope", "slope_degrees": "slope", "soil_moisture": "moisture",
           "moisture_pct": "moisture", "elev": "elevation", "altitude": "elevation",
           "id": "point_id", "pointid": "point_id"}
LIMITS = {"slope": (0, 90), "moisture": (0, 100), "elevation": (-500, 9000)}


# ------------------------------------------------------------------ data ----
def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df.rename(columns={k: v for k, v in ALIASES.items() if k in df.columns and v not in df.columns})


def check_schema(df: pd.DataFrame):
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError("Missing required column(s): " + ", ".join(missing) +
                         ". Required: slope, moisture, elevation (optional: latitude, longitude, point_id).")
    if df.empty:
        raise ValueError("The CSV contains no data rows.")
    if ("latitude" in df.columns) != ("longitude" in df.columns):
        raise ValueError("Provide both latitude and longitude columns, or neither.")


def _num(df, cols):
    out = df.copy()
    for c in cols:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


def assess_quality(raw: pd.DataFrame) -> dict:
    """Data-quality report on the raw upload (nothing is removed here)."""
    cols = REQUIRED + [c for c in ("latitude", "longitude") if c in raw.columns]
    df = _num(raw, cols)
    n = len(df)
    missing = {c: int(df[c].isna().sum()) for c in cols}
    oor = {c: int(((df[c] < LIMITS[c][0]) | (df[c] > LIMITS[c][1])).sum()) for c in REQUIRED}
    zout = {}
    for c in REQUIRED:
        s = df[c]
        ok = s.between(*LIMITS[c])
        mu, sd = s[ok].mean(), s[ok].std()
        zout[c] = int((((s - mu).abs() / sd) > 4).sum()) if sd and sd > 0 else 0
    dup_cols = [c for c in ("latitude", "longitude") + tuple(REQUIRED) if c in df.columns]
    stats = {}
    for c in REQUIRED:
        s = df[c].dropna()
        stats[c] = {"min": float(s.min()), "max": float(s.max()), "mean": float(s.mean()),
                    "median": float(s.median()), "std": float(s.std())} if len(s) else {}
    clean = df[REQUIRED].dropna()
    corr = clean.corr().round(3).to_dict() if len(clean) > 2 else {}
    hist = {}
    for c in REQUIRED:
        s = df[c].dropna()
        s = s[s.between(*LIMITS[c])]
        if len(s):
            counts, edges = np.histogram(s, bins=24)
            hist[c] = {"counts": counts.tolist(), "edges": [round(float(e), 3) for e in edges]}
    return {"n_rows": n, "columns": list(raw.columns), "has_coordinates": "latitude" in df.columns,
            "missing_or_non_numeric": missing, "out_of_physical_range": oor,
            "z_outliers_gt4": zout, "duplicate_rows": int(df.duplicated(subset=dup_cols).sum()),
            "stats": stats, "correlation": corr, "histograms": hist,
            "limits": {k: list(v) for k, v in LIMITS.items()}}


def clean_points(raw: pd.DataFrame, remove_outliers: bool = True):
    """Drop invalid rows. Returns (clean_df, dropped_counts)."""
    df = _num(raw, REQUIRED + ["latitude", "longitude"]).reset_index(drop=True)
    if "point_id" not in df.columns:
        df["point_id"] = [f"P{i + 1:04d}" for i in range(len(df))]
    n0 = len(df)
    need = REQUIRED + (["latitude", "longitude"] if "latitude" in df.columns else [])
    bad_na = df[need].isna().any(axis=1) | ~np.isfinite(df[need].to_numpy(float)).all(axis=1)
    df = df[~bad_na]
    n_na = int(bad_na.sum())
    dup = df.duplicated(subset=need)
    n_dup = int(dup.sum())
    df = df[~dup]
    n_rng = n_z = 0
    if remove_outliers:
        rng_bad = np.zeros(len(df), bool)
        for c in REQUIRED:
            rng_bad |= ~df[c].between(*LIMITS[c]).to_numpy()
        n_rng = int(rng_bad.sum())
        df = df[~rng_bad]
        z_bad = np.zeros(len(df), bool)
        for c in REQUIRED:
            sd = df[c].std()
            if sd > 0:
                z_bad |= ((df[c] - df[c].mean()).abs() / sd > 4).to_numpy()
        n_z = int(z_bad.sum())
        df = df[~z_bad]
    df = df.reset_index(drop=True)
    if len(df) < 10:
        raise ValueError("Fewer than 10 valid rows remain after cleaning.")
    return df, {"input_rows": n0, "missing_or_invalid": n_na, "duplicates": n_dup,
                "out_of_range": n_rng, "z_outliers": n_z, "kept": len(df)}


# -------------------------------------------------------------- features ----
def build_features(df, xy, use_coordinates=True, spatial_weight=1.0):
    X = StandardScaler().fit_transform(df[REQUIRED].to_numpy(float))
    cols = list(REQUIRED)
    if use_coordinates:
        if xy is None:
            raise ValueError("Coordinates requested but the dataset has no latitude/longitude.")
        c = xy - xy.mean(axis=0)
        c = c / (c.std() or 1.0)                  # one shared scale keeps the map aspect ratio
        X = np.c_[X, c * float(spatial_weight)]
        cols += ["x", "y"]
    return X, cols


def k_distance(X, min_samples):
    k = int(min(max(min_samples, 2), len(X) - 1))
    d = cKDTree(X).query(X, k=k)[0][:, k - 1]
    d = np.sort(d)
    # knee = point furthest from the chord joining the curve's ends
    xs = np.linspace(0, 1, len(d))
    ys = (d - d[0]) / ((d[-1] - d[0]) or 1.0)
    knee = int(np.argmax(ys * -1 + xs)) if len(d) else 0
    step = max(1, len(d) // 300)
    return {"k": k, "distances": [round(float(v), 4) for v in d[::step]],
            "knee_eps": round(float(d[knee]), 3),
            "suggested_eps": round(float(d[knee]) * 0.85, 3),   # just below the knee avoids chaining neighbours
            "knee_index": knee // step}


# ---------------------------------------------------------------- DBSCAN ----
CLASS_NAMES = {2: "Potentially suitable", 1: "Moderately suitable", 0: "Less suitable"}
ROLE_NAMES = {0: "noise", 1: "border", 2: "core"}


def run_dbscan(X, eps, min_samples):
    return run_dbscan_full(X, eps, min_samples)[0]


def run_dbscan_full(X, eps, min_samples):
    """Labels plus point roles (2 = core, 1 = border, 0 = noise)."""
    db = DBSCAN(eps=eps, min_samples=int(min_samples)).fit(X)
    roles = np.where(db.labels_ == -1, 0, 1)
    roles[db.core_sample_indices_] = 2
    return db.labels_, roles


def suitability(ms, mm, me, p):
    """Cluster-level land suitability from mean slope / moisture / elevation.

    The most limiting factor decides the class (FAO-style 'law of the minimum').
    Elevation outside the optional crop range lowers the class by one step.
    """
    s_cls = 2 if ms <= p["slope_good"] else 1 if ms <= p["slope_ok"] else 0
    m_cls = 2 if mm >= p["moist_good"] else 1 if mm >= p["moist_ok"] else 0
    cls = min(s_cls, m_cls)
    limiting = "slope" if s_cls < m_cls else "moisture" if m_cls < s_cls else ("slope and moisture" if cls < 2 else "none")
    lo, hi = p.get("elev_min"), p.get("elev_max")
    if (lo is not None and me < lo) or (hi is not None and me > hi):
        cls = max(0, cls - 1)
        limiting = "elevation" if limiting == "none" else limiting + " + elevation"
    return cls, limiting


def classify_clusters(df, labels, p):
    rows = []
    for k in sorted(int(v) for v in set(labels) if v != -1):
        m = labels == k
        sub = df[m]
        ms, mm, me = float(sub.slope.mean()), float(sub.moisture.mean()), float(sub.elevation.mean())
        cls, limiting = suitability(ms, mm, me, p)
        ok = cls == 2 or (cls == 1 and p.get("include_moderate", True))
        rows.append({"cluster": k, "n_points": int(m.sum()), "mean_slope": round(ms, 2),
                     "mean_moisture": round(mm, 2), "mean_elevation": round(me, 1),
                     "std_slope": round(float(sub.slope.std() or 0), 2),
                     "std_moisture": round(float(sub.moisture.std() or 0), 2),
                     "std_elevation": round(float(sub.elevation.std() or 0), 2),
                     "suitability_class": cls, "suitability": CLASS_NAMES[cls], "limiting_factor": limiting,
                     "cultivable": bool(ok),
                     "reason": "meets the suitability rule" if ok else f"{CLASS_NAMES[cls].lower()} ({limiting})"})
    return rows


def internal_metrics(X, labels):
    """Silhouette, Davies-Bouldin, Calinski-Harabasz on non-noise points (None if undefined)."""
    m = labels != -1
    out = {"silhouette": None, "davies_bouldin": None, "calinski_harabasz": None}
    if m.sum() > 2 and len(set(labels[m])) >= 2:
        try:
            out["silhouette"] = round(float(silhouette_score(X[m], labels[m])), 4)
            out["davies_bouldin"] = round(float(davies_bouldin_score(X[m], labels[m])), 4)
            out["calinski_harabasz"] = round(float(calinski_harabasz_score(X[m], labels[m])), 1)
        except Exception:
            pass
    return out


def external_metrics(ref, labels):
    """Agreement with reference terrace labels (needs terrace polygons)."""
    if ref is None:
        return {"ari": None, "nmi": None}
    return {"ari": round(float(adjusted_rand_score(ref, labels)), 4),
            "nmi": round(float(normalized_mutual_info_score(ref, labels)), 4)}


# ----------------------------------------------------------------- zones ----
def spacing(xy):
    d = cKDTree(xy).query(xy, k=4)[0][:, 3]
    return float(np.median(d))


def build_masks(xy, labels, cultivable_ids, grid, reach_factor=2.5):
    """Raster mask per cluster via nearest-point (Voronoi) assignment."""
    max_dist = reach_factor * spacing(xy)
    lab = geo.nearest_label_grid(xy, labels, grid, max_dist)
    masks = {}
    for k in cultivable_ids:
        m = geo.clean_mask(lab == k, grid)
        if m.any():
            masks[k] = m
    return masks


def _union(masks, shape):
    out = np.zeros(shape, bool)
    for m in masks.values():
        out |= m
    return out


def evaluate(masks_by_zone, terrace_masks, grid):
    """Overlap + boundary metrics for zone masks against terrace masks."""
    pred, truth = _union(masks_by_zone, grid.shape), _union(terrace_masks, grid.shape)
    res = {**geo.overlap_metrics(pred, truth), **geo.boundary_distance(pred, truth, grid)}
    res["pred_area_ha"] = round(float(pred.sum() * grid.cell_area / 1e4), 3)
    res["truth_area_ha"] = round(float(truth.sum() * grid.cell_area / 1e4), 3)
    per_terrace, per_zone = [], []
    for tid, tm in terrace_masks.items():
        best, bi = None, 0.0
        for zid, zm in masks_by_zone.items():
            i = geo.overlap_metrics(zm, tm)["iou"]
            if i > bi:
                best, bi = zid, i
        per_terrace.append({"terrace": tid, "best_zone": best, "iou": round(bi, 4)})
    for zid, zm in masks_by_zone.items():
        best, bi = None, 0.0
        for tid, tm in terrace_masks.items():
            i = geo.overlap_metrics(zm, tm)["iou"]
            if i > bi:
                best, bi = tid, i
        per_zone.append({"zone": zid, "best_terrace": best, "iou": round(bi, 4)})
    res["mean_terrace_iou"] = round(float(np.mean([x["iou"] for x in per_terrace])), 4) if per_terrace else None
    res["terraces_matched_iou_ge_0.5"] = int(sum(x["iou"] >= 0.5 for x in per_terrace))
    res["n_terraces"] = len(per_terrace)
    res["per_terrace"], res["per_zone"] = per_terrace, per_zone
    for k in ("iou", "precision", "recall", "f1"):
        res[k] = round(res[k], 4)
    for k in ("mean_boundary_distance_m", "hausdorff95_m"):
        if res[k] is not None:
            res[k] = round(res[k], 2)
    return res


class Context:
    """Everything derived from a dataset that analyses need."""

    def __init__(self, df, proj, terraces):
        self.df, self.proj = df, proj
        self.xy = None
        self.terrace_defs = terraces or []
        self._ref = None
        if "latitude" in df.columns:
            x, y = proj.fwd(df.longitude.to_numpy(), df.latitude.to_numpy())
            self.xy = np.c_[x, y]

    def grid(self, n):
        if self.xy is None:
            return None
        b = [self.xy[:, 0].min(), self.xy[:, 1].min(), self.xy[:, 0].max(), self.xy[:, 1].max()]
        return geo.Grid(b, n=n, pad=8.0)

    def terrace_masks(self, grid):
        return {t["id"]: geo.rasterize(t["polygons"], grid) for t in self.terrace_defs}

    def ref_labels(self):
        """Reference class per point: index of the terrace polygon containing it, else -1."""
        if self.xy is None or not self.terrace_defs:
            return None
        if self._ref is None:
            ref = np.full(len(self.xy), -1)
            for k, t in enumerate(self.terrace_defs):
                for rings in t["polygons"]:
                    m = geo.ring_contains(rings[0], self.xy[:, 0], self.xy[:, 1])
                    for h in rings[1:]:
                        m &= ~geo.ring_contains(h, self.xy[:, 0], self.xy[:, 1])
                    ref[m & (ref == -1)] = k
            self._ref = ref
        return self._ref


def analyze(ctx: Context, p: dict, grid_n=240):
    """Full run: DBSCAN -> cluster table -> suitability -> zones (GeoJSON)."""
    df = ctx.df
    X, cols = build_features(df, ctx.xy, p["use_coordinates"], p["spatial_weight"])
    labels, roles = run_dbscan_full(X, p["eps"], p["min_samples"])
    clusters = classify_clusters(df, labels, p)
    cult_ids = [c["cluster"] for c in clusters if c["cultivable"]]
    out = {"algorithm": "DBSCAN", "features_used": cols, "scaling": "StandardScaler",
           "params": p, "n_points": len(df), "n_clusters": len(clusters),
           "n_cultivable_clusters": len(cult_ids),
           "noise_points": int((labels == -1).sum()),
           "noise_pct": round(float((labels == -1).mean() * 100), 2),
           "roles": {"core": int((roles == 2).sum()), "border": int((roles == 1).sum()), "noise": int((roles == 0).sum())},
           "metrics": {**internal_metrics(X, labels), **external_metrics(ctx.ref_labels(), labels)},
           "clusters": clusters, "labels": labels, "roles_arr": roles, "zones": None, "masks": {}, "grid": None}
    out["silhouette_non_noise"] = out["metrics"]["silhouette"]
    grid = ctx.grid(grid_n)
    if grid is not None and clusters:
        masks = build_masks(ctx.xy, labels, [c["cluster"] for c in clusters], grid)
        feats = []
        by_class = {0: 0.0, 1: 0.0, 2: 0.0}
        for c in clusters:
            m = masks.get(c["cluster"])
            area = float(m.sum() * grid.cell_area) if m is not None else 0.0
            c["area_ha"] = round(area / 1e4, 3)
            by_class[c["suitability_class"]] += area / 1e4
            if m is None:
                continue
            polys = geo.mask_to_polygons(m, grid)
            if not polys:
                continue
            keys = ("cluster", "n_points", "mean_slope", "mean_moisture", "mean_elevation", "cultivable",
                    "area_ha", "reason", "suitability", "suitability_class", "limiting_factor")
            feats.append({"type": "Feature", "geometry": geo.polygons_to_geojson_geometry(polys, ctx.proj),
                          "properties": {k: c[k] for k in keys}})
        out["zones"] = {"type": "FeatureCollection", "features": feats}
        out["masks"] = {k: v for k, v in masks.items() if k in cult_ids}
        out["grid"] = grid
        out["cultivable_area_ha"] = round(sum(c.get("area_ha", 0) for c in clusters if c["cultivable"]), 3)
        out["area_by_class_ha"] = {CLASS_NAMES[k]: round(v, 3) for k, v in sorted(by_class.items(), reverse=True)}
    return out


def validate(ctx: Context, p: dict, grid_n=240):
    """Compare DBSCAN zones and alternative methods with the terrace boundaries."""
    if ctx.xy is None:
        raise ValueError("Validation needs latitude/longitude columns.")
    if not ctx.terrace_defs:
        raise ValueError("No terrace boundaries loaded. Upload a terrace GeoJSON on the Data page.")
    grid = ctx.grid(grid_n)
    tmasks = ctx.terrace_masks(grid)
    df, xy, ref = ctx.df, ctx.xy, ctx.ref_labels()
    methods = []

    def zone_eval(name, labels, desc, X):
        cl = classify_clusters(df, labels, p)
        ids = [c["cluster"] for c in cl if c["cultivable"]]
        masks = build_masks(xy, labels, ids, grid)
        empty = {"iou": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0, "mean_boundary_distance_m": None,
                 "hausdorff95_m": None, "n_terraces": len(tmasks), "per_terrace": [], "per_zone": [],
                 "mean_terrace_iou": 0.0, "terraces_matched_iou_ge_0.5": 0}
        r = evaluate(masks, tmasks, grid) if masks else empty
        r.update(method=name, description=desc, n_zones=len(masks), n_clusters=len(cl),
                 noise_pct=round(float((labels == -1).mean() * 100), 1),
                 **internal_metrics(X, labels), **external_metrics(ref, labels))
        return r

    X, _ = build_features(df, xy, p["use_coordinates"], p["spatial_weight"])
    methods.append(zone_eval("DBSCAN (proposed)", run_dbscan(X, p["eps"], p["min_samples"]),
                             "Main method, current parameters", X))
    Xf, _ = build_features(df, xy, False, 1.0)
    ef = max(0.05, k_distance(Xf, p["min_samples"])["suggested_eps"])
    methods.append(zone_eval("DBSCAN (terrain features only)", run_dbscan(Xf, ef, p["min_samples"]),
                             f"No coordinates; eps={ef} from k-distance", Xf))
    Xc, _ = build_features(df, xy, True, p["spatial_weight"])
    k = max(3, 2 * len(tmasks))
    methods.append(zone_eval("K-Means", KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(Xc),
                             f"k={k} (2 x terraces; favourable to the baseline)", Xc))
    methods.append(zone_eval("Hierarchical (Ward)", AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(Xc),
                             f"Agglomerative, k={k}", Xc))
    rule = np.where((df.slope <= p["slope_ok"]) & (df.moisture >= p["moist_ok"]), 0, -1)
    methods.append(zone_eval("Slope/moisture threshold", rule,
                             "Rule only: slope <= 'moderate' limit and moisture >= 'moderate' limit", X))
    return {"methods": methods, "headline": methods[0], "grid_cell_m": round(grid.cell, 2),
            "note": "ARI/NMI compare cluster labels with the terrace polygon each point lies in (outside = -1); "
                    "IoU/precision/recall compare the zone footprint with the terrace footprint. "
                    "The demo terraces are synthetic: use surveyed boundaries for research claims."}


def sensitivity(ctx: Context, p: dict, eps_values=None, min_samples_values=None):
    X, _ = build_features(ctx.df, ctx.xy, p["use_coordinates"], p["spatial_weight"])
    if eps_values is None:
        eps_values = [round(p["eps"] * f, 3) for f in (0.5, 0.7, 0.85, 1.0, 1.2, 1.5, 2.0)]
    if min_samples_values is None:
        min_samples_values = [3, 5, 8, 12, 20]
    grid = ctx.grid(110)
    tmasks = ctx.terrace_masks(grid) if (grid is not None and ctx.terrace_defs) else None
    truth = _union(tmasks, grid.shape) if tmasks else None
    ref = ctx.ref_labels()
    cells = []
    for ms in min_samples_values:
        for e in eps_values:
            labels = run_dbscan(X, e, ms)
            cl = classify_clusters(ctx.df, labels, p)
            ids = [c["cluster"] for c in cl if c["cultivable"]]
            cell = {"eps": e, "min_samples": ms, "n_clusters": len(cl), "n_cultivable": len(ids),
                    "noise_pct": round(float((labels == -1).mean() * 100), 1), "iou": None, "ari": None,
                    **{k: v for k, v in internal_metrics(X, labels).items() if k != "calinski_harabasz"}}
            if ref is not None:
                cell["ari"] = external_metrics(ref, labels)["ari"]
            if truth is not None:
                masks = build_masks(ctx.xy, labels, ids, grid) if ids else {}
                cell["iou"] = round(geo.overlap_metrics(_union(masks, grid.shape), truth)["iou"], 4)
            cells.append(cell)
    return {"eps_values": eps_values, "min_samples_values": min_samples_values, "cells": cells,
            "has_validation": tmasks is not None}
