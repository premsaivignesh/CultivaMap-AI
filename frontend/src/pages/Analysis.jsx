import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Card, Stat, Button, Table, clusterColor, Notice, ROLE, SUIT, fmt } from "../components/ui.jsx";
import { KDistanceChart, ScatterPlot, Heatmap, StackedBar, ClusterProfile } from "../components/charts.jsx";
import { DEFAULT_PARAMS } from "../constants.js";

function Num({ label, value, onChange, min, max, step, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row gap">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
        <input type="number" min={min} max={max} step={step} value={value}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }} />
      </div>
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export default function Analysis({ params, setParams, analysis, runAnalysis, busy, track, dataset }) {
  const [kd, setKd] = useState(null);
  const [sens, setSens] = useState(null);
  const [metric, setMetric] = useState("n_clusters");
  const [sortKey, setSortKey] = useState("iou");
  const set = (k) => (v) => setParams((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const t = setTimeout(() => { track("kd", () => api.kdistance(params)).then((r) => r && setKd(r)); }, 300);
    return () => clearTimeout(t);
  }, [params.min_samples, params.use_coordinates, params.spatial_weight, params.remove_outliers, dataset.name, dataset.n_rows]); // eslint-disable-line

  const runSens = () => track("sens", () => api.sensitivity(params)).then((r) => r && setSens(r));
  const a = analysis;
  const ranked = useMemo(() => {
    if (!sens) return [];
    const key = sens.has_validation ? sortKey : "silhouette";
    return [...sens.cells].filter((c) => c[key] !== null && c[key] !== undefined)
      .sort((x, y) => (key === "davies_bouldin" ? x[key] - y[key] : y[key] - x[key])).slice(0, 8);
  }, [sens, sortKey]);
  const shown = a ? [...a.clusters].sort((x, y) => y.n_points - x.n_points).slice(0, 12) : [];

  return (
    <div className="stack">
      <div className="grid sidebyside">
        <Card title="DBSCAN parameters" subtitle="Features are standardised before clustering">
          <Num label={`ε (eps) = ${params.eps}`} value={params.eps} onChange={set("eps")} min={0.05} max={1.5} step={0.01} hint="Neighbourhood radius in standardised units." />
          <Num label={`MinPts = ${params.min_samples}`} value={params.min_samples} onChange={set("min_samples")} min={2} max={30} step={1} hint="Minimum points to form a dense core." />
          <label className="check">
            <input type="checkbox" checked={params.use_coordinates} onChange={(e) => set("use_coordinates")(e.target.checked)} />
            Include x/y coordinates (spatially compact zones)
          </label>
          {params.use_coordinates && (
            <Num label={`Spatial weight = ${params.spatial_weight}`} value={params.spatial_weight} onChange={set("spatial_weight")} min={0.1} max={3} step={0.1} hint="Higher = ground distance matters more." />
          )}
          <div className="row gap wrap top">
            <Button busy={busy.analyze} onClick={() => runAnalysis()}>Run DBSCAN</Button>
            <Button variant="ghost" onClick={() => { setParams(DEFAULT_PARAMS); runAnalysis(DEFAULT_PARAMS); }}>Reset</Button>
          </div>
        </Card>

        <Card title="k-distance graph" subtitle="Guidance for ε: choose near the knee where distances start to rise sharply"
          actions={kd && <Button variant="ghost" onClick={() => set("eps")(kd.suggested_eps)}>Use ε = {kd.suggested_eps}</Button>}>
          {kd ? <KDistanceChart data={kd} eps={params.eps} /> : <p className="muted">Computing…</p>}
          {kd && <p className="muted small">Knee at ε ≈ {kd.knee_eps} (k = {kd.k}). A value just below it ({kd.suggested_eps}) avoids chaining neighbouring terraces. Confirm with the parameter comparison below.</p>}
        </Card>
      </div>

      {a && (
        <>
          <div className="grid stats">
            <Stat label="Clusters" value={a.n_clusters} hint={`${a.n_cultivable_clusters} counted as cultivable`} tone="green" />
            <Stat label="Silhouette" value={fmt(a.metrics.silhouette, 3)} hint="higher is better (−1…1)" />
            <Stat label="Davies–Bouldin" value={fmt(a.metrics.davies_bouldin, 3)} hint="lower is better" />
            <Stat label="Calinski–Harabasz" value={fmt(a.metrics.calinski_harabasz, 1)} hint="higher is better" />
            <Stat label="ARI vs terraces" value={a.metrics.ari != null ? fmt(a.metrics.ari, 3) : "n/a"} hint={a.metrics.ari != null ? "needs reference boundaries" : "load terrace boundaries"} tone="amber" />
          </div>

          <div className="grid two">
            <Card title="Core, border and noise points" subtitle="Core = ≥ MinPts neighbours within ε · Border = in a cluster but not core · Noise = in no cluster">
              <StackedBar items={[2, 1, 0].map((k) => ({ name: ROLE[k].name, value: a.roles[ROLE[k].name.toLowerCase()], color: ROLE[k].color }))} unit=" pts" />
              <p className="muted small top">Silhouette, Davies–Bouldin and Calinski–Harabasz are computed on non-noise points only, so they flatter methods that discard many points – read them together with the noise share ({a.noise_pct}%).</p>
            </Card>
            <Card title="Feature space" subtitle="Coloured by cluster (grey = noise)">
              <ScatterPlot points={a.points} xKey="slope" yKey="moisture" xLabel="slope (°)" yLabel="moisture (%)" />
            </Card>
          </div>

          <Card title="Cluster-wise averages" subtitle={`Features: ${a.features_used.join(", ")}`}>
            <Table dense columns={[
              { key: "cluster", label: "ID", render: (r) => <span className="swatch-row"><i style={{ background: clusterColor(r.cluster) }} />{r.cluster}</span> },
              { key: "n_points", label: "Points", num: true },
              { key: "mean_slope", label: "Slope °", num: true, render: (r) => `${r.mean_slope} ± ${r.std_slope}` },
              { key: "mean_moisture", label: "Moisture %", num: true, render: (r) => `${r.mean_moisture} ± ${r.std_moisture}` },
              { key: "mean_elevation", label: "Elevation m", num: true, render: (r) => `${r.mean_elevation} ± ${r.std_elevation}` },
              { key: "area_ha", label: "Area ha", num: true },
              { key: "suitability", label: "Suitability", render: (r) => <span className="pill" style={{ background: SUIT[r.suitability_class].color + "33", color: "#1e3a2b" }}>{r.suitability}</span> },
            ]} rows={[...a.clusters].sort((x, y) => y.suitability_class - x.suitability_class || y.n_points - x.n_points)} />
          </Card>

          <Card title="Feature distribution per cluster" subtitle={`Mean ± standard deviation for the ${shown.length} largest clusters`}>
            <div className="grid three">
              {[["mean_slope", "std_slope", "slope (°)"], ["mean_moisture", "std_moisture", "moisture (%)"], ["mean_elevation", "std_elevation", "elevation (m)"]].map(([m, s, l]) => (
                <div key={m}><h4>{l}</h4><ClusterProfile clusters={shown} mean={m} std={s} label={l} colorOf={(c) => clusterColor(c.cluster)} /></div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card title="Parameter comparison" subtitle="Re-runs DBSCAN over a grid of ε and MinPts (current setting outlined in red)"
        actions={
          <>
            {sens && (
              <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Heat-map metric">
                <option value="n_clusters">Clusters</option>
                <option value="noise_pct">Noise %</option>
                <option value="silhouette">Silhouette</option>
                {sens.has_validation && <option value="iou">IoU vs terraces</option>}
                {sens.has_validation && <option value="ari">ARI vs terraces</option>}
              </select>
            )}
            <Button busy={busy.sens} onClick={runSens}>{sens ? "Refresh" : "Run comparison"}</Button>
          </>
        }>
        {sens ? (
          <div className="grid two">
            <Heatmap sens={sens} field={metric} current={{ eps: params.eps, min_samples: params.min_samples }} />
            <div>
              <div className="row gap between">
                <h4>Best combinations</h4>
                {sens.has_validation && (
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Rank by">
                    <option value="iou">rank by IoU</option><option value="ari">rank by ARI</option><option value="silhouette">rank by silhouette</option>
                  </select>
                )}
              </div>
              <Table dense columns={[
                { key: "eps", label: "ε", num: true }, { key: "min_samples", label: "MinPts", num: true },
                { key: "n_clusters", label: "Clusters", num: true }, { key: "noise_pct", label: "Noise %", num: true },
                { key: "silhouette", label: "Silh.", num: true, render: (r) => fmt(r.silhouette, 3) },
                { key: "iou", label: "IoU", num: true, render: (r) => fmt(r.iou, 3) },
                { key: "use", label: "", render: (r) => <button className="link-btn" onClick={() => setParams((p) => ({ ...p, eps: r.eps, min_samples: r.min_samples }))}>use</button> },
              ]} rows={ranked} />
            </div>
          </div>
        ) : <p className="muted">Shows how the number of clusters, noise share and agreement change with ε and MinPts — evidence for choosing the final parameters.</p>}
        {sens && !sens.has_validation && <Notice>Load terrace boundaries to also rank by IoU and ARI.</Notice>}
      </Card>
    </div>
  );
}
