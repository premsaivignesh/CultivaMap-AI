import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Card, Button, Table, Notice, Stat } from "../components/ui.jsx";

function DataTable({ dataset, version }) {
  const [state, setState] = useState({ page: 1, search: "", sort: "", desc: false, source: "processed" });
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");

  const load = useCallback(() => {
    api.rows({ page: state.page, page_size: 15, search: state.search, sort_by: state.sort, desc: state.desc, source: state.source })
      .then(setData).catch((e) => setErr(e.message));
  }, [state]);
  useEffect(load, [load, version, dataset.name]);
  useEffect(() => { const t = setTimeout(() => setState((s) => ({ ...s, search: text, page: 1 })), 350); return () => clearTimeout(t); }, [text]);

  if (err) return <p className="muted">{err}</p>;
  if (!data) return <p className="muted">Loading rows…</p>;
  const cols = data.columns.map((c) => ({
    key: c, num: !["point_id", "role", "suitability"].includes(c),
    label: (
      <button className="th-btn" onClick={() => setState((s) => ({ ...s, sort: c, desc: s.sort === c ? !s.desc : false, page: 1 }))}>
        {c}{state.sort === c ? (state.desc ? " ▾" : " ▴") : ""}
      </button>
    ),
  }));
  return (
    <>
      <div className="row gap wrap toolbar">
        <input className="search" placeholder="Search any column…" value={text} onChange={(e) => setText(e.target.value)} />
        <select value={state.source} onChange={(e) => setState((s) => ({ ...s, source: e.target.value, page: 1 }))}>
          <option value="processed">Processed (cleaned + cluster labels)</option>
          <option value="raw">Raw upload</option>
        </select>
        <span className="muted small">{data.total} rows · page {data.page} of {data.pages}</span>
      </div>
      <Table dense columns={cols} rows={data.rows} />
      <div className="row gap top pager">
        <Button variant="ghost" disabled={data.page <= 1} onClick={() => setState((s) => ({ ...s, page: 1 }))}>« First</Button>
        <Button variant="ghost" disabled={data.page <= 1} onClick={() => setState((s) => ({ ...s, page: s.page - 1 }))}>‹ Prev</Button>
        <Button variant="ghost" disabled={data.page >= data.pages} onClick={() => setState((s) => ({ ...s, page: s.page + 1 }))}>Next ›</Button>
        <Button variant="ghost" disabled={data.page >= data.pages} onClick={() => setState((s) => ({ ...s, page: data.pages }))}>Last »</Button>
      </div>
    </>
  );
}

export default function DataPage({ dataset, loadDataset, busy, analysis }) {
  const pointsRef = useRef(null);
  const terrRef = useRef(null);
  const onPoints = (e) => { const f = e.target.files[0]; if (f) loadDataset(() => api.uploadPoints(f)); e.target.value = ""; };
  const onTerr = (e) => { const f = e.target.files[0]; if (f) loadDataset(() => api.uploadTerraces(f)); e.target.value = ""; };

  return (
    <div className="stack">
      <div className="grid stats">
        <Stat label="Dataset" value={<span className="small-val">{dataset.name}</span>} />
        <Stat label="Rows" value={dataset.n_rows} />
        <Stat label="Coordinates" value={dataset.has_coordinates ? "yes" : "no"} tone={dataset.has_coordinates ? "green" : "amber"} />
        <Stat label="Study extent" value={dataset.extent ? dataset.extent.area_ha + " ha" : "–"} hint={dataset.extent ? `${dataset.extent.width_m} × ${dataset.extent.height_m} m` : ""} />
        <Stat label="Terrace boundaries" value={dataset.terraces ? dataset.terraces.count : "none"} tone={dataset.terraces ? "green" : "amber"} />
      </div>

      <Card title="Dataset validation messages">
        <ul className="msgs">
          {dataset.messages.map((m, i) => <li key={i} className={m.level}><span className="dot" />{m.text}</li>)}
        </ul>
      </Card>

      <div className="grid two">
        <Card title="Sensor observations (CSV)" subtitle="Required: slope (°), moisture (%), elevation (m). Optional: latitude, longitude, point_id.">
          <input ref={pointsRef} type="file" accept=".csv" hidden onChange={onPoints} />
          <div className="row gap wrap">
            <Button busy={busy.data} onClick={() => pointsRef.current.click()}>Upload CSV</Button>
            <Button variant="ghost" busy={busy.data} onClick={() => loadDataset(api.useSample)}>Load demo dataset</Button>
            <a className="btn ghost" href="/api/export/sample.csv" download>Download sample CSV</a>
          </div>
          <p className="muted small top">Column names like lat/lon, slope_deg or soil_moisture are recognised automatically.</p>
        </Card>
        <Card title="Terrace-farming boundaries (GeoJSON)" subtitle="Reference polygons in lon/lat (WGS84). Used only for validation, never for clustering.">
          <input ref={terrRef} type="file" accept=".geojson,.json" hidden onChange={onTerr} />
          <div className="row gap wrap">
            <Button busy={busy.data} onClick={() => terrRef.current.click()} disabled={!dataset.has_coordinates}>Upload GeoJSON</Button>
            {dataset.terraces && <Button variant="ghost" onClick={() => loadDataset(api.removeTerraces)}>Remove boundaries</Button>}
            <a className="btn ghost" href="/api/export/sample_terraces.geojson" download>Sample GeoJSON</a>
          </div>
          {dataset.terraces
            ? <p className="small top">Loaded: <b>{dataset.terraces.name}</b> ({dataset.terraces.count} polygons)</p>
            : <p className="muted small top">No boundaries loaded – validation is disabled until you add them.</p>}
        </Card>
      </div>

      {dataset.synthetic && <Notice tone="warn">The demo dataset is synthetic: a generated terraced hillside (7 terraces) with a few injected sensor faults. Use it to test the software, not to claim field results.</Notice>}

      <Card title="Full dataset" subtitle="Server-side pagination over every row – search, sort, and switch between raw and processed data">
        <DataTable dataset={dataset} version={analysis ? analysis.n_points + "-" + analysis.n_clusters + "-" + analysis.noise_points : 0} />
      </Card>
    </div>
  );
}
