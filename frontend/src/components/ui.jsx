import React from "react";

export const PALETTE = ["#3f7d4e", "#c98a2b", "#3b78a8", "#a4508b", "#b5473a", "#2a9d8f", "#7d6bb0", "#8a6d45",
  "#c7b21f", "#5d6d7e", "#d97aa0", "#6f9a3a"];
export const clusterColor = (c) => (c < 0 ? "#b9c0b2" : PALETTE[c % PALETTE.length]);
// land-suitability classes: 2 = potentially suitable, 1 = moderately suitable, 0 = less suitable
export const SUIT = {
  2: { name: "Potentially suitable", color: "#2f6b3a" },
  1: { name: "Moderately suitable", color: "#a3b04a" },
  0: { name: "Less suitable", color: "#c9a66b" },
};
export const ROLE = { 2: { name: "Core", color: "#2f6b3a" }, 1: { name: "Border", color: "#a3b04a" }, 0: { name: "Noise", color: "#b9c0b2" } };

export function Card({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={"card " + className}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="row gap">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={"stat " + (tone || "")}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? "–"}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Button({ children, variant = "primary", busy, ...rest }) {
  return (
    <button className={"btn " + variant} disabled={busy || rest.disabled} {...rest}>
      {busy && <span className="spinner" />}
      {children}
    </button>
  );
}

export function ErrorBox({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <span>{error}</span>
      {onClose && <button className="link" onClick={onClose}>dismiss</button>}
    </div>
  );
}

export function Notice({ tone = "info", children }) {
  return <div className={"alert " + tone}>{children}</div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="muted">{children}</p>
      {action}
    </div>
  );
}

export function Table({ columns, rows, dense }) {
  return (
    <div className="table-wrap">
      <table className={dense ? "dense" : ""}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : r[c.key] ?? "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "–" : typeof v === "number" ? v.toFixed(d) : v;
