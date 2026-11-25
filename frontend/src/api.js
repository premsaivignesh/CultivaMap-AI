async function request(path, options = {}) {
  const res = await fetch("/api" + path, options);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch (_) { /* keep statusText */ }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json();
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const upload = (path, file) => {
  const fd = new FormData();
  fd.append("file", file);
  return request(path, { method: "POST", body: fd });
};

export const api = {
  dataset: () => request("/dataset"),
  rows: (q) => request("/dataset/rows?" + new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))),
  useSample: () => request("/dataset/sample", { method: "POST" }),
  uploadPoints: (f) => upload("/dataset/points", f),
  uploadTerraces: (f) => upload("/dataset/terraces", f),
  removeTerraces: () => request("/dataset/terraces", { method: "DELETE" }),
  quality: (p) => request("/quality", json(p)),
  kdistance: (p) => request("/kdistance", json(p)),
  analyze: (p) => request("/analyze", json(p)),
  validate: (p) => request("/validate", json(p)),
  sensitivity: (p) => request("/sensitivity", json(p)),
  runs: () => request("/runs"),
};
