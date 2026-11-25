import React from "react";
import { clusterColor } from "./ui.jsx";

const W = 560, H = 260, M = { l: 48, r: 14, t: 12, b: 36 };

function niceTicks(min, max, n = 5) {
  if (!(max > min)) return [min];
  const step0 = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const tickFmt = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) < 10 ? +v.toFixed(2) : +v.toFixed(1));

function Frame({ xd, yd, xLabel, yLabel, children, height = H }) {
  const iw = W - M.l - M.r, ih = height - M.t - M.b;
  const sx = (v) => M.l + ((v - xd[0]) / (xd[1] - xd[0] || 1)) * iw;
  const sy = (v) => M.t + ih - ((v - yd[0]) / (yd[1] - yd[0] || 1)) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      {niceTicks(yd[0], yd[1], 4).map((t) => (
        <g key={"y" + t}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.l - 6} y={sy(t) + 3} textAnchor="end" className="tick">{tickFmt(t)}</text>
        </g>
      ))}
      {niceTicks(xd[0], xd[1], 6).map((t) => (
        <text key={"x" + t} x={sx(t)} y={height - M.b + 14} textAnchor="middle" className="tick">{tickFmt(t)}</text>
      ))}
      <line x1={M.l} x2={W - M.r} y1={M.t + ih} y2={M.t + ih} className="axis" />
      <line x1={M.l} x2={M.l} y1={M.t} y2={M.t + ih} className="axis" />
      <text x={M.l + iw / 2} y={height - 4} textAnchor="middle" className="axis-label">{xLabel}</text>
      <text transform={`translate(11 ${M.t + ih / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{yLabel}</text>
      {children({ sx, sy, iw, ih })}
    </svg>
  );
}

export function Histogram({ counts, edges, label, color = "#2f8f4e" }) {
  if (!counts) return null;
  const yd = [0, Math.max(...counts) * 1.08];
  return (
    <Frame xd={[edges[0], edges[edges.length - 1]]} yd={yd} xLabel={label} yLabel="count" height={200}>
      {({ sx, sy }) =>
        counts.map((c, i) => (
          <rect key={i} x={sx(edges[i]) + 0.5} y={sy(c)} width={Math.max(1, sx(edges[i + 1]) - sx(edges[i]) - 1)}
            height={Math.max(0, sy(0) - sy(c))} fill={color} opacity="0.85">
            <title>{`${tickFmt(edges[i])} – ${tickFmt(edges[i + 1])}: ${c} readings`}</title>
          </rect>
        ))
      }
    </Frame>
  );
}

export function KDistanceChart({ data, eps }) {
  if (!data) return null;
  const d = data.distances;
  const yMax = Math.max(d[d.length - 1], eps) * 1.05;
  return (
    <Frame xd={[0, d.length - 1]} yd={[0, yMax]} xLabel="points (sorted, down-sampled)" yLabel={`distance to ${data.k}-th neighbour`}>
      {({ sx, sy }) => (
        <>
          <polyline fill="none" stroke="#1f6f43" strokeWidth="2" points={d.map((v, i) => `${sx(i)},${sy(v)}`).join(" ")} />
          <line x1={sx(0)} x2={sx(d.length - 1)} y1={sy(eps)} y2={sy(eps)} stroke="#c0392b" strokeDasharray="5 4" />
          <text x={sx(0) + 6} y={sy(eps) - 5} className="tick" fill="#c0392b">current ε = {eps}</text>
          <circle cx={sx(data.knee_index)} cy={sy(data.knee_eps)} r="5" fill="#d9822b" stroke="#fff" strokeWidth="1.5" />
          <text x={sx(data.knee_index) - 8} y={sy(data.knee_eps) - 9} textAnchor="end" className="tick">knee ≈ {data.knee_eps}</text>
        </>
      )}
    </Frame>
  );
}

export function ScatterPlot({ points, xKey, yKey, xLabel, yLabel }) {
  if (!points) return null;
  const xs = points[xKey], ys = points[yKey];
  const ext = (a) => [Math.min(...a), Math.max(...a)];
  const xe = ext(xs), ye = ext(ys);
  const pad = (e) => [e[0] - (e[1] - e[0]) * 0.04, e[1] + (e[1] - e[0]) * 0.04];
  return (
    <Frame xd={pad(xe)} yd={pad(ye)} xLabel={xLabel} yLabel={yLabel}>
      {({ sx, sy }) =>
        xs.map((x, i) => (
          <circle key={i} cx={sx(x)} cy={sy(ys[i])} r="2.4" fill={clusterColor(points.cluster[i])} opacity="0.75">
            <title>{`${points.id[i]} · cluster ${points.cluster[i]} · ${xLabel} ${x}, ${yLabel} ${ys[i]}`}</title>
          </circle>
        ))
      }
    </Frame>
  );
}

// grouped bars; groups: [{label, values:[v1,v2]}], series: [{name,color}]
export function GroupedBars({ groups, series, max = 1 }) {
  const height = 250, iw = W - M.l - M.r, ih = height - M.t - 58;
  const gw = iw / groups.length;
  const bw = Math.min(34, (gw - 14) / series.length);
  const sy = (v) => M.t + ih - (v / max) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      {niceTicks(0, max, 4).map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.l - 6} y={sy(t) + 3} textAnchor="end" className="tick">{tickFmt(t)}</text>
        </g>
      ))}
      {groups.map((g, gi) => (
        <g key={g.label}>
          {g.values.map((v, si) => {
            const x = M.l + gi * gw + (gw - bw * series.length) / 2 + si * bw;
            return (
              <g key={si}>
                <rect x={x} y={sy(v ?? 0)} width={bw - 2} height={Math.max(0, sy(0) - sy(v ?? 0))} fill={series[si].color} rx="2">
                  <title>{`${g.label} – ${series[si].name}: ${v ?? "n/a"}`}</title>
                </rect>
                <text x={x + (bw - 2) / 2} y={sy(v ?? 0) - 4} textAnchor="middle" className="tick">{tickFmt(v ?? 0)}</text>
              </g>
            );
          })}
          <foreignObject x={M.l + gi * gw} y={M.t + ih + 6} width={gw} height="48">
            <div className="bar-label">{g.label}</div>
          </foreignObject>
        </g>
      ))}
      <line x1={M.l} x2={W - M.r} y1={sy(0)} y2={sy(0)} className="axis" />
    </svg>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((s) => (
        <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
      ))}
    </div>
  );
}

function ramp(t) {
  // light sand -> deep green
  const a = [238, 244, 222], b = [38, 82, 50];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  return `rgb(${c.join(",")})`;
}

export function Heatmap({ sens, field, current }) {
  const { eps_values: E, min_samples_values: Ms, cells } = sens;
  const cw = Math.min(70, 480 / E.length), ch = 34, ox = 58, oy = 10;
  const get = (e, m) => cells.find((c) => c.eps === e && c.min_samples === m);
  const vals = cells.map((c) => c[field]).filter((v) => v !== null && v !== undefined);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const width = ox + cw * E.length + 8, height = oy + ch * Ms.length + 42;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart heat" role="img">
      {Ms.map((m, r) => (
        <g key={m}>
          <text x={ox - 8} y={oy + r * ch + ch / 2 + 4} textAnchor="end" className="tick">MinPts {m}</text>
          {E.map((e, c) => {
            const cell = get(e, m);
            const v = cell ? cell[field] : null;
            const t = v === null || v === undefined ? 0 : (v - lo) / (hi - lo || 1);
            const isCur = Math.abs(e - current.eps) < 1e-6 && m === current.min_samples;
            return (
              <g key={e}>
                <rect x={ox + c * cw} y={oy + r * ch} width={cw - 2} height={ch - 2} rx="3" fill={ramp(t)}
                  stroke={isCur ? "#c0392b" : "none"} strokeWidth="2.5">
                  <title>{`ε ${e}, MinPts ${m}: ${field} = ${v ?? "n/a"}${cell ? ` · ${cell.n_clusters} clusters · ${cell.noise_pct}% noise` : ""}`}</title>
                </rect>
                <text x={ox + c * cw + cw / 2 - 1} y={oy + r * ch + ch / 2 + 4} textAnchor="middle" className="cell-text"
                  fill={t > 0.55 ? "#fff" : "#1d2a22"}>{v === null || v === undefined ? "–" : tickFmt(v)}</text>
              </g>
            );
          })}
        </g>
      ))}
      {E.map((e, c) => (
        <text key={e} x={ox + c * cw + cw / 2 - 1} y={oy + Ms.length * ch + 14} textAnchor="middle" className="tick">{e}</text>
      ))}
      <text x={ox + (cw * E.length) / 2} y={height - 6} textAnchor="middle" className="axis-label">ε (eps)</text>
    </svg>
  );
}

// horizontal stacked bar: items [{name,value,color}]
export function StackedBar({ items, unit = "" }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div>
      <div className="stackbar">
        {items.map((i) => (
          <div key={i.name} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} title={`${i.name}: ${i.value}${unit} (${((i.value / total) * 100).toFixed(1)}%)`} />
        ))}
      </div>
      <Legend items={items.map((i) => ({ name: `${i.name} – ${i.value}${unit} (${((i.value / total) * 100).toFixed(0)}%)`, color: i.color }))} />
    </div>
  );
}

// mean ± std of one feature per cluster (dot-and-whisker)
export function ClusterProfile({ clusters, mean, std, label, colorOf }) {
  const rows = clusters;
  if (!rows.length) return null;
  const lo = Math.min(...rows.map((c) => c[mean] - c[std])), hi = Math.max(...rows.map((c) => c[mean] + c[std]));
  const pad = (hi - lo) * 0.08 || 1;
  const height = 34 + rows.length * 22;
  const ml = 56, mr = 14, iw = W - ml - mr;
  const sx = (v) => ml + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * iw;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img">
      {niceTicks(lo - pad, hi + pad, 5).map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={6} y2={height - 24} className="grid" />
          <text x={sx(t)} y={height - 10} textAnchor="middle" className="tick">{tickFmt(t)}</text>
        </g>
      ))}
      {rows.map((c, i) => {
        const y = 14 + i * 22;
        return (
          <g key={c.cluster}>
            <text x={ml - 8} y={y + 4} textAnchor="end" className="tick">Z{c.cluster}</text>
            <line x1={sx(c[mean] - c[std])} x2={sx(c[mean] + c[std])} y1={y} y2={y} stroke={colorOf(c)} strokeWidth="2.5" />
            <circle cx={sx(c[mean])} cy={y} r="5" fill={colorOf(c)} stroke="#fff" strokeWidth="1.5">
              <title>{`Cluster ${c.cluster}: ${label} ${c[mean]} ± ${c[std]}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
