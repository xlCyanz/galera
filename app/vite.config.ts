import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Configuración recomendada por Tauri para Vite:
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  // Tauri muestra sus propios errores de Rust; no hay que limpiarlos.
  clearScreen: false,

  server: {
    // Puerto fijo: `tauri.conf.json` apunta a él. Si está ocupado, fallar
    // en vez de elegir otro en silencio.
    port: 1420,
    strictPort: true,
    host: host || false,
    // Solo al desarrollar contra un dispositivo remoto: `TAURI_DEV_HOST`.
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: {
      // Los cambios en Rust los vigila Tauri, no Vite.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Solo las variables con estos prefijos llegan al código de la interfaz.
  envPrefix: ["VITE_", "TAURI_ENV_*"],

  build: {
    // Los webview de cada sistema: Safari en macOS, Chromium en Windows.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },

  test: {
    environment: "jsdom",
  },
});
