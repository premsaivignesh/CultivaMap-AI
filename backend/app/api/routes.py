from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from backend.app.schemas.analysis_schema import Params
from backend.app.services import data_service as ds
from backend.app.services import db
from backend.app.services.report_service import build_pdf
from backend.ml import pipeline as pl

router = APIRouter()


def _bad(exc):
    return HTTPException(400, str(exc))


@router.get("/health")
def health():
    return {"status": "ok", "service": "CultivaMap AI"}


# ---------------------------------------------------------------- data ----
@router.get("/dataset")
def dataset():
    try:
        return ds.dataset_info()
    except ValueError as exc:
        raise _bad(exc) from exc


@router.get("/dataset/rows")
def dataset_rows(page: int = 1, page_size: int = 25, search: str = "", sort_by: str = "",
                 desc: bool = False, source: str = "processed"):
    return ds.rows_page(page, page_size, search, sort_by, desc, source)


@router.post("/dataset/sample")
def use_sample():
    try:
        ds.load_sample()
        return ds.dataset_info()
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/dataset/points")
async def upload_points(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a .csv file.")
    try:
        ds.load_points_bytes(await file.read(), file.filename)
        return ds.dataset_info()
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/dataset/terraces")
async def upload_terraces(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".geojson", ".json")):
        raise HTTPException(400, "Please upload a .geojson (or .json) file.")
    try:
        ds.load_terraces_bytes(await file.read(), file.filename)
        return ds.dataset_info()
    except ValueError as exc:
        raise _bad(exc) from exc


@router.delete("/dataset/terraces")
def remove_terraces():
    ds.STATE.clear_terraces()
    return ds.dataset_info()


# ------------------------------------------------------------ analysis ----
@router.post("/quality")
def quality(p: Params):
    try:
        ctx = ds.STATE.context(p.remove_outliers)
        return {"quality": ds.STATE.quality, "cleaning": ctx.drop}
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/kdistance")
def kdistance(p: Params):
    try:
        ctx = ds.STATE.context(p.remove_outliers)
        X, cols = pl.build_features(ctx.df, ctx.xy, p.use_coordinates, p.spatial_weight)
        return {**pl.k_distance(X, p.min_samples), "features": cols}
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/analyze")
def analyze(p: Params):
    try:
        with ds.LOCK:
            ctx = ds.STATE.context(p.remove_outliers)
            params = p.model_dump()
            res = pl.analyze(ctx, params, grid_n=p.grid_cells)
            ds.STATE.last = {"res": res, "ctx": ctx, "params": params}
            ds.STATE.last_validation = None
        df = ctx.df
        pts = {"id": df.point_id.astype(str).tolist(), "role": [int(r) for r in res["roles_arr"]], "slope": df.slope.round(2).tolist(),
               "moisture": df.moisture.round(2).tolist(), "elevation": df.elevation.round(1).tolist(),
               "cluster": [int(v) for v in res["labels"]]}
        if ctx.xy is not None:
            pts["lon"] = df.longitude.round(7).tolist()
            pts["lat"] = df.latitude.round(7).tolist()
        out = {k: v for k, v in res.items() if k not in ("labels", "masks", "grid", "roles_arr")}
        out["points"] = pts
        out["projection"] = ctx.proj.info() if ctx.proj else None
        out["cleaning"] = ctx.drop
        db.log_run("analysis", ds.STATE.name, params,
                   {"clusters": res["n_clusters"], "cultivable": res["n_cultivable_clusters"],
                    "noise_pct": res["noise_pct"], "area_ha": res.get("cultivable_area_ha"),
                    "silhouette": res["metrics"]["silhouette"], "ari": res["metrics"]["ari"]})
        return out
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/validate")
def validate(p: Params):
    try:
        with ds.LOCK:
            ctx = ds.STATE.context(p.remove_outliers)
            v = pl.validate(ctx, p.model_dump(), grid_n=p.grid_cells)
            ds.STATE.last_validation = v
        h = v["headline"]
        db.log_run("validation", ds.STATE.name, p.model_dump(),
                   {"iou": h["iou"], "mean_terrace_iou": h["mean_terrace_iou"],
                    "boundary_m": h["mean_boundary_distance_m"]})
        return v
    except ValueError as exc:
        raise _bad(exc) from exc


@router.post("/sensitivity")
def sensitivity(p: Params):
    try:
        ctx = ds.STATE.context(p.remove_outliers)
        return pl.sensitivity(ctx, p.model_dump())
    except ValueError as exc:
        raise _bad(exc) from exc


@router.get("/runs")
def runs():
    return {"runs": db.list_runs()}


# -------------------------------------------------------------- exports ----
def _last_or_run(p: Params):
    with ds.LOCK:
        last = ds.STATE.last
        if last is None:
            ctx = ds.STATE.context(p.remove_outliers)
            params = p.model_dump()
            last = {"res": pl.analyze(ctx, params, p.grid_cells), "ctx": ctx, "params": params}
            ds.STATE.last = last
        return last


def _attach(content, media, filename):
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/export/sample.csv")
def export_sample_csv():
    from backend.ml.sample import generate
    df, _ = generate()
    return _attach(df.to_csv(index=False), "text/csv", "sample_terrain.csv")


@router.get("/export/sample_terraces.geojson")
def export_sample_terraces():
    import json
    from backend.ml.sample import generate
    return _attach(json.dumps(generate()[1]), "application/geo+json", "sample_terraces.geojson")


@router.get("/export/points.csv")
def export_points():
    last = _last_or_run(Params())
    df = last["ctx"].df.copy()
    df["cluster"] = last["res"]["labels"]
    cult = {c["cluster"] for c in last["res"]["clusters"] if c["cultivable"]}
    suit = {c["cluster"]: c["suitability"] for c in last["res"]["clusters"]}
    df["point_role"] = [pl.ROLE_NAMES[int(r)] for r in last["res"]["roles_arr"]]
    df["suitability"] = [suit.get(int(c), "Noise") for c in df["cluster"]]
    df["cultivable_zone"] = [int(c in cult) for c in df["cluster"]]
    return _attach(df.to_csv(index=False), "text/csv", "cultivamap_points.csv")


@router.get("/export/zones.geojson")
def export_zones():
    import json
    last = _last_or_run(Params())
    z = last["res"]["zones"]
    if z is None:
        raise HTTPException(400, "Zones need latitude/longitude columns.")
    return _attach(json.dumps(z), "application/geo+json", "cultivamap_zones.geojson")


@router.get("/export/report.pdf")
def export_report():
    try:
        last = _last_or_run(Params())
        res, ctx, params = last["res"], last["ctx"], last["params"]
        if res["zones"] is None:
            raise ValueError("A report needs latitude/longitude columns.")
        X, _ = pl.build_features(ctx.df, ctx.xy, params["use_coordinates"], params["spatial_weight"])
        kd = pl.k_distance(X, params["min_samples"])
        val = ds.STATE.last_validation
        if val is None and ctx.terrace_defs:
            val = pl.validate(ctx, params, params["grid_cells"])
        pdf = build_pdf(ds.STATE.name, ctx, ds.STATE.quality, res, kd, val, ds.STATE.terrace_geojson,
                        ctx.proj, ds.dataset_info()["synthetic"])
        return _attach(pdf, "application/pdf", "cultivamap_report.pdf")
    except ValueError as exc:
        raise _bad(exc) from exc
