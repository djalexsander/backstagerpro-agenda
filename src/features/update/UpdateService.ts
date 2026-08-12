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

/**
 * Distinguishes the one failure mode worth telling the user apart from
 * every other: once downloadAndInstall() has already succeeded, the update
 * itself is safely on disk - only the automatic restart failed (OS blocked
 * it, a file lock, etc.). That's a "please restart manually" message, not
 * an "update failed, try again" one. Every other failure (no internet,
 * endpoint unreachable, malformed latest.json, bad signature, interrupted
 * download - see tauri-plugin-updater's Error enum) is serialized by the
 * Rust side as a plain message string with no stable discriminant, so
 * those all collapse into the generic "download" stage instead of being
 * guessed apart by matching on message text.
 */
export class UpdateInstallError extends Error {
  constructor(public readonly stage: "download" | "relaunch", cause: unknown) {
    super(stage === "relaunch" ? "Falha ao reiniciar automaticamente após instalar a atualização." : "Falha ao baixar/instalar a atualização.");
    this.name = "UpdateInstallError";
    this.cause = cause;
  }
}

export const checkForTauriUpdate = async (): Promise<{
  available: boolean;
  version?: string;
}> => {
  if (!isTauri()) return { available: false };

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    // check() resolves to null when there's no update (not an object with
    // `available: false` - `Update.available` is deprecated upstream and is
    // always true on a non-null result, so testing the return value itself
    // is the correct/current idiom).
    const update = await check();
    if (!update) return { available: false };
    const version = update.version;
    // Not proceeding to install from this call - release the Rust-side
    // resource now instead of letting it leak until GC, since this runs
    // again on every 5-minute poll (see UpdateProvider.tsx).
    await update.close();
    return { available: true, version };
  } catch (err) {
    // Deliberately silent to the user: this runs unattended every 5
    // minutes, and a transient network blip shouldn't nag anyone. Full
    // detail still goes to console for debugging.
    console.warn("[UpdateService] Erro ao verificar atualização Tauri:", err);
    return { available: false };
  }
};

export const installTauriUpdate = async (): Promise<void> => {
  if (!isTauri()) return;

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return;

  try {
    await update.downloadAndInstall();
  } catch (err) {
    console.error("[UpdateService] Falha ao baixar/instalar a atualização:", err);
    throw new UpdateInstallError("download", err);
  }

  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.error("[UpdateService] Atualização instalada, mas falha ao reiniciar automaticamente:", err);
    throw new UpdateInstallError("relaunch", err);
  }
};
