import { registerSW } from "virtual:pwa-register";

export type UpdateCallback = (available: boolean) => void;

let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let onUpdateAvailable: UpdateCallback | null = null;

export const isTauri = (): boolean => {
  return Boolean((window as any).__TAURI__);
};

export const registerPWAUpdate = (callback: UpdateCallback) => {
  onUpdateAvailable = callback;

  updateSWFn = registerSW({
    onNeedRefresh() {
      console.log("[UpdateService] Nova versão disponível (PWA)");
      callback(true);
    },
    onOfflineReady() {
      console.log("[UpdateService] App pronto para uso offline");
    },
    onRegisteredSW(swUrl, registration) {
      console.log("[UpdateService] Service Worker registrado:", swUrl);
      // Auto-check a cada 5 minutos
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 5 * 60 * 1000);
      }
    },
  });
};

export const installPWAUpdate = async (): Promise<void> => {
  if (updateSWFn) {
    await updateSWFn(true);
  }
};

export const checkForTauriUpdate = async (): Promise<{
  available: boolean;
  version?: string;
}> => {
  if (!isTauri()) return { available: false };

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
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
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update?.available) {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  } catch (err) {
    console.error("[UpdateService] Erro ao instalar atualização Tauri:", err);
    throw err;
  }
};
