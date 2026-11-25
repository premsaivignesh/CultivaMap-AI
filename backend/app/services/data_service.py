"""In-memory session state: current dataset, terraces, last analysis."""
import json
import threading
from io import BytesIO
from pathlib import Path

import numpy as np
import pandas as pd

from backend.ml import geo, pipeline as pl
from backend.ml.sample import write_sample

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
LOCK = threading.RLock()


class State:
    def __init__(self):
        self.name = None
        self.raw = None
        self.quality = None
        self.terrace_geojson = None
        self.terrace_name = None
        self.last = None          # last analysis (for exports)
        self.last_validation = None
        self._ctx = {}
        self._proj = None

    # -- loading ------------------------------------------------------------
    def set_points(self, raw: pd.DataFrame, name: str):
        raw = pl.normalize_columns(raw)
        pl.check_schema(raw)
        self.raw, self.name = raw, name
        self.quality = pl.assess_quality(raw)
        self.last = self.last_validation = None
        self._ctx = {}
        clean, _ = pl.clean_points(raw, True)
        if "latitude" in clean.columns:
            self._proj = geo.Projector(clean.latitude.mean(), clean.longitude.mean())
        else:
            self._proj = None
        if self.terrace_geojson is not None and self._proj is None:
            self.terrace_geojson = None

    def set_terraces(self, gj: dict, name: str):
        if self._proj is None:
            raise ValueError("Load a points CSV with latitude/longitude before adding terrace boundaries.")
        geo.geojson_to_polygons(gj, self._proj)           # validate
        self.terrace_geojson, self.terrace_name = gj, name
        self.last_validation = None
        self._ctx = {}

    def clear_terraces(self):
        self.terrace_geojson = self.terrace_name = None
        self.last_validation = None
        self._ctx = {}

    # -- context ----------------------------------------------------------------
    def context(self, remove_outliers=True):
        if self.raw is None:
            load_sample()
        key = bool(remove_outliers)
        if key not in self._ctx:
            df, drop = pl.clean_points(self.raw, key)
            terr = geo.geojson_to_polygons(self.terrace_geojson, self._proj) if self.terrace_geojson else []
            ctx = pl.Context(df, self._proj, terr)
            ctx.drop = drop
            self._ctx[key] = ctx
        return self._ctx[key]


STATE = State()


def load_sample():
    with LOCK:
        if not (DATA_DIR / "sample_terrain.csv").exists():
            write_sample(DATA_DIR)
        STATE.set_points(pd.read_csv(DATA_DIR / "sample_terrain.csv"), "Synthetic demo hillside")
        STATE.set_terraces(json.loads((DATA_DIR / "sample_terraces.geojson").read_text()),
                           "Synthetic demo terraces")


def load_points_bytes(data: bytes, filename: str):
    try:
        df = pd.read_csv(BytesIO(data))
    except Exception as exc:
        raise ValueError(f"Could not read CSV: {exc}") from exc
    with LOCK:
        STATE.set_points(df, filename)


def load_terraces_bytes(data: bytes, filename: str):
    try:
        gj = json.loads(data.decode("utf-8-sig"))
    except Exception as exc:
        raise ValueError(f"Could not read GeoJSON: {exc}") from exc
    with LOCK:
        STATE.set_terraces(gj, filename)


def rows_page(page=1, page_size=25, search="", sort_by="", descending=False, source="processed"):
    """Paginated view of the WHOLE dataset (processed = cleaned + cluster labels if analysed)."""
    with LOCK:
        if STATE.raw is None:
            load_sample()
        df = STATE.raw.copy()
        used = "raw"
        last = STATE.last
        if source == "processed" and last is not None:
            df = last["ctx"].df.copy()
            res = last["res"]
            df["cluster"] = res["labels"]
            df["role"] = [pl.ROLE_NAMES[int(r)] for r in res["roles_arr"]]
            cls = {c["cluster"]: c["suitability"] for c in res["clusters"]}
            df["suitability"] = [cls.get(int(c), "Noise") for c in res["labels"]]
            used = "processed"
        if search:
            mask = df.astype(str).apply(lambda col: col.str.contains(search, case=False, na=False)).any(axis=1)
            df = df[mask]
        if sort_by and sort_by in df.columns:
            df = df.sort_values(sort_by, ascending=not descending, na_position="last")
        page_size = max(5, min(int(page_size), 200))
        total = len(df)
        pages = max(1, -(-total // page_size))
        page = max(1, min(int(page), pages))
        chunk = df.iloc[(page - 1) * page_size: page * page_size].replace({np.nan: None})
        return {"columns": list(df.columns), "rows": chunk.to_dict("records"), "total": total,
                "page": page, "pages": pages, "page_size": page_size, "source": used}


def dataset_messages(q, has_terraces):
    msgs = []
    n = q["n_rows"]
    if n < 100:
        msgs.append({"level": "warn", "text": f"Only {n} observations: DBSCAN needs enough density; results may be unstable."})
    bad = sum(q["missing_or_non_numeric"].values())
    if bad:
        msgs.append({"level": "warn", "text": f"{bad} missing or non-numeric values found; those rows are dropped during cleaning."})
    oor = sum(q["out_of_physical_range"].values())
    if oor:
        msgs.append({"level": "warn", "text": f"{oor} physically impossible readings (slope outside 0-90 deg or moisture outside 0-100 %)."})
    if q["duplicate_rows"]:
        msgs.append({"level": "info", "text": f"{q['duplicate_rows']} duplicate rows will be removed."})
    if not q["has_coordinates"]:
        msgs.append({"level": "warn", "text": "No latitude/longitude columns: map, zone polygons and validation are unavailable."})
    elif not has_terraces:
        msgs.append({"level": "info", "text": "No terrace boundaries loaded: validation metrics (IoU, ARI) are disabled."})
    if not msgs:
        msgs.append({"level": "ok", "text": "Dataset passed all basic validation checks."})
    return msgs


def dataset_info():
    with LOCK:
        if STATE.raw is None:
            load_sample()
        q = STATE.quality
        prev = STATE.raw.head(12).replace({np.nan: None}).to_dict("records")
        terr = None
        if STATE.terrace_geojson:
            terr = {"name": STATE.terrace_name, "geojson": STATE.terrace_geojson,
                    "count": len(STATE.terrace_geojson.get("features", [])) or 1}
        proj = STATE._proj.info() if STATE._proj else None
        extent = None
        if STATE._proj is not None:
            ctx = STATE.context(True)
            b = ctx.xy
            extent = {"width_m": round(float(np.ptp(b[:, 0])), 1), "height_m": round(float(np.ptp(b[:, 1])), 1),
                      "area_ha": round(float(np.ptp(b[:, 0]) * np.ptp(b[:, 1]) / 1e4), 1)}
        return {"name": STATE.name, "n_rows": q["n_rows"], "columns": q["columns"], "preview": prev,
                "has_coordinates": q["has_coordinates"], "terraces": terr, "projection": proj,
                "extent": extent, "messages": dataset_messages(q, bool(STATE.terrace_geojson)), "synthetic": STATE.name == "Synthetic demo hillside"}
