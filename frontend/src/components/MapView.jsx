import React, { useEffect, useMemo, useRef, useState } from "react";
import { clusterColor, SUIT, ROLE } from "./ui.jsx";

function ramp(t) {
  const a = [244, 238, 205], b = [20, 94, 56];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`;
}

function ringPath(r, proj) {
  return "M" + r.map(([lon, lat]) => `${((lon - proj.lon0) * proj.kx).toFixed(1)},${(-(lat - proj.lat0) * proj.ky).toFixed(1)}`).join("L") + "Z";
}
function geomPath(g, proj) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.map((p) => p.map((r) => ringPath(r, proj)).join("")).join("");
}

export default function MapView({ analysis, terraces, layers, colorBy = "cluster", zoneBy = "suitability", height = 520 }) {
  const proj = analysis.projection;
  const pts = analysis.points;
  const [hover, setHover] = useState(null);
  const drag = useRef(null);

  const data = useMemo(() => {
    const xs = pts.lon.map((v) => (v - proj.lon0) * proj.kx);
    const ys = pts.lat.map((v) => -(v - proj.lat0) * proj.ky);
    const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const range = (a) => [Math.min(...a), Math.max(...a)];
    return { xs, ys, b, ranges: { slope: range(pts.slope), moisture: range(pts.moisture), elevation: range(pts.elevation) } };
  }, [pts, proj]);

  const full = useMemo(() => {
    const { b } = data, pad = 25;
    return { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad };
  }, [data]);
  const [view, setView] = useState(null);
  const v = view || full;

  const zonePaths = useMemo(
    () => (analysis.zones ? analysis.zones.features.map((f) => ({ d: geomPath(f.geometry, proj), p: f.properties })) : []),
    [analysis.zones, proj]
  );
  const terracePaths = useMemo(
    () => (terraces ? terraces.features.map((f) => ({ d: geomPath(f.geometry, proj), name: f.properties?.name })) : []),
    [terraces, proj]
  );

  const svgRef = useRef(null);
  const vRef = useRef(v);
  vRef.current = v;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();                         // React's onWheel is passive, so attach natively
      const cur = vRef.current, asp = cur.w / cur.h;
      const rect = el.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const nw = Math.min(full.w * 1.5, Math.max(40, cur.w * k)), nh = nw / asp;
      setView({ x: cur.x + (cur.w - nw) * fx, y: cur.y + (cur.h - nh) * fy, w: nw, h: nh });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full]);
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, v }; };
  const onMove = (e) => {
    if (!drag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * drag.current.v.w;
    const dy = ((e.clientY - drag.current.y) / rect.height) * drag.current.v.h;
    setView({ ...drag.current.v, x: drag.current.v.x - dx, y: drag.current.v.y - dy });
  };
  const onUp = () => { drag.current = null; };

  const pointFill = (i) => {
    if (colorBy === "cluster") return clusterColor(pts.cluster[i]);
    if (colorBy === "role") return ROLE[pts.role[i]].color;
    const [lo, hi] = data.ranges[colorBy];
    return ramp((pts[colorBy][i] - lo) / (hi - lo || 1));
  };

  const scaleLen = [10, 20, 50, 100, 200, 500].reduce((a, s) => (s <= v.w / 3 ? s : a), 10);
  const sx = v.x + 12, sy = v.y + v.h - 14;
  const r = Math.max(1.3, v.w / 330);

  return (
    <div className="mapbox">
      <svg ref={svgRef} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} style={{ height }} onMouseDown={onDown}
        onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} className="map" role="img" aria-label="Zone map">
        <rect x={v.x - 1e4} y={v.y - 1e4} width={v.w + 2e4} height={v.h + 2e4} fill="#eef3e2" />
        {layers.zones && zonePaths.filter((z) => z.p.cultivable || layers.other).map((z) => (
          <path key={z.p.cluster} d={z.d} fillRule="evenodd"
            fill={zoneBy === "suitability" ? SUIT[z.p.suitability_class].color : clusterColor(z.p.cluster)} fillOpacity={z.p.cultivable ? 0.4 : 0.12}
            stroke={zoneBy === "suitability" ? SUIT[z.p.suitability_class].color : clusterColor(z.p.cluster)} strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            onMouseEnter={() => setHover(z.p)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />
        ))}
        {layers.terraces && terracePaths.map((t, i) => (
          <path key={i} d={t.d} fill="none" stroke="#b5473a" strokeWidth="1.8" strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke" pointerEvents="none" />
        ))}
        {layers.points && data.xs.map((x, i) => (
          <circle key={i} cx={x} cy={data.ys[i]} r={r} fill={pointFill(i)} stroke="#fff" strokeWidth="0.3" opacity="0.9"
            pointerEvents="none" />
        ))}
        <g pointerEvents="none">
          <rect x={sx - 4} y={sy - 10} width={scaleLen + 8} height="16" fill="#fff" opacity="0.75" rx="2" />
          <line x1={sx} x2={sx + scaleLen} y1={sy} y2={sy} stroke="#1d2a22" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <text x={sx + scaleLen / 2} y={sy - 3} textAnchor="middle" fontSize={v.w / 55} fill="#1d2a22">{scaleLen} m</text>
        </g>
      </svg>
      <div className="map-tools">
        <button className="btn ghost sm" onClick={() => setView(null)}>Reset view</button>
        <span className="muted small">scroll to zoom · drag to pan</span>
      </div>
      <div className="map-hover">
        {hover ? (
          <>
            <b>Zone {hover.cluster}</b> · {hover.suitability} · {hover.n_points} sensor points ·{" "}
            {hover.area_ha} ha · slope {hover.mean_slope}° · moisture {hover.mean_moisture}% · elev {hover.mean_elevation} m ·{" "}
            {hover.cultivable ? "counted as cultivable" : "excluded: " + hover.reason}
          </>
        ) : (
          <span className="muted">Hover a zone for its details.</span>
        )}
      </div>
    </div>
  );
}
