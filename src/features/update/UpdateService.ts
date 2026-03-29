import { registerSW } from "virtual:pwa-register";

export type UpdateCallback = (available: boolean) => void;

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

export const isTauri = (): boolean => {
  return Boolean((window as any).__TAURI__);
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
