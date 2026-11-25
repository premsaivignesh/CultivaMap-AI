import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Card, Stat, Table, fmt, Notice } from "../components/ui.jsx";
import { Histogram } from "../components/charts.jsx";

const VARS = [
  { k: "slope", label: "Slope (°)", color: "#d9822b" },
  { k: "moisture", label: "Soil moisture (%)", color: "#3b7dd8" },
  { k: "elevation", label: "Elevation (m)", color: "#2f8f4e" },
];

export default function Preprocessing({ params, setParams, runAnalysis, track, dataset }) {
  const [q, setQ] = useState(null);

  useEffect(() => {
    let live = true;
    track("quality", () => api.quality(params)).then((r) => { if (live && r) setQ(r); });
    return () => { live = false; };
  }, [params.remove_outliers, dataset.name, dataset.n_rows]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) return <p className="muted pad">Assessing data quality…</p>;
  const { quality: dq, cleaning: c } = q;
  const issues = VARS.map((v) => ({
    variable: v.k, missing: dq.missing_or_non_numeric[v.k], range: dq.out_of_physical_range[v.k],
    outliers: dq.z_outliers_gt4[v.k], lo: dq.limits[v.k][0], hi: dq.limits[v.k][1],
  }));
  const stats = VARS.map((v) => ({ variable: v.k, ...dq.stats[v.k] }));
  const corr = dq.correlation;

  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Rows in file" value={c.input_rows} />
        <Stat label="Missing / invalid" value={c.missing_or_invalid} tone={c.missing_or_invalid ? "amber" : "green"} />
        <Stat label="Duplicates" value={c.duplicates} tone={c.duplicates ? "amber" : "green"} />
        <Stat label="Outliers removed" value={c.out_of_range + c.z_outliers} hint={params.remove_outliers ? "range + |z| > 4" : "outlier removal is off"} tone="amber" />
        <Stat label="Rows used" value={c.kept} tone="green" />
      </div>

      <Card title="Cleaning options" subtitle="Applied before scaling and clustering">
        <label className="check">
          <input type="checkbox" checked={params.remove_outliers}
            onChange={(e) => { const p = { ...params, remove_outliers: e.target.checked }; setParams(p); runAnalysis(p); }} />
          Remove physically impossible values (slope outside 0–90°, moisture outside 0–100 %) and extreme outliers (|z| &gt; 4)
        </label>
        <p className="muted small top">Rows with missing or non-numeric values and exact duplicates are always dropped. Features are then
          standardised (zero mean, unit variance) so that degrees, percent and metres contribute comparably to the DBSCAN distance.</p>
      </Card>

      <div className="grid three">
        {VARS.map((v) => (
          <Card key={v.k} title={v.label} subtitle="Distribution of valid readings">
            <Histogram {...dq.histograms[v.k]} label={v.label} color={v.color} />
          </Card>
        ))}
      </div>

      <div className="grid two">
        <Card title="Quality checks per variable">
          <Table dense columns={[
            { key: "variable", label: "Variable" },
            { key: "missing", label: "Missing", num: true },
            { key: "range", label: "Out of range", num: true, render: (r) => `${r.range} (${r.lo}–${r.hi})` },
            { key: "outliers", label: "|z| > 4", num: true },
          ]} rows={issues} />
        </Card>
        <Card title="Summary statistics">
          <Table dense columns={[
            { key: "variable", label: "Variable" },
            ...["min", "mean", "median", "max", "std"].map((k) => ({ key: k, label: k, num: true, render: (r) => fmt(r[k]) })),
          ]} rows={stats} />
          {Object.keys(corr).length > 0 && (
            <>
              <h4 className="top">Correlation</h4>
              <Table dense columns={[{ key: "v", label: "" }, ...VARS.map((v) => ({ key: v.k, label: v.k, num: true }))]}
                rows={VARS.map((r) => ({ v: r.k, ...Object.fromEntries(VARS.map((cn) => [cn.k, fmt(corr[cn.k][r.k])])) }))} />
            </>
          )}
        </Card>
      </div>
      {!dq.has_coordinates && <Notice tone="warn">No latitude/longitude columns: clustering works, but zone polygons and validation are unavailable.</Notice>}
    </div>
  );
}
