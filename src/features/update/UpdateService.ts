import { registerSW } from "virtual:pwa-register";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";

export type UpdateCallback = (available: boolean) => void;

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

// Delegates to the official SDK instead of reading window.__TAURI__: that
// global only exists when app.withGlobalTauri is enabled in
// tauri.conf.json (it isn't, here), so it was always undefined in the real
// packaged app and every desktop-only code path below silently fell back
// to its web behavior. @tauri-apps/api/core's isTauri() checks
// globalThis.isTauri instead, which Tauri's IPC bootstrap sets
// unconditionally in every webview.
export const isTauri = (): boolean => {
  return isTauriRuntime();
};

export const registerPWAUpdate = (callback: UpdateCallback) => {
  updateSWFn = registerSW({
    onNeedRefresh() {
      console.log("[UpdateService] Nova versão disponível (PWA)");
      callback(true);
    },
    onOfflineReady() {
      console.log("[UpdateService] App pronto para uso offline");
    },
    onRegisteredSW(_swUrl, registration) {
      console.log("[UpdateService] Service Worker registrado");
      if (registration) {
        // Check for updates every 2 minutes for faster detection
        setInterval(() => {
          console.log("[UpdateService] Verificando atualizações...");
          registration.update();
        }, 2 * 60 * 1000);
      }
    },
  });
};

export const installPWAUpdate = async (): Promise<void> => {
  if (updateSWFn) {
    await updateSWFn(true);
  }
};

// Tauri functions use globalThis to avoid static imports
export const checkForTauriUpdate = async (): Promise<{
  available: boolean;
  version?: string;
}> => {
  if (!isTauri()) return { available: false };

  try {
    // Dynamic import via new Function to avoid Vite/Rolldown resolution
    const mod = await new Function('return import("@tauri-apps/plugin-updater")')();
    const update = await mod.check();
    if (update?.available) {
      return { available: true, version: update.version };
    }
    return { available: false };
  } catch (err) {
    console.warn("[UpdateService] Erro ao verificar atualização Tauri:", err);
    return { available: false };
  }
};

export const installTauriUpdate = async (): Promise<void> => {
  if (!isTauri()) return;

  try {
    const updaterMod = await new Function('return import("@tauri-apps/plugin-updater")')();
    const update = await updaterMod.check();
    if (update?.available) {
      await update.downloadAndInstall();
      const processMod = await new Function('return import("@tauri-apps/plugin-process")')();
      await processMod.relaunch();
    }
  } catch (err) {
    console.error("[UpdateService] Erro ao instalar atualização Tauri:", err);
    throw err;
  }
};
