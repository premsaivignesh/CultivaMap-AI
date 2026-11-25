"""PDF report (reportlab + matplotlib)."""
from datetime import datetime
from io import BytesIO

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle  # noqa: E402

from backend.ml import geo  # noqa: E402


def _rings(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        for k, ring in enumerate(poly):
            yield k, np.asarray(ring)


def map_png(ctx, res, terraces_gj, proj):
    fig, ax = plt.subplots(figsize=(7.2, 5.6), dpi=140)
    df = ctx.df
    lab = res["labels"]
    cult = {c["cluster"] for c in res["clusters"] if c["cultivable"]}
    for f in (res["zones"] or {"features": []})["features"]:
        is_c = f["properties"]["cultivable"]
        for k, r in _rings(f["geometry"]):
            x, y = proj.fwd(r[:, 0], r[:, 1])
            col = {2: "#2f6b3a", 1: "#a3b04a", 0: "#c9a66b"}[f["properties"]["suitability_class"]]
            if k == 0 and is_c:
                ax.fill(x, y, color=col, alpha=0.45, lw=0)
            ax.plot(x, y, color=col if is_c else "#bbb", lw=1.2 if is_c else 0.4)
    if terraces_gj:
        for f in terraces_gj["features"]:
            for _, r in _rings(f["geometry"]):
                x, y = proj.fwd(r[:, 0], r[:, 1])
                ax.plot(x, y, color="#c0392b", lw=1.1, ls="--")
    m = np.array([l in cult for l in lab])
    ax.scatter(ctx.xy[~m & (lab == -1), 0], ctx.xy[~m & (lab == -1), 1], s=2, c="#bbbbbb", label="noise")
    ax.scatter(ctx.xy[m, 0], ctx.xy[m, 1], s=3, c="#1b5e32", label="cultivable-zone points")
    ax.scatter(ctx.xy[~m & (lab != -1), 0], ctx.xy[~m & (lab != -1), 1], s=2, c="#e0a030", label="other clusters")
    ax.plot([], [], color="#c0392b", ls="--", label="terrace boundary")
    ax.set_aspect("equal"); ax.set_xlabel("East (m)"); ax.set_ylabel("North (m)")
    ax.legend(loc="upper right", fontsize=7, markerscale=3)
    ax.set_title("DBSCAN cultivable zones")
    buf = BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png"); plt.close(fig)
    buf.seek(0); return buf


def kdist_png(kd, eps):
    fig, ax = plt.subplots(figsize=(6, 3), dpi=140)
    ax.plot(kd["distances"], color="#1b5e32")
    ax.axhline(eps, color="#c0392b", ls="--", lw=1, label=f"eps = {eps}")
    ax.set_xlabel("points sorted by distance"); ax.set_ylabel(f"distance to {kd['k']}-th neighbour")
    ax.set_title("k-distance graph"); ax.legend(fontsize=8)
    buf = BytesIO(); fig.tight_layout(); fig.savefig(buf, format="png"); plt.close(fig)
    buf.seek(0); return buf


def _table(rows, widths=None):
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1b5e32")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8),
                           ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f6f3")])]))
    return t


def build_pdf(name, ctx, quality, res, kd, validation, terraces_gj, proj, synthetic):
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
                            topMargin=1.6 * cm, bottomMargin=1.6 * cm, title="CultivaMap AI report")
    ss = getSampleStyleSheet()
    S = []
    S.append(Paragraph("CultivaMap AI - Cultivable Zone Delineation Report", ss["Title"]))
    S.append(Paragraph("DBSCAN-based delineation of irregular cultivable zones in hilly terrain "
                       "(slope, soil moisture, elevation)", ss["Italic"]))
    S.append(Paragraph(f"Dataset: <b>{name}</b> &nbsp; | &nbsp; Generated: {datetime.now():%Y-%m-%d %H:%M}", ss["Normal"]))
    if synthetic:
        S.append(Paragraph("<font color='#c0392b'><b>Note:</b> this run uses SYNTHETIC demonstration data. "
                           "Results illustrate the method and are not field findings.</font>", ss["Normal"]))
    S.append(Spacer(1, 8))
    S.append(Paragraph("1. Data summary", ss["Heading2"]))
    rows = [["Variable", "Min", "Mean", "Max", "Std"]]
    for c, st in quality["stats"].items():
        rows.append([c, f"{st['min']:.2f}", f"{st['mean']:.2f}", f"{st['max']:.2f}", f"{st['std']:.2f}"])
    S.append(_table(rows))
    d = ctx.drop
    S.append(Paragraph(f"Rows in file: {d['input_rows']} - missing/invalid: {d['missing_or_invalid']}, duplicates: "
                       f"{d['duplicates']}, out-of-range: {d['out_of_range']}, statistical outliers: {d['z_outliers']}, "
                       f"<b>used: {d['kept']}</b>.", ss["Normal"]))
    p = res["params"]
    S.append(Paragraph("2. DBSCAN configuration and result", ss["Heading2"]))
    S.append(Paragraph(f"eps = {p['eps']}, MinPts = {p['min_samples']}, features = {', '.join(res['features_used'])} "
                       f"(standardised), spatial weight = {p['spatial_weight']}. Suitability (cluster means): slope &le; "
                       f"{p['slope_good']} deg and moisture &ge; {p['moist_good']} % = potentially suitable; slope &le; "
                       f"{p['slope_ok']} deg and moisture &ge; {p['moist_ok']} % = moderately suitable; otherwise less suitable "
                       f"(the most limiting factor decides).", ss["Normal"]))
    mt = res["metrics"]
    rl = res["roles"]
    S.append(Paragraph(f"Points: core {rl['core']}, border {rl['border']}, noise {rl['noise']}. Silhouette {mt['silhouette']}, "
                       f"Davies-Bouldin {mt['davies_bouldin']}, Calinski-Harabasz {mt['calinski_harabasz']}, ARI vs terraces {mt['ari']}.",
                       ss["Normal"]))
    S.append(Paragraph(f"Clusters: <b>{res['n_clusters']}</b> (cultivable: <b>{res['n_cultivable_clusters']}</b>), "
                       f"noise: {res['noise_points']} points ({res['noise_pct']}%), cultivable area: "
                       f"<b>{res.get('cultivable_area_ha', 'n/a')} ha</b>.", ss["Normal"]))
    rows = [["Cluster", "Points", "Slope", "Moisture", "Elev (m)", "Area (ha)", "Suitability"]]
    for c in res["clusters"]:
        if c["cultivable"] or c["n_points"] >= 40:
            rows.append([c["cluster"], c["n_points"], c["mean_slope"], c["mean_moisture"], c["mean_elevation"],
                         c.get("area_ha", "-"), c["suitability"]])
    S.append(_table(rows))
    S.append(Spacer(1, 6))
    S.append(Image(kdist_png(kd, p["eps"]), width=11 * cm, height=5.5 * cm))
    S.append(Paragraph("3. Zone map", ss["Heading2"]))
    S.append(Image(map_png(ctx, res, terraces_gj, proj), width=14.5 * cm, height=11.3 * cm))
    if validation:
        S.append(Paragraph("4. Validation against terrace boundaries", ss["Heading2"]))
        rows = [["Method", "Zones", "IoU", "Terrace IoU", "Prec.", "Recall", "ARI", "Silh.", "DB", "Bdry m"]]
        for m in validation["methods"]:
            rows.append([m["method"], m["n_zones"], m["iou"], m["mean_terrace_iou"], m["precision"], m["recall"],
                         m["ari"], m["silhouette"], m["davies_bouldin"], m["mean_boundary_distance_m"]])
        S.append(_table(rows))
        S.append(Paragraph("IoU (union) measures cultivable vs non-cultivable agreement; mean terrace IoU measures how "
                           "well each individual terrace is recovered as its own zone.", ss["Normal"]))
    S.append(Paragraph("Limitations", ss["Heading2"]))
    S.append(Paragraph("Clusters are statistical candidates. The cultivable rule (slope, moisture thresholds) is a "
                       "user-defined agronomic assumption. Zone boundaries come from nearest-sensor-point assignment on "
                       "a raster, so they are only as precise as the sensor spacing. Validate with surveyed terrace "
                       "boundaries before drawing agronomic conclusions.", ss["Normal"]))
    doc.build(S)
    return buf.getvalue()
