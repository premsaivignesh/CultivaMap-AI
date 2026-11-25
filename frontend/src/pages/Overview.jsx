import React from "react";
import { Card, Stat, Notice, Button } from "../components/ui.jsx";
import MapPanel from "../components/MapPanel.jsx";
import { StackedBar } from "../components/charts.jsx";
import { SUIT } from "../components/ui.jsx";

export default function Overview({ dataset, analysis, validation, go, busy }) {
  const a = analysis;
  const h = validation?.headline;
  const objectives = [
    { n: 1, t: "Compile terrain slope, soil-moisture and elevation sensor data",
      ok: !!dataset, d: `${dataset.n_rows} observations loaded${dataset.has_coordinates ? " with coordinates" : ""}`, to: "data" },
    { n: 2, t: "Detect irregular, naturally bounded cultivable zones with DBSCAN",
      ok: !!a, d: a ? `${a.n_cultivable_clusters} cultivable zones · ${a.cultivable_area_ha ?? "–"} ha · ${a.noise_pct}% noise` : "run the analysis", to: "dbscan" },
    { n: 3, t: "Validate zones against existing terrace-farming boundaries",
      ok: !!h, d: h ? `IoU ${h.iou} · mean terrace IoU ${h.mean_terrace_iou} · boundary error ${h.mean_boundary_distance_m} m`
        : dataset.terraces ? "terrace boundaries loaded – run validation" : "upload terrace boundaries", to: "validation" },
  ];
  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Sensor observations" value={dataset.n_rows} hint={a ? `${a.n_points} used after cleaning` : ""} />
        <Stat label="Clusters detected" value={a?.n_clusters} hint={a ? `${a.n_cultivable_clusters} classed cultivable` : ""} tone="green" />
        <Stat label="Noise points" value={a ? a.noise_pct + "%" : null} hint={a ? `${a.noise_points} points` : ""} />
        <Stat label="Cultivable area" value={a?.cultivable_area_ha != null ? a.cultivable_area_ha + " ha" : null} hint="union of cultivable zones" tone="green" />
        <Stat label="Validation IoU" value={h ? h.iou : "–"} hint={h ? `terrace-level ${h.mean_terrace_iou}` : "not validated yet"} tone="amber" />
        <Stat label="Silhouette / DB" value={a ? `${a.metrics.silhouette ?? "–"} / ${a.metrics.davies_bouldin ?? "–"}` : "–"} hint="cluster quality" />
      </div>

      <div className="grid two">
        <Card title="Project objectives" subtitle="Status of each stated objective">
          <ol className="objectives">
            {objectives.map((o) => (
              <li key={o.n} className={o.ok ? "done" : ""}>
                <span className="obj-badge">{o.ok ? "✓" : o.n}</span>
                <div><b>{o.t}</b><div className="muted small">{o.d}</div></div>
                <Button variant="ghost" onClick={() => go(o.to)}>Open</Button>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Workflow" subtitle="How the application processes your data">
          <ol className="steps">
            <li><b>Data</b> – CSV of sensor points (+ optional terrace GeoJSON)</li>
            <li><b>Preprocessing</b> – quality checks, cleaning, standardisation</li>
            <li><b>DBSCAN</b> – k-distance guided ε / MinPts, noise detection</li>
            <li><b>Zones</b> – cultivability rule, raster delineation, polygons</li>
            <li><b>Validation</b> – IoU and boundary distance vs terraces, baselines</li>
            <li><b>Reports</b> – CSV, GeoJSON and PDF export</li>
          </ol>
        </Card>
      </div>

      {a?.area_by_class_ha && (
        <Card title="Land suitability by area" subtitle="Area of delineated zones per suitability class (hectares)">
          <StackedBar unit=" ha" items={[2, 1, 0].map((k) => ({ name: SUIT[k].name, value: a.area_by_class_ha[SUIT[k].name] ?? 0, color: SUIT[k].color }))} />
        </Card>
      )}

      <Card title="Cultivable zone preview" actions={<Button variant="ghost" onClick={() => go("map")}>Open full map</Button>}>
        {a?.zones && a.points.lon ? (
          <MapPanel engine="svg" analysis={a} terraces={dataset.terraces?.geojson} layers={{ zones: true, terraces: true, points: true, other: false }} height={380} />
        ) : busy.analyze ? <p className="muted">Running analysis…</p> : (
          <Notice>The map needs latitude/longitude columns in the CSV.</Notice>
        )}
      </Card>
    </div>
  );
}
