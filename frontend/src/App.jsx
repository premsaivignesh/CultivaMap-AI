import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { DEFAULT_PARAMS } from "./constants.js";
import { ErrorBox } from "./components/ui.jsx";
import Overview from "./pages/Overview.jsx";
import DataPage from "./pages/DataPage.jsx";
import Preprocessing from "./pages/Preprocessing.jsx";
import Analysis from "./pages/Analysis.jsx";
import Suitability from "./pages/Suitability.jsx";
import ZoneMap from "./pages/ZoneMap.jsx";
import Validation from "./pages/Validation.jsx";
import Reports from "./pages/Reports.jsx";


const PAGES = [
  { id: "overview", label: "Overview", icon: "◧" },
  { id: "data", label: "Dataset", icon: "▤" },
  { id: "prep", label: "Preprocessing", icon: "⚙" },
  { id: "dbscan", label: "DBSCAN Analysis", icon: "◍" },
  { id: "suitability", label: "Suitability", icon: "❀" },
  { id: "map", label: "GIS Map", icon: "◬" },
  { id: "validation", label: "Evaluation", icon: "✔" },
  { id: "reports", label: "Reports & History", icon: "⇩" },
];

export default function App() {
  const [page, setPage] = useState(() => window.location.hash.replace("#", "") || "overview");
  const [dataset, setDataset] = useState(null);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [analysis, setAnalysis] = useState(null);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const go = (id) => { setPage(id); window.location.hash = id; window.scrollTo(0, 0); };

  const track = useCallback(async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try { return await fn(); }
    catch (e) { setError(e.message); return null; }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  }, []);

  const runAnalysis = useCallback((override) => track("analyze", async () => {
    const p = override || paramsRef.current;
    const r = await api.analyze(p);
    setAnalysis(r);
    setValidation(null);
    return r;
  }), [track]);

  const runValidation = useCallback((override) => track("validate", async () => {
    const r = await api.validate(override || paramsRef.current);
    setValidation(r);
    return r;
  }), [track]);

  const loadDataset = useCallback(async (fn) => {
    const d = await track("data", fn);
    if (d) {
      setDataset(d);
      setValidation(null);
      await runAnalysis();
      if (d.terraces) {
        const v = await track("validate", () => api.validate(paramsRef.current));
        if (v) setValidation(v);
      }
    }
    return d;
  }, [track, runAnalysis]);

  useEffect(() => { loadDataset(api.dataset); }, [loadDataset]);
  useEffect(() => {
    const h = () => setPage(window.location.hash.replace("#", "") || "overview");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  const ctx = {
    dataset, params, setParams, analysis, validation, busy, track, go,
    runAnalysis, runValidation, loadDataset, setError,
  };
  const Page = { overview: Overview, data: DataPage, prep: Preprocessing, dbscan: Analysis, suitability: Suitability, map: ZoneMap,
    validation: Validation, reports: Reports }[page] || Overview;
  const current = PAGES.find((p) => p.id === page) || PAGES[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">◭</div>
          <div><b>CultivaMap AI</b><span>Terrain zone delineation</span></div>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={"nav" + (p.id === page ? " active" : "")} onClick={() => go(p.id)}>
              <span className="nav-icon">{p.icon}</span>{p.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="muted small">Dataset</div>
          <div className="small"><b>{dataset ? dataset.name : "loading…"}</b></div>
          {dataset && <div className="muted small">{dataset.n_rows} observations</div>}
          {(busy.analyze || busy.validate || busy.data) && <div className="small working"><span className="spinner dark" /> working…</div>}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>{current.label}</h1>
          <span className="muted small">Irregular cultivable zone delineation · DBSCAN · slope · moisture · elevation</span>
        </header>
        {dataset?.synthetic && (
          <div className="alert warn">Synthetic demonstration data is loaded. Results show how the method works and are not field findings. Upload your own CSV on the Dataset page.</div>
        )}
        <ErrorBox error={error} onClose={() => setError(null)} />
        {dataset ? <Page {...ctx} /> : <div className="muted pad">Loading dataset…</div>}
      </main>
    </div>
  );
}
