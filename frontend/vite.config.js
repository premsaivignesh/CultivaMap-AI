import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports used by this project (change them here and in the README commands if needed):
//   frontend (Vite)  -> 5180
//   backend (FastAPI) -> 8010
const BACKEND = "http://127.0.0.1:8010";

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true, proxy: { "/api": BACKEND } },
  preview: { port: 5180, strictPort: true, proxy: { "/api": BACKEND } },
});
