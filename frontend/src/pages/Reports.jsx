import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, Table, Button } from "../components/ui.jsx";

export default function Reports({ analysis, track, setParams, runAnalysis, go }) {
  const [runs, setRuns] = useState([]);
  useEffect(() => { track("runs", api.runs).then((r) => r && setRuns(r.runs)); }, [analysis, track]);

  const items = [
    { href: "/api/export/report.pdf", title: "PDF report", desc: "Statistics, DBSCAN settings, metrics, k-distance graph, zone map, comparison tables and limitations." },
    { href: "/api/export/points.csv", title: "Processed CSV", desc: "Every cleaned observation with cluster, point role, suitability class and cultivable flag." },
    { href: "/api/export/zones.geojson", title: "Zones (GeoJSON)", desc: "Zone polygons with statistics – opens in QGIS, ArcGIS or geojson.io." },
    { href: "/api/export/sample.csv", title: "Sample dataset", desc: "The synthetic demo CSV, handy as a template for the required columns." },
  ];
  const restore = (r) => { const p = { ...r.params }; setParams(p); runAnalysis(p).then(() => go("dbscan")); };

  return (
    <div className="stack">
      <div className="grid four">
        {items.map((i) => (
          <Card key={i.href} title={i.title}>
            <p className="muted small">{i.desc}</p>
            <a className="btn primary" href={i.href} download>Download</a>
          </Card>
        ))}
      </div>
      <Card title="Saved analysis history" subtitle="Every analysis and validation run is stored in SQLite (backend/data/cultivamap.db). Restore re-applies the parameters and re-runs.">
        <Table dense columns={[
          { key: "created", label: "Time" },
          { key: "kind", label: "Type" },
          { key: "dataset", label: "Dataset" },
          { key: "params", label: "ε / MinPts", render: (r) => `${r.params.eps} / ${r.params.min_samples}${r.params.use_coordinates ? " +xy" : ""}` },
          { key: "summary", label: "Result", render: (r) => Object.entries(r.summary).map(([k, v]) => `${k}: ${v ?? "–"}`).join(" · ") },
          { key: "act", label: "", render: (r) => r.kind === "analysis" ? <Button variant="ghost" onClick={() => restore(r)}>Restore</Button> : null },
        ]} rows={runs} />
        {runs.length === 0 && <p className="muted small top">No runs recorded yet.</p>}
      </Card>
    </div>
  );
}
