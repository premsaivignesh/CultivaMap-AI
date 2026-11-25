import React, { useEffect } from "react";
import { Card, Stat, Button, Table, Empty, Notice, fmt } from "../components/ui.jsx";
import { GroupedBars, Legend } from "../components/charts.jsx";

export default function Validation({ dataset, validation, runValidation, busy, params, analysis }) {
  const m0 = analysis?.metrics;
  const v = validation;
  useEffect(() => {                       // run automatically the first time the page is opened with terraces loaded
    if (dataset.terraces && !validation && analysis && !busy.validate) runValidation();
  }, [dataset.terraces, validation, analysis]);   // eslint-disable-line react-hooks/exhaustive-deps
  const h = v?.headline;
  const series = [{ name: "IoU (cultivable vs not)", color: "#a3b04a" }, { name: "Mean terrace IoU (each terrace)", color: "#2f5d3a" }];
  const series2 = [{ name: "ARI vs terrace labels", color: "#6b7d2c" }, { name: "Silhouette", color: "#2f5d3a" }];

  return (
    <div className="stack">
      <Card title="Model evaluation" subtitle="Internal quality metrics need no reference data; ARI, IoU, precision and recall need reference terrace boundaries">
        {m0 && (
          <div className="grid stats">
            <Stat label="Silhouette" value={fmt(m0.silhouette, 3)} hint="separation, higher is better" />
            <Stat label="Davies–Bouldin" value={fmt(m0.davies_bouldin, 3)} hint="compactness, lower is better" />
            <Stat label="Calinski–Harabasz" value={fmt(m0.calinski_harabasz, 1)} hint="higher is better" />
            <Stat label="ARI" value={m0.ari != null ? fmt(m0.ari, 3) : "needs reference"} hint="labels vs terrace polygons" tone="amber" />
            <Stat label="NMI" value={m0.nmi != null ? fmt(m0.nmi, 3) : "needs reference"} hint="labels vs terrace polygons" tone="amber" />
          </div>
        )}
      </Card>

      {!dataset.terraces ? (
        <Empty title="No reference terrace boundaries loaded">Upload a terrace-boundary GeoJSON on the Dataset page (or load the demo dataset) to compute IoU, precision, recall, ARI and the method comparison. These cannot be computed meaningfully from unlabeled data.</Empty>
      ) : (
        <>
          <Card title="Validate against terrace boundaries" subtitle="Compares delineated zones and alternative clustering methods with the reference polygons on a common raster grid"
            actions={<Button busy={busy.validate} onClick={() => runValidation()}>{v ? "Re-run validation" : "Run validation"}</Button>}>
            {!v && <p className="muted">Click “Run validation” to use ε = {params.eps}, MinPts = {params.min_samples}.</p>}
          </Card>
          {v && (
            <>
              <div className="grid stats">
                <Stat label="IoU (union)" value={h.iou} hint="cultivable footprint vs terraces" tone="green" />
                <Stat label="Mean terrace IoU" value={h.mean_terrace_iou} hint={`${h["terraces_matched_iou_ge_0.5"]} of ${h.n_terraces} terraces matched (≥ 0.5)`} tone="green" />
                <Stat label="Precision / Recall" value={`${fmt(h.precision)} / ${fmt(h.recall)}`} hint={`F1 ${fmt(h.f1)}`} />
                <Stat label="Mean boundary error" value={h.mean_boundary_distance_m != null ? h.mean_boundary_distance_m + " m" : "–"} hint={`HD95 ${h.hausdorff95_m} m`} tone="amber" />
                <Stat label="Area" value={`${h.pred_area_ha} ha`} hint={`terraces: ${h.truth_area_ha} ha`} />
              </div>

              <div className="grid two">
                <Card title="Footprint agreement" subtitle="Same suitability rule and same raster delineation for every method">
                  <GroupedBars groups={v.methods.map((m) => ({ label: m.method, values: [m.iou, m.mean_terrace_iou] }))} series={series} />
                  <Legend items={series} />
                </Card>
                <Card title="Cluster-label agreement" subtitle="ARI against terrace labels, and silhouette">
                  <GroupedBars groups={v.methods.map((m) => ({ label: m.method, values: [Math.max(0, m.ari ?? 0), Math.max(0, m.silhouette ?? 0)] }))} series={series2} />
                  <Legend items={series2} />
                </Card>
              </div>

              <Card title="Comparison with alternative methods" subtitle="DBSCAN is the main method; K-Means, hierarchical clustering and a plain threshold rule are baselines">
                <Table dense columns={[
                  { key: "method", label: "Method" },
                  { key: "n_zones", label: "Zones", num: true },
                  { key: "noise_pct", label: "Noise %", num: true },
                  { key: "iou", label: "IoU", num: true },
                  { key: "mean_terrace_iou", label: "Terrace IoU", num: true },
                  { key: "precision", label: "Prec.", num: true }, { key: "recall", label: "Recall", num: true },
                  { key: "ari", label: "ARI", num: true, render: (r) => fmt(r.ari, 3) },
                  { key: "silhouette", label: "Silh.", num: true, render: (r) => fmt(r.silhouette, 3) },
                  { key: "davies_bouldin", label: "DB", num: true, render: (r) => fmt(r.davies_bouldin, 3) },
                  { key: "calinski_harabasz", label: "CH", num: true, render: (r) => fmt(r.calinski_harabasz, 0) },
                  { key: "mean_boundary_distance_m", label: "Bdry m", num: true, render: (r) => fmt(r.mean_boundary_distance_m) },
                ]} rows={v.methods} />
                <ul className="muted small top tight">{v.methods.map((m) => <li key={m.method}><b>{m.method}:</b> {m.description}</li>)}</ul>
              </Card>

              <Card title="Per-terrace agreement" subtitle="Best-matching delineated zone for each reference terrace">
                <Table dense columns={[
                  { key: "terrace", label: "Terrace" },
                  { key: "best_zone", label: "Best zone", render: (r) => r.best_zone ?? "–" },
                  { key: "iou", label: "IoU", num: true },
                  { key: "bar", label: "", render: (r) => <div className="bar"><div style={{ width: `${r.iou * 100}%` }} /></div> },
                ]} rows={h.per_terrace} />
              </Card>
              <Notice>{v.note}</Notice>
              <Card title="How to read these metrics">
                <ul className="tight small">
                  <li><b>IoU</b> = |zones ∩ terraces| / |zones ∪ terraces|. <b>Precision</b> = share of delineated area that lies on terraces; <b>recall</b> = share of terrace area that was found.</li>
                  <li><b>Mean terrace IoU</b> – every terrace is matched to its best zone; low values mean terraces were merged or split.</li>
                  <li><b>ARI / NMI</b> – agreement between cluster labels and the terrace each point lies in (points outside every terrace form one reference class). Methods that split the steep risers into many clusters lose ARI even if the terraces themselves are found well.</li>
                  <li><b>Silhouette, Davies–Bouldin, Calinski–Harabasz</b> – internal quality of the grouping, computed on non-noise points.</li>
                  <li><b>Boundary error</b> – symmetric mean distance between zone and terrace outlines; raster cell = {v.grid_cell_m} m.</li>
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
