import { registerSW } from "virtual:pwa-register";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";

export type UpdateCallback = (available: boolean) => void;

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

// ============================================================================
// PWA update discovery
// ============================================================================

// Slow fallback poll. Foreground + focus checks (below) are the primary
// way a new service worker is discovered now: a Home Screen PWA on iOS
// freezes background timers and often resumes from a snapshot without
// re-running registration, so a tight interval mostly burned cycles there
// without ever being the thing that caught an update. 30 min is a safety
// net, not the main path.
export const PWA_UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000;

// Shared minimum gap between two *automatic* checks. An iOS resume fires
// visibilitychange and focus within milliseconds of each other; without a
// floor that would be two back-to-back registration.update() calls. A
// user-initiated checkForPWAUpdate() deliberately ignores this.
export const PWA_UPDATE_CHECK_THROTTLE_MS = 30 * 1000;

// How long a dismissed "Nova versão disponível" banner stays hidden.
// Returning to the app at least this long after dismissing, with an
// update still pending, brings the banner back - "dispensar" means
// "later", not "never". Long enough not to nag within a working session,
// short enough that someone back the next day is prompted again. Consumed
// by UpdateProvider; a genuinely new worker re-arms it immediately too.
export const PWA_DISMISS_REARM_AFTER_MS = 2 * 60 * 60 * 1000;

// "Atualizar agora" activation budget. installPWAUpdate() waits at most
// PWA_WAITING_WORKER_TIMEOUT_MS for a waiting worker to exist, then at most
// PWA_ACTIVATION_TIMEOUT_MS for that worker to take control - so the call
// always settles in under ~15s and the button can never hang.
export const PWA_WAITING_WORKER_TIMEOUT_MS = 5 * 1000;
export const PWA_ACTIVATION_TIMEOUT_MS = 10 * 1000;

let currentRegistration: ServiceWorkerRegistration | null = null;
let lastAutomaticCheckAt = 0;
let needRefreshCallback: UpdateCallback | null = null;

// The waiting worker we've already told the UI about. Repeated automatic
// checks for the *same* pending update must not re-fire the banner (that
// would undo the user's dismiss on every foreground). A genuinely new
// deploy produces a different ServiceWorker object and does re-fire.
let announcedWaitingWorker: ServiceWorker | null = null;

/** Raised by installPWAUpdate() when the update can't be applied. Every
 *  variant carries the same user-facing message; `reason` is for logs. */
export class PWAUpdateError extends Error {
  constructor(
    public readonly reason:
      | "no-registration"
      | "no-waiting-worker"
      | "activation-timeout"
      | "skip-waiting-failed",
    cause?: unknown,
  ) {
    super("Não foi possível aplicar a atualização. Tente novamente.");
    this.name = "PWAUpdateError";
    if (cause !== undefined) this.cause = cause;
  }
}

const announceUpdateAvailable = (
  waiting: ServiceWorker | null = currentRegistration?.waiting ?? null,
): void => {
  if (!waiting || waiting === announcedWaitingWorker) return;
  announcedWaitingWorker = waiting;
  needRefreshCallback?.(true);
};

// Every "is there a new version?" path funnels through here so the
// throttle and error handling live in one place. Always resolves, never
// rejects: a failed check is logged and forgotten, never surfaced to the
// user and never allowed to break the app.
const runUpdateCheck = async (
  reason: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> => {
  const registration = currentRegistration;
  if (!registration) return;

  const now = Date.now();
  if (!force && now - lastAutomaticCheckAt < PWA_UPDATE_CHECK_THROTTLE_MS) return;
  lastAutomaticCheckAt = now;

  try {
    await registration.update();
  } catch (err) {
    console.warn(`[UpdateService] Falha ao verificar atualização (${reason}):`, err);
  }

  // Surface a worker that installed and is now waiting even when
  // vite-plugin-pwa's own onNeedRefresh didn't fire for it (unreliable on
  // iOS) - onNeedRefresh is otherwise the only thing that shows the banner.
  announceUpdateAvailable();
};

const getActiveRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (currentRegistration) return currentRegistration;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) currentRegistration = registration;
    return registration ?? null;
  } catch {
    return null;
  }
};

// Resolves with the registration's waiting worker, waiting up to timeoutMs
// for one to appear. Resolves null on timeout - never rejects.
const waitForWaitingWorker = (
  registration: ServiceWorkerRegistration,
  timeoutMs: number,
): Promise<ServiceWorker | null> => {
  if (registration.waiting) return Promise.resolve(registration.waiting);

  return new Promise((resolve) => {
    let done = false;

    const finish = (worker: ServiceWorker | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      registration.removeEventListener("updatefound", onUpdateFound);
      resolve(worker);
    };

    const onUpdateFound = (): void => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (registration.waiting) finish(registration.waiting);
        else if (installing.state === "redundant") finish(null);
      });
    };

    const timer = setTimeout(() => finish(registration.waiting ?? null), timeoutMs);
    // iOS doesn't reliably dispatch `updatefound` on the registration
    // handle we hold - poll as a cheap backstop.
    const poll = setInterval(() => {
      if (registration.waiting) finish(registration.waiting);
    }, 400);
    registration.addEventListener("updatefound", onUpdateFound);
  });
};

// Tells the waiting worker to take over, then reloads the page exactly
// once when it does. Bounded by timeoutMs; rejects with PWAUpdateError if
// the handover never happens.
const activateWaitingWorker = (
  waiting: ServiceWorker,
  timeoutMs: number,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const container = navigator.serviceWorker;
    const initialController = container.controller;
    let done = false;
    let reloaded = false;

    const reloadOnce = (): void => {
      if (reloaded) return;
      reloaded = true;
      try {
        window.location.reload();
      } catch (err) {
        console.error("[UpdateService] location.reload() falhou:", err);
      }
    };

    const settle = (run: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      container.removeEventListener("controllerchange", onControllerChange);
      run();
    };

    const onControllerChange = (): void =>
      settle(() => {
        reloadOnce();
        resolve();
      });

    const timer = setTimeout(
      () =>
        settle(() => {
          // controllerchange never arrived (an iOS quirk). If the worker
          // activated anyway, a reload still lands us on the new version.
          const tookOver =
            waiting.state === "activating" ||
            waiting.state === "activated" ||
            (container.controller != null && container.controller !== initialController);
          if (tookOver) {
            reloadOnce();
            resolve();
          } else {
            reject(new PWAUpdateError("activation-timeout"));
          }
        }),
      timeoutMs,
    );

    container.addEventListener("controllerchange", onControllerChange);

    // Post straight to registration.waiting. The generated sw.js listens
    // for exactly { type: "SKIP_WAITING" } and calls self.skipWaiting().
    // This replaces vite-plugin-pwa's messageSkipWaiting(), which silently
    // no-ops whenever workbox-window's internal registration handle and
    // the real one are momentarily out of sync - the race we hit on iOS.
    try {
      waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (err) {
      settle(() => reject(new PWAUpdateError("skip-waiting-failed", err)));
    }
  });
};

/**
 * User-initiated update check - for a future "Verificar atualizações"
 * button. Never throws. Runs registration.update(), then reports whether a
 * new version is now staged (registration.waiting), and surfaces the
 * banner through the same callback registerPWAUpdate() wired up.
 */
export const checkForPWAUpdate = async (): Promise<{ updateReady: boolean }> => {
  const registration = await getActiveRegistration();
  if (!registration) return { updateReady: false };

  if (!registration.waiting) {
    lastAutomaticCheckAt = Date.now(); // share the automatic-check throttle window
    try {
      await registration.update();
    } catch (err) {
      console.warn("[UpdateService] Falha ao verificar atualização (manual):", err);
    }
    if (!registration.waiting) {
      await waitForWaitingWorker(registration, PWA_WAITING_WORKER_TIMEOUT_MS);
    }
  }

  const waiting = registration.waiting;
  if (waiting) {
    // Explicit user action: always surface it, even past the dedupe.
    announcedWaitingWorker = waiting;
    needRefreshCallback?.(true);
  }
  return { updateReady: Boolean(waiting) };
};

/**
 * Registers the PWA service worker and wires up update discovery:
 *   - an explicit check the moment the registration is available
 *   - a check whenever the app returns to the foreground
 *     (visibilitychange -> visible) or the window regains focus - the
 *     mechanisms that actually fire reliably on iOS
 *   - a slow periodic poll as a fallback
 *
 * Returns a cleanup function that removes every listener and clears the
 * timer it installed. Call it when the owning component unmounts so a
 * remount can't stack duplicate intervals or listeners.
 */
export const registerPWAUpdate = (callback: UpdateCallback): (() => void) => {
  let periodicTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  needRefreshCallback = callback;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") void runUpdateCheck("foreground");
  };
  const onFocus = (): void => {
    void runUpdateCheck("focus");
  };

  registerSW({
    onNeedRefresh() {
      console.log("[UpdateService] Nova versão disponível (PWA)");
      // vite-plugin-pwa only fires this when a worker is genuinely
      // waiting, so always surface it - even if our registration handle
      // isn't wired up yet. Record the worker (when we can see it) so the
      // automatic checks don't re-announce the same one on every foreground.
      if (currentRegistration?.waiting) announcedWaitingWorker = currentRegistration.waiting;
      needRefreshCallback?.(true);
    },
    onOfflineReady() {
      console.log("[UpdateService] App pronto para uso offline");
    },
    onRegisteredSW(_swUrl, registration) {
      if (disposed || !registration) return;
      console.log("[UpdateService] Service Worker registrado");
      currentRegistration = registration;

      // A worker can already be waiting from a previous session.
      announceUpdateAvailable();

      void runUpdateCheck("registro", { force: true });

      periodicTimer = setInterval(() => {
        void runUpdateCheck("polling");
      }, PWA_UPDATE_POLL_INTERVAL_MS);
    },
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", onFocus);

  return () => {
    disposed = true;
    if (periodicTimer !== null) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    currentRegistration = null;
    lastAutomaticCheckAt = 0;
    needRefreshCallback = null;
    announcedWaitingWorker = null;
  };
};

/**
 * "Atualizar agora". Robust, fully bounded activation:
 *   1. get the registration (the stored handle, or navigator.serviceWorker)
 *   2. make sure a worker is waiting (update() + a bounded wait)
 *   3. postMessage SKIP_WAITING straight to it
 *   4. reload once on controllerchange, or once we can tell it took over
 * Every step has a deadline, so the call always settles and the caller's
 * "Atualizando..." state can never get stuck. On success the page reloads
 * exactly once; no reinstall required.
 */
export const installPWAUpdate = async (): Promise<void> => {
  const registration = await getActiveRegistration();
  if (!registration) throw new PWAUpdateError("no-registration");

  if (!registration.waiting) {
    // Kick the check off; waitForWaitingWorker owns the deadline.
    void registration.update().catch(() => {
      /* swallowed - we only care whether a waiting worker shows up */
    });
    await waitForWaitingWorker(registration, PWA_WAITING_WORKER_TIMEOUT_MS);
  }

  const waiting = registration.waiting;
  if (!waiting) throw new PWAUpdateError("no-waiting-worker");

  await activateWaitingWorker(waiting, PWA_ACTIVATION_TIMEOUT_MS);
};

// ============================================================================
// Tauri desktop updater
// ============================================================================

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
