"""Lightweight geospatial helpers (numpy + scipy only).

Zones are delineated on a raster grid: every grid cell takes the DBSCAN label of
its nearest sensor point (a Voronoi-style assignment limited by a maximum
distance). Boundaries therefore fall midway between points of different
clusters, and the raster masks are polygonised into GeoJSON.
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree


class Projector:
    """Local equirectangular projection (metres) around a reference point."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = float(lat0), float(lon0)
        self.kx = 111320.0 * math.cos(math.radians(self.lat0))
        self.ky = 110574.0

    def fwd(self, lon, lat):
        return (np.asarray(lon, float) - self.lon0) * self.kx, (np.asarray(lat, float) - self.lat0) * self.ky

    def inv(self, x, y):
        return self.lon0 + np.asarray(x, float) / self.kx, self.lat0 + np.asarray(y, float) / self.ky

    def info(self):
        return {"lat0": self.lat0, "lon0": self.lon0, "kx": self.kx, "ky": self.ky}


# ----------------------------------------------------------------- grid ----
class Grid:
    def __init__(self, bounds, n=240, pad=0.0):
        xmin, ymin, xmax, ymax = bounds
        xmin, ymin, xmax, ymax = xmin - pad, ymin - pad, xmax + pad, ymax + pad
        self.cell = max(xmax - xmin, ymax - ymin) / n
        self.x0, self.y0 = xmin, ymin
        self.W = int(math.ceil((xmax - xmin) / self.cell))
        self.H = int(math.ceil((ymax - ymin) / self.cell))
        xs = self.x0 + (np.arange(self.W) + 0.5) * self.cell
        ys = self.y0 + (np.arange(self.H) + 0.5) * self.cell
        gx, gy = np.meshgrid(xs, ys)
        self.px, self.py = gx.ravel(), gy.ravel()
        self.cell_area = self.cell ** 2

    @property
    def shape(self):
        return (self.H, self.W)


def ring_contains(ring, px, py):
    """Even-odd point-in-ring test (vectorised over points)."""
    ring = np.asarray(ring, float)
    inside = np.zeros(px.shape, bool)
    x1, y1, x2, y2 = ring[:-1, 0], ring[:-1, 1], ring[1:, 0], ring[1:, 1]
    for i in range(len(x1)):
        if y1[i] == y2[i]:
            continue
        cond = (y1[i] > py) != (y2[i] > py)
        if not cond.any():
            continue
        xint = (x2[i] - x1[i]) * (py[cond] - y1[i]) / (y2[i] - y1[i]) + x1[i]
        inside[cond] ^= px[cond] < xint
    return inside


def rasterize(polygons, grid: Grid):
    """polygons: list of lists of rings (first = outer, rest = holes), metric coords."""
    mask = np.zeros(grid.px.shape, bool)
    for rings in polygons:
        if not rings:
            continue
        m = ring_contains(rings[0], grid.px, grid.py)
        for hole in rings[1:]:
            m &= ~ring_contains(hole, grid.px, grid.py)
        mask |= m
    return mask.reshape(grid.shape)


def nearest_label_grid(xy, labels, grid: Grid, max_dist):
    """Label every cell with the cluster of its nearest point (-1 beyond max_dist)."""
    tree = cKDTree(xy)
    d, idx = tree.query(np.c_[grid.px, grid.py], k=1)
    out = np.asarray(labels)[idx].astype(int)
    out[d > max_dist] = -1
    return out.reshape(grid.shape)


def clean_mask(mask, grid: Grid, min_area=200.0, fill_area=400.0):
    """Remove specks and fill small holes (areas in m^2)."""
    m = ndimage.binary_closing(mask, structure=np.ones((3, 3)), iterations=1)
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)), iterations=1)
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab, index=np.arange(1, n + 1)) * grid.cell_area
        for k, s in enumerate(sizes, start=1):
            if s < min_area:
                m[lab == k] = False
    holes = ndimage.binary_fill_holes(m) & ~m
    hl, hn = ndimage.label(holes)
    if hn:
        hs = ndimage.sum(holes, hl, index=np.arange(1, hn + 1)) * grid.cell_area
        for k, s in enumerate(hs, start=1):
            if s <= fill_area:
                m[hl == k] = True
    return m


# ------------------------------------------------------------ polygonise ----
def _trace_rings(mask):
    """Boundary rings (grid-corner coords, CCW outer / CW holes) of a bool mask."""
    H, W = mask.shape
    P = np.pad(mask, 1, constant_values=False)
    c = P[1:-1, 1:-1]
    below = ~P[:-2, 1:-1] & c
    right = ~P[1:-1, 2:] & c
    above = ~P[2:, 1:-1] & c
    left = ~P[1:-1, :-2] & c
    edges = []
    for arr, (dx1, dy1, dx2, dy2) in (
        (below, (0, 0, 1, 0)), (right, (1, 0, 1, 1)), (above, (1, 1, 0, 1)), (left, (0, 1, 0, 0)),
    ):
        ii, jj = np.nonzero(arr)
        for i, j in zip(ii, jj):
            edges.append(((j + dx1, i + dy1), (j + dx2, i + dy2)))
    nxt = defaultdict(list)
    for a, b in edges:
        nxt[a].append(b)
    used = set()
    rings = []
    for a, b in edges:
        if (a, b) in used:
            continue
        used.add((a, b))
        ring = [a]
        cur = b
        ok = True
        while cur != a:
            ring.append(cur)
            cands = [w for w in nxt[cur] if (cur, w) not in used]
            if not cands:
                ok = False
                break
            w = cands[0]
            used.add((cur, w))
            cur = w
        if ok and len(ring) >= 4:
            ring.append(a)
            rings.append(np.array(ring, float))
    return rings


def _signed_area(r):
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.sum(x[:-1] * y[1:] - x[1:] * y[:-1]))


def _dp(points, tol):
    n = len(points)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        a, b = points[s], points[e]
        seg = points[s + 1:e]
        ab = b - a
        L = np.hypot(*ab)
        if L == 0:
            d = np.hypot(*(seg - a).T)
        else:
            d = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > tol:
            m = s + 1 + k
            keep[m] = True
            stack.append((s, m))
            stack.append((m, e))
    return points[keep]


def _simplify_ring(r, tol):
    pts = r[:-1]
    if len(pts) < 8:
        return r
    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    a = _dp(np.vstack([pts[:far + 1]]), tol)
    b = _dp(np.vstack([pts[far:], pts[:1]]), tol)
    out = np.vstack([a[:-1], b])
    return out if len(out) >= 4 else r


def _chaikin(r, iters=2):
    for _ in range(iters):
        p = r[:-1]
        q = np.roll(p, -1, axis=0)
        new = np.empty((2 * len(p), 2))
        new[0::2] = 0.75 * p + 0.25 * q
        new[1::2] = 0.25 * p + 0.75 * q
        r = np.vstack([new, new[:1]])
    return r


def mask_to_polygons(mask, grid: Grid, smooth=True):
    """Return list of polygons; each polygon = [outer_ring, hole_ring, ...] in metric coords."""
    rings = _trace_rings(mask)
    outers, holes = [], []
    for r in rings:
        proc = _simplify_ring(r, tol=0.8)
        if smooth:
            proc = _chaikin(proc, 2)
        proc = np.c_[grid.x0 + proc[:, 0] * grid.cell, grid.y0 + proc[:, 1] * grid.cell]
        (outers if _signed_area(r) > 0 else holes).append(proc)
    polys = [[o] for o in outers]
    for h in holes:
        pt = h[:1]
        best, best_area = None, None
        for k, o in enumerate(outers):
            if ring_contains(o, pt[:, 0], pt[:, 1])[0]:
                a = abs(_signed_area(o))
                if best is None or a < best_area:
                    best, best_area = k, a
        if best is not None:
            polys[best].append(h)
    return polys


def polygons_to_geojson_geometry(polys, proj: Projector):
    def conv(r):
        lon, lat = proj.inv(r[:, 0], r[:, 1])
        return [[round(float(a), 7), round(float(b), 7)] for a, b in zip(lon, lat)]
    coords = [[conv(r) for r in rings] for rings in polys]
    if len(coords) == 1:
        return {"type": "Polygon", "coordinates": coords[0]}
    return {"type": "MultiPolygon", "coordinates": coords}


# ------------------------------------------------------------- GeoJSON in ----
def geojson_to_polygons(gj, proj: Projector):
    """Parse Polygon / MultiPolygon features into metric polygons. Returns (list, per-feature names)."""
    feats = []
    if gj.get("type") == "FeatureCollection":
        feats = gj.get("features", [])
    elif gj.get("type") == "Feature":
        feats = [gj]
    elif gj.get("type") in ("Polygon", "MultiPolygon"):
        feats = [{"type": "Feature", "geometry": gj, "properties": {}}]
    else:
        raise ValueError("GeoJSON must be a FeatureCollection, Feature, Polygon or MultiPolygon.")
    out = []
    for k, f in enumerate(feats):
        g = f.get("geometry") or {}
        props = f.get("properties") or {}
        if g.get("type") == "Polygon":
            parts = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            parts = g["coordinates"]
        else:
            continue
        polys = []
        for part in parts:
            rings = []
            for ring in part:
                arr = np.asarray(ring, float)[:, :2]
                x, y = proj.fwd(arr[:, 0], arr[:, 1])
                r = np.c_[x, y]
                if not np.allclose(r[0], r[-1]):
                    r = np.vstack([r, r[:1]])
                rings.append(r)
            if rings:
                polys.append(rings)
        if polys:
            name = props.get("name") or props.get("id") or props.get("terrace_id") or f"T{len(out) + 1}"
            out.append({"id": str(name), "polygons": polys})
    if not out:
        raise ValueError("No Polygon/MultiPolygon features found in the GeoJSON.")
    return out


# --------------------------------------------------------------- metrics ----
def overlap_metrics(pred, truth):
    inter = float(np.logical_and(pred, truth).sum())
    union = float(np.logical_or(pred, truth).sum())
    p, t = float(pred.sum()), float(truth.sum())
    prec = inter / p if p else 0.0
    rec = inter / t if t else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return {"iou": inter / union if union else 0.0, "precision": prec, "recall": rec, "f1": f1}


def boundary_points(mask, grid: Grid):
    edge = mask & ~ndimage.binary_erosion(mask, structure=np.ones((3, 3)), border_value=0)
    ii, jj = np.nonzero(edge)
    return np.c_[grid.x0 + (jj + 0.5) * grid.cell, grid.y0 + (ii + 0.5) * grid.cell]


def boundary_distance(pred, truth, grid: Grid):
    """Symmetric mean boundary distance and 95th-percentile Hausdorff (metres)."""
    a, b = boundary_points(pred, grid), boundary_points(truth, grid)
    if len(a) == 0 or len(b) == 0:
        return {"mean_boundary_distance_m": None, "hausdorff95_m": None}
    da = cKDTree(b).query(a)[0]
    db = cKDTree(a).query(b)[0]
    return {"mean_boundary_distance_m": float((da.mean() + db.mean()) / 2),
            "hausdorff95_m": float(np.percentile(np.r_[da, db], 95))}
