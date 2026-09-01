import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// Publica /version.json a cada build. É a fonte de verdade que o PWA
// consulta para saber que existe versão nova mesmo quando o Service
// Worker não atualiza (caso clássico do iOS e de PWAs instalados por um
// host que passou a redirecionar).
const versionManifestPlugin = () => ({
  name: "backstage-version-manifest",
  apply: "build" as const,
  generateBundle(this: { emitFile: (file: Record<string, unknown>) => void }) {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: pkg.version, buildTime: new Date().toISOString() }),
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __IS_TAURI__: JSON.stringify(isTauri),
  },

  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Tauri expects a fixed port
    strictPort: isTauri,
  },

  // Tauri CLI expects the build output in ../dist
  ...(isTauri && {
    build: {
      // Tauri v2 uses the system WebView
      target: ["es2021", "chrome100", "safari14"] as any,
    },
  }),

  // Prevent Vite from obscuring Rust errors in Tauri dev
  clearScreen: false,

  plugins: [
    react(),

    versionManifestPlugin(),

    // Keep the plugin loaded so "virtual:pwa-register" can be resolved.
    // Disable service worker generation when running inside Tauri.
    VitePWA({
      disable: isTauri,
      registerType: "prompt",

      includeAssets: [
        "favicon-32x32-v3.png",
        "favicon-256-v3.png",
        "icon-192-v3.png",
        "icon-512-v3.png",
        "apple-touch-icon-v3.png",
      ],

      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Adds push/notificationclick listeners to the generated sw.js via
        // importScripts() without switching off the default generateSW
        // strategy (keeps the existing precache/update-prompt flow in
        // src/features/update/UpdateService.ts untouched). push-sw.js lives
        // in public/ so it is copied to the same output root as sw.js.
        importScripts: ["push-sw.js"],
      },

      manifest: {
        // Explicit, stable identity so the browser never re-derives it
        // from start_url heuristics - a reinstall or a start_url change
        // could otherwise orphan the installed PWA instead of updating it.
        id: "/",
        name: "Backstage Pro — Gestão de Eventos",
        short_name: "Backstage Pro",
        description: "Sistema de gestão de Agenda e Financeiro",
        theme_color: "#0a0f1e",
        background_color: "#0a0f1e",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",

        icons: [
          {
            src: "/icon-192-v3.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512-v3.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512-v3.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Environment variables prefixed with VITE_ or TAURI_ are exposed
  envPrefix: ["VITE_", "TAURI_ENV_"],
}));