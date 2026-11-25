import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { clusterColor, SUIT, ROLE } from "./ui.jsx";

function ramp(t) {
  const a = [238, 244, 222], b = [38, 82, 50];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`;
}

export default function LeafletMap({ analysis, terraces, layers, colorBy = "cluster", zoneBy = "suitability", height = 560 }) {
  const host = useRef(null);
  const map = useRef(null);
  const group = useRef(null);
  const fitted = useRef("");

  useEffect(() => {
    const m = L.map(host.current, { preferCanvas: true, zoomControl: true });
    const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
    street.addTo(m);
    L.control.layers({ "Street map": street, Satellite: sat }, {}, { position: "topright" }).addTo(m);
    L.control.scale({ imperial: false }).addTo(m);
    group.current = L.layerGroup().addTo(m);
    map.current = m;
    m.setView([0, 0], 2);
    const t = setTimeout(() => m.invalidateSize(), 250);
    return () => { clearTimeout(t); m.remove(); map.current = null; fitted.current = ""; };
  }, []);

  useEffect(() => {
    const m = map.current, g = group.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts = analysis.points;
    const bounds = [];

    if (layers.zones && analysis.zones) {
      const feats = analysis.zones.features.filter((f) => f.properties.cultivable || layers.other);
      const layer = L.geoJSON({ type: "FeatureCollection", features: feats }, {
        style: (f) => {
          const p = f.properties;
          const col = zoneBy === "suitability" ? SUIT[p.suitability_class].color : clusterColor(p.cluster);
          return { color: col, weight: 2, fillColor: col, fillOpacity: p.cultivable ? 0.4 : 0.12 };
        },
        onEachFeature: (f, l) => {
          const p = f.properties;
          l.bindTooltip(`<b>Zone ${p.cluster}</b> – ${p.suitability}<br/>${p.area_ha} ha · ${p.n_points} points<br/>slope ${p.mean_slope}° · moisture ${p.mean_moisture}% · elev ${p.mean_elevation} m`, { sticky: true });
        },
      });
      layer.addTo(g);
    }
    if (layers.terraces && terraces) {
      L.geoJSON(terraces, { style: { color: "#b5473a", weight: 2, dashArray: "6 5", fill: false }, interactive: false }).addTo(g);
    }
    if (layers.points) {
      const rng = (a) => [Math.min(...a), Math.max(...a)];
      const range = colorBy in { slope: 1, moisture: 1, elevation: 1 } ? rng(pts[colorBy]) : null;
      pts.lat.forEach((lat, i) => {
        let col;
        if (colorBy === "cluster") col = clusterColor(pts.cluster[i]);
        else if (colorBy === "role") col = ROLE[pts.role[i]].color;
        else col = ramp((pts[colorBy][i] - range[0]) / (range[1] - range[0] || 1));
        L.circleMarker([lat, pts.lon[i]], { radius: 3.2, color: "#ffffff", weight: 0.6, fillColor: col, fillOpacity: 0.95 })
          .bindTooltip(`${pts.id[i]} · cluster ${pts.cluster[i]}<br/>slope ${pts.slope[i]}° · moisture ${pts.moisture[i]}% · elev ${pts.elevation[i]} m`)
          .addTo(g);
      });
    }
    pts.lat.forEach((lat, i) => bounds.push([lat, pts.lon[i]]));
    const key = `${pts.id.length}-${pts.lat[0]}`;
    if (fitted.current !== key && bounds.length) {
      m.fitBounds(bounds, { padding: [20, 20] });
      fitted.current = key;
    }
  }, [analysis, terraces, layers, colorBy, zoneBy]);

  return <div ref={host} className="leaflet-host" style={{ height }} />;
}
