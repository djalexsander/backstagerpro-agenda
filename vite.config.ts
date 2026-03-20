import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
      // Tauri v2 uses system webview; target modern browsers
      target: ["es2021", "chrome100", "safari14"],
      // Produce smaller chunks for desktop
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            supabase: ["@supabase/supabase-js"],
            ui: ["@radix-ui/react-dialog", "@radix-ui/react-popover", "@radix-ui/react-select"],
          },
        },
      },
    },
  }),
  // Prevent Vite from obscuring Rust errors in Tauri dev
  clearScreen: false,
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Only register PWA in web builds, not in Tauri
    !isTauri &&
      VitePWA({
        registerType: "prompt",
        includeAssets: ["favicon-256.png", "icon-192.png", "icon-512.png", "apple-touch-icon.png"],
        workbox: {
          navigateFallbackDenylist: [/^\/~oauth/],
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        manifest: {
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
              src: "/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Environment variables prefixed with VITE_ or TAURI_ are exposed
  envPrefix: ["VITE_", "TAURI_ENV_"],
}));
