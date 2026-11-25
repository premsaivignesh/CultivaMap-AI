import React, { useState } from "react";
import { Card, Empty, Table, Button, SUIT, ROLE, clusterColor } from "../components/ui.jsx";
import MapPanel from "../components/MapPanel.jsx";

export default function ZoneMap({ analysis, dataset, runAnalysis, busy }) {
  const [layers, setLayers] = useState({ zones: true, terraces: true, points: true, other: false });
  const [colorBy, setColorBy] = useState("cluster");
  const [zoneBy, setZoneBy] = useState("suitability");
  const [engine, setEngine] = useState("leaflet");
  if (!analysis) return <Empty title="No analysis yet" action={<Button busy={busy.analyze} onClick={() => runAnalysis()}>Run DBSCAN</Button>}>Run DBSCAN to see the map.</Empty>;
  if (!analysis.zones || !analysis.points.lon) return <Empty title="Map unavailable">Add latitude and longitude columns to your CSV to draw zones.</Empty>;
  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const zones = analysis.clusters.filter((c) => c.cultivable).sort((a, b) => b.area_ha - a.area_ha);

  return (
    <div className="stack">
      <Card title="Interactive GIS map" subtitle="Polygons = delineated zones (irregular boundaries from clustered points). Red dashed = reference terrace boundaries."
        actions={
          <>
            <select value={zoneBy} onChange={(e) => setZoneBy(e.target.value)} aria-label="Colour zones by">
              <option value="suitability">Zones: suitability</option>
              <option value="cluster">Zones: cluster</option>
            </select>
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value)} aria-label="Colour points by">
              <option value="cluster">Points: cluster</option>
              <option value="role">Points: core / border / noise</option>
              <option value="slope">Points: slope</option>
              <option value="moisture">Points: moisture</option>
              <option value="elevation">Points: elevation</option>
            </select>
            <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Map engine">
              <option value="leaflet">Leaflet (online basemap)</option>
              <option value="svg">Offline schematic map</option>
            </select>
          </>
        }>
        <div className="row gap wrap layer-row">
          {[["zones", "Zone polygons"], ["other", "Non-cultivable clusters"], ["terraces", "Terrace boundaries"], ["points", "Sensor points"]].map(([k, l]) => (
            <label key={k} className="check inline"><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} disabled={k === "terraces" && !dataset.terraces} />{l}</label>
          ))}
        </div>
        <MapPanel key={engine} engine={engine} analysis={analysis} terraces={dataset.terraces?.geojson} layers={layers} colorBy={colorBy} zoneBy={zoneBy} height={560} />
        <div className="legend">
          {zoneBy === "suitability"
            ? [2, 1, 0].map((k) => <span key={k}><i style={{ background: SUIT[k].color }} />{SUIT[k].name}</span>)
            : zones.map((z) => <span key={z.cluster}><i style={{ background: clusterColor(z.cluster) }} />Zone {z.cluster}</span>)}
          {colorBy === "role" && [2, 1, 0].map((k) => <span key={"r" + k}><i style={{ background: ROLE[k].color, borderRadius: 99 }} />{ROLE[k].name} point</span>)}
          <span><i className="dash" />Terrace boundary</span>
        </div>
        {engine === "leaflet" && <p className="muted small top">The Leaflet basemap needs internet access. Without it the zones still draw on a plain background; switch to the offline map if needed.</p>}
      </Card>
      <Card title="Zone summary">
        <Table dense columns={[
          { key: "cluster", label: "Zone", render: (r) => <span className="swatch-row"><i style={{ background: SUIT[r.suitability_class].color }} />{r.cluster}</span> },
          { key: "suitability", label: "Suitability" },
          { key: "area_ha", label: "Area (ha)", num: true }, { key: "n_points", label: "Sensor points", num: true },
          { key: "mean_slope", label: "Slope °", num: true }, { key: "mean_moisture", label: "Moisture %", num: true },
          { key: "mean_elevation", label: "Elevation m", num: true },
        ]} rows={zones} />
      </Card>
    </div>
  );
}
