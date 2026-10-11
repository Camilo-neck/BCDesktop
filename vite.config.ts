import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/** Dev only: `/__delay?ms=N` answers after N ms. A pending image delays the
 *  window `load` event, which lets `firefox --headless --screenshot` capture
 *  the UI after data arrives (see src/main.tsx, `?shot=` param). */
const screenshotDelay = (): Plugin => ({
  name: "bc-screenshot-delay",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__delay", (req, res) => {
      const ms = Number(new URL(req.url ?? "", "http://x").searchParams.get("ms") ?? 1000);
      setTimeout(() => {
        res.setHeader("Content-Type", "image/gif");
        res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
      }, Math.min(ms, 15000));
    });
  },
});

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), screenshotDelay()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 1200,
  },
});
