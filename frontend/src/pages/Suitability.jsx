import React from "react";
import { Card, Stat, Button, Table, SUIT, Empty } from "../components/ui.jsx";
import { StackedBar } from "../components/charts.jsx";
import { DEFAULT_PARAMS } from "../constants.js";

function Th({ label, value, onChange, step = 1, hint }) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <input type="number" step={step} value={value ?? ""} onChange={(e) => { const v = e.target.value; onChange(v === "" ? null : parseFloat(v)); }} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export default function Suitability({ params, setParams, analysis, runAnalysis, busy }) {
  const a = analysis;
  const set = (k) => (v) => setParams((p) => ({ ...p, [k]: v }));
  const apply = () => runAnalysis();
  return (
    <div className="stack">
      <div className="grid sidebyside">
        <Card title="Suitability thresholds" subtitle="Applied to each cluster's mean values. Edit to match your crop and region.">
          <h4>Slope (degrees)</h4>
          <div className="row gap">
            <Th label="Potentially suitable ≤" value={params.slope_good} onChange={set("slope_good")} />
            <Th label="Moderately suitable ≤" value={params.slope_ok} onChange={set("slope_ok")} />
          </div>
          <h4>Soil moisture (%)</h4>
          <div className="row gap">
            <Th label="Potentially suitable ≥" value={params.moist_good} onChange={set("moist_good")} />
            <Th label="Moderately suitable ≥" value={params.moist_ok} onChange={set("moist_ok")} />
          </div>
          <h4>Elevation range for the crop (m, optional)</h4>
          <div className="row gap">
            <Th label="Minimum" value={params.elev_min} onChange={set("elev_min")} />
            <Th label="Maximum" value={params.elev_max} onChange={set("elev_max")} />
          </div>
          <label className="check">
            <input type="checkbox" checked={params.include_moderate} onChange={(e) => set("include_moderate")(e.target.checked)} />
            Count “moderately suitable” zones as cultivable
          </label>
          <div className="row gap wrap top">
            <Button busy={busy.analyze} onClick={apply}>Apply & re-run</Button>
            <Button variant="ghost" onClick={() => { const p = { ...params, slope_good: DEFAULT_PARAMS.slope_good, slope_ok: DEFAULT_PARAMS.slope_ok, moist_good: DEFAULT_PARAMS.moist_good, moist_ok: DEFAULT_PARAMS.moist_ok, elev_min: null, elev_max: null, include_moderate: true }; setParams(p); runAnalysis(p); }}>Reset thresholds</Button>
          </div>
        </Card>
        <Card title="How suitability is decided" subtitle="DBSCAN finds dense groups; this module interprets them">
          <ol className="steps">
            <li>Each cluster's <b>mean slope</b> and <b>mean moisture</b> are compared with the thresholds on the left.</li>
            <li>The <b>most limiting factor</b> decides the class (the “law of the minimum” used in FAO-style land evaluation).</li>
            <li>If an elevation range is set and the cluster mean falls outside it, the class drops by one step.</li>
            <li>Noise points never form a zone.</li>
            <li>Classes: <b style={{ color: SUIT[2].color }}>Potentially suitable</b> · <b style={{ color: "#7d8a2a" }}>Moderately suitable</b> · <b style={{ color: "#a07a3a" }}>Less suitable</b>.</li>
          </ol>
          <div className="alert info">The default thresholds are illustrative, not authoritative. Replace them with values justified by agronomy references or local expert advice for your crop, and cite them in your report. Suitability here means “candidate”, not a field-verified decision.</div>
        </Card>
      </div>

      {!a ? <Empty title="No analysis yet">Run DBSCAN first.</Empty> : (
        <>
          <div className="grid stats">
            {[2, 1, 0].map((k) => (
              <Stat key={k} label={SUIT[k].name} value={(a.area_by_class_ha?.[SUIT[k].name] ?? 0) + " ha"}
                hint={`${a.clusters.filter((c) => c.suitability_class === k).length} clusters`} tone={k === 2 ? "green" : k === 1 ? "olive" : "amber"} />
            ))}
            <Stat label="Counted as cultivable" value={(a.cultivable_area_ha ?? 0) + " ha"} hint={`${a.n_cultivable_clusters} zones`} tone="green" />
          </div>
          <Card title="Area by suitability class">
            <StackedBar unit=" ha" items={[2, 1, 0].map((k) => ({ name: SUIT[k].name, value: a.area_by_class_ha?.[SUIT[k].name] ?? 0, color: SUIT[k].color }))} />
          </Card>
          <Card title="Cluster interpretation" subtitle="Why each cluster received its class">
            <Table dense columns={[
              { key: "cluster", label: "Cluster" },
              { key: "suitability", label: "Class", render: (r) => <span className="swatch-row"><i style={{ background: SUIT[r.suitability_class].color }} />{r.suitability}</span> },
              { key: "mean_slope", label: "Slope °", num: true }, { key: "mean_moisture", label: "Moisture %", num: true },
              { key: "mean_elevation", label: "Elevation m", num: true },
              { key: "limiting_factor", label: "Limiting factor" },
              { key: "area_ha", label: "Area ha", num: true }, { key: "n_points", label: "Points", num: true },
              { key: "cultivable", label: "Cultivable", render: (r) => <span className={"pill " + (r.cultivable ? "ok" : "no")}>{r.cultivable ? "yes" : "no"}</span> },
            ]} rows={[...a.clusters].sort((x, y) => y.suitability_class - x.suitability_class || y.n_points - x.n_points).slice(0, 25)} />
          </Card>
        </>
      )}
    </div>
  );
}
