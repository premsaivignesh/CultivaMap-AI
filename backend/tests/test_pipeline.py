"""Run from the project root:  pytest backend/tests -q"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.ml import geo, pipeline as pl
from backend.ml.sample import generate

P = dict(eps=0.4, min_samples=5, use_coordinates=True, spatial_weight=1.0, slope_good=8, slope_ok=15, moist_good=22, moist_ok=15,
         elev_min=None, elev_max=None, include_moderate=True)


@pytest.fixture(scope="module")
def ctx():
    df, gj = generate()
    raw = pl.normalize_columns(df)
    clean, _ = pl.clean_points(raw)
    proj = geo.Projector(clean.latitude.mean(), clean.longitude.mean())
    return pl.Context(clean, proj, geo.geojson_to_polygons(gj, proj))


def test_quality_finds_injected_faults():
    df, _ = generate()
    q = pl.assess_quality(pl.normalize_columns(df))
    assert q["missing_or_non_numeric"]["moisture"] == 5
    assert q["duplicate_rows"] >= 1
    assert q["out_of_physical_range"]["slope"] >= 3


def test_cleaning_removes_faults():
    df, _ = generate()
    clean, drop = pl.clean_points(pl.normalize_columns(df))
    assert drop["missing_or_invalid"] == 5 and drop["kept"] < drop["input_rows"]
    assert clean.slope.between(0, 90).all() and clean.moisture.between(0, 100).all()


def test_missing_column_error():
    with pytest.raises(ValueError):
        pl.check_schema(pd.DataFrame({"slope": [1], "moisture": [2]}))


def test_dbscan_recovers_all_terraces(ctx):
    res = pl.analyze(ctx, P)
    assert res["n_cultivable_clusters"] == 7
    assert res["zones"]["features"]
    ev = pl.evaluate(res["masks"], ctx.terrace_masks(res["grid"]), res["grid"])
    assert ev["iou"] > 0.7 and ev["mean_terrace_iou"] > 0.7
    assert ev["terraces_matched_iou_ge_0.5"] == 7


def test_baselines_and_validation(ctx):
    v = pl.validate(ctx, P)
    names = [m["method"] for m in v["methods"]]
    assert len(names) == 5
    prop = v["methods"][0]
    km = next(m for m in v["methods"] if m["method"] == "K-Means")
    assert prop["mean_terrace_iou"] > km["mean_terrace_iou"]


def test_k_distance_monotone(ctx):
    X, _ = pl.build_features(ctx.df, ctx.xy, True, 1.0)
    kd = pl.k_distance(X, 5)
    d = kd["distances"]
    assert all(b >= a for a, b in zip(d, d[1:])) and kd["suggested_eps"] > 0


def test_sensitivity_grid(ctx):
    s = pl.sensitivity(ctx, P, eps_values=[0.3, 0.4], min_samples_values=[5])
    assert len(s["cells"]) == 2 and s["cells"][0]["iou"] is not None


def test_rasterize_and_iou_identity():
    g = geo.Grid([0, 0, 100, 100], n=100)
    sq = [[np.array([[10, 10], [60, 10], [60, 60], [10, 60], [10, 10]], float)]]
    m = geo.rasterize(sq, g)
    assert abs(m.sum() * g.cell_area - 2500) < 150
    assert geo.overlap_metrics(m, m)["iou"] == 1.0


def test_mask_polygon_roundtrip_area():
    g = geo.Grid([0, 0, 100, 100], n=100)
    m = np.zeros(g.shape, bool)
    m[20:60, 30:80] = True
    polys = geo.mask_to_polygons(m, g, smooth=False)
    assert len(polys) == 1
    a = abs(geo._signed_area(polys[0][0]))
    assert abs(a - m.sum() * g.cell_area) / a < 0.02


def test_bad_geojson():
    proj = geo.Projector(0, 0)
    with pytest.raises(ValueError):
        geo.geojson_to_polygons({"type": "FeatureCollection", "features": []}, proj)


def test_suitability_classes_and_roles(ctx):
    res = pl.analyze(ctx, P)
    classes = {c["suitability"] for c in res["clusters"]}
    assert {"Potentially suitable", "Moderately suitable", "Less suitable"} <= classes
    r = res["roles"]
    assert r["core"] + r["border"] + r["noise"] == res["n_points"]
    m = res["metrics"]
    assert m["davies_bouldin"] > 0 and m["calinski_harabasz"] > 0 and -1 <= m["ari"] <= 1


def test_suitability_rule_limiting_factor():
    c, lim = pl.suitability(4, 12, 1000, P)
    assert c == 0 and lim == "moisture"
    c2, _ = pl.suitability(4, 30, 1000, {**P, "elev_max": 900})
    assert c2 == 1                      # elevation above crop range lowers class by one


def test_validation_has_five_methods(ctx):
    v = pl.validate(ctx, P)
    assert len(v["methods"]) == 5 and all("ari" in m for m in v["methods"])
