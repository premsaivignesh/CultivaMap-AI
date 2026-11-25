"""Synthetic terraced hillside (software-test data only, NOT field observations).

A 700 m x 580 m slope with 7 irregular, contour-following terraces. Each terrace has a flat
"tread" (cultivable) and a steep "riser". Sensor points are scattered randomly, so the
ground-truth tread polygons are known exactly and can be used to test the validation step.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

LAT0, LON0 = 32.1100, 76.5400          # arbitrary foothill location
KX, KY = 111320.0 * np.cos(np.radians(LAT0)), 110574.0
W, H = 700.0, 580.0
P, N_TERR, BASE = 70.0, 7, 40.0        # terrace period (m), count, offset


def _g(x):                              # contour meander
    return 35.0 * np.sin(x / 110.0) + 0.02 * x


def _width(x, t, frac):                 # tread width (m) at x for terrace t
    return frac[t] * P + 4.0 * np.sin(x / 45.0 + t)


def generate(n_points=1800, seed=42):
    rng = np.random.default_rng(seed)
    frac = rng.uniform(0.52, 0.68, N_TERR)
    tread_moist = np.array([30, 37, 27, 34, 18.5, 38, 31], float) + rng.uniform(-1.5, 1.5, N_TERR)
    x = rng.uniform(0, W, n_points)
    y = rng.uniform(0, H, n_points)
    v = y - _g(x) - BASE
    t = np.floor(v / P).astype(int)
    r = v - t * P
    tc = np.clip(t, 0, N_TERR - 1)
    w = _width(x, tc, frac)
    inside = (t >= 0) & (t < N_TERR)
    tread = inside & (r < w)
    riser = ~tread
    tslope = np.where(tc == 3, 10.5, 4.0)           # terrace 4 is steeper (moderately suitable)
    slope = np.where(tread, rng.normal(tslope, 1.4, n_points), rng.normal(32.0, 4.5, n_points))
    moist = np.where(tread, rng.normal(tread_moist[tc], 2.2, n_points), rng.normal(15.0, 3.5, n_points))
    level = 1180.0 + tc * 18.0
    rise = np.where(riser & inside, 18.0 * np.clip((r - w) / np.maximum(P - w, 1), 0, 1), 0.0)
    elev = level + rise + np.where(t < 0, -6.0, 0) + np.where(t >= N_TERR, 18.0, 0) + rng.normal(0, 0.8, n_points)
    slope = np.clip(slope, 0.5, 60)
    moist = np.clip(moist, 3, 60)
    lon, lat = LON0 + x / KX, LAT0 + y / KY
    df = pd.DataFrame({"point_id": [f"S{i + 1:04d}" for i in range(n_points)],
                       "latitude": lat.round(7), "longitude": lon.round(7),
                       "slope": slope.round(2), "moisture": moist.round(2), "elevation": elev.round(2)})
    # inject a few realistic sensor faults so the preprocessing page has something to report
    bad = rng.choice(n_points, 12, replace=False)
    df.loc[bad[:5], "moisture"] = np.nan
    df.loc[bad[5:8], "slope"] = [135.0, 98.0, 120.0]
    df.loc[bad[8:10], "moisture"] = [-4.0, 140.0]
    df = pd.concat([df, df.iloc[[bad[10]]]], ignore_index=True)      # duplicate record

    xs = np.linspace(0, W, 71)
    feats = []
    for k in range(N_TERR):
        lo = BASE + k * P + _g(xs)
        hi = lo + _width(xs, k, frac)
        ring = list(zip(xs, lo)) + list(zip(xs[::-1], hi[::-1]))
        ring.append(ring[0])
        coords = [[round(LON0 + a / KX, 7), round(LAT0 + b / KY, 7)] for a, b in ring]
        feats.append({"type": "Feature", "properties": {"name": f"Terrace {k + 1}"},
                      "geometry": {"type": "Polygon", "coordinates": [coords]}})
    return df, {"type": "FeatureCollection", "features": feats}


def write_sample(data_dir: Path):
    data_dir.mkdir(parents=True, exist_ok=True)
    df, gj = generate()
    df.to_csv(data_dir / "sample_terrain.csv", index=False)
    (data_dir / "sample_terraces.geojson").write_text(json.dumps(gj))
    return len(df)
