import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// Capture the options vite-plugin-pwa's registerSW is called with so the
// test can drive the lifecycle callbacks by hand. Same "mock the virtual
// module" approach already used in UpdateProvider.test.tsx.
const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: registerSWMock }));

import {
  checkForPWAUpdate,
  installPWAUpdate,
  PWA_ACTIVATION_TIMEOUT_MS,
  PWA_UPDATE_CHECK_THROTTLE_MS,
  PWA_UPDATE_POLL_INTERVAL_MS,
  PWA_WAITING_WORKER_TIMEOUT_MS,
  PWAUpdateError,
  registerPWAUpdate,
} from "./UpdateService";

type Lifecycle = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, reg: ServiceWorkerRegistration | undefined) => void;
};

class FakeSW extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState = "installed") {
    super();
  }
  setState(next: ServiceWorkerState): void {
    this.state = next;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeSW | null = null;
  installing: FakeSW | null = null;
  active: FakeSW | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

class FakeContainer extends EventTarget {
  controller: FakeSW | null = null;
  getRegistration = vi.fn().mockResolvedValue(undefined);
  register = vi.fn();
}

function makeRegistration(): FakeRegistration {
  return new FakeRegistration();
}
function makeSW(state?: ServiceWorkerState): FakeSW {
  return new FakeSW(state);
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}
function fireVisibility(state: DocumentVisibilityState): void {
  setVisibility(state);
  document.dispatchEvent(new Event("visibilitychange"));
}
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// Attach a settle handler synchronously so a rejection during a later
// timer advance is never briefly "unhandled".
function outcomeOf<T>(promise: Promise<T>): Promise<T | unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

describe("UpdateService - PWA update flow", () => {
  let capturedOptions: Lifecycle;
  let reloadMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;
  const disposers: Array<() => void> = [];

  function register(callback: Mock<(available: boolean) => void> = vi.fn()) {
    const dispose = registerPWAUpdate(callback);
    disposers.push(dispose);
    return { dispose, callback };
  }
  function fireRegistered(reg: FakeRegistration): void {
    capturedOptions.onRegisteredSW?.("/sw.js", reg as unknown as ServiceWorkerRegistration);
  }
  function setContainer(overrides: Partial<FakeContainer> = {}): FakeContainer {
    const container = Object.assign(new FakeContainer(), overrides);
    Object.defineProperty(navigator, "serviceWorker", {
      value: container,
      configurable: true,
      writable: true,
    });
    return container;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    capturedOptions = {};
    registerSWMock.mockReset();
    registerSWMock.mockImplementation((opts: Lifecycle) => {
      capturedOptions = opts;
      return () => Promise.resolve();
    });
    setVisibility("visible");
    reloadMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://localhost/", origin: "http://localhost", reload: reloadMock },
    });
  });

  afterEach(() => {
    while (disposers.length) disposers.pop()?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  // ==========================================================================
  describe("discovery: registerPWAUpdate", () => {
    it("registers the service worker with the three lifecycle callbacks", () => {
      register();
      expect(registerSWMock).toHaveBeenCalledTimes(1);
      expect(capturedOptions.onNeedRefresh).toBeTypeOf("function");
      expect(capturedOptions.onOfflineReady).toBeTypeOf("function");
      expect(capturedOptions.onRegisteredSW).toBeTypeOf("function");
    });

    it("runs registration.update() immediately once the registration is available", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("checks for an update when the app returns to the foreground (visibilitychange -> visible)", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);

      fireVisibility("visible");

      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("does not check when the app goes to the background (visibilitychange -> hidden)", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);

      fireVisibility("hidden");

      expect(reg.update).not.toHaveBeenCalled();
    });

    it("checks for an update on window focus", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);

      window.dispatchEvent(new Event("focus"));

      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("throttles a visibilitychange + focus pair that fire almost together", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);

      fireVisibility("visible");
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new Event("focus"));

      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("allows another check once the throttle window has passed", () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);

      fireVisibility("visible");
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);
      fireVisibility("visible");

      expect(reg.update).toHaveBeenCalledTimes(2);
    });

    it("keeps a periodic fallback poll running on the ~30 minute interval", () => {
      expect(PWA_UPDATE_POLL_INTERVAL_MS).toBe(30 * 60 * 1000);
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();

      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(reg.update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(28 * 60 * 1000);
      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("cleanup clears the periodic poll", () => {
      const { dispose } = register();
      fireRegistered(makeRegistration());
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cleanup removes the visibilitychange and focus listeners", () => {
      const docRemove = vi.spyOn(document, "removeEventListener");
      const winRemove = vi.spyOn(window, "removeEventListener");
      const { dispose } = register();

      dispose();

      expect(docRemove.mock.calls.map((c) => c[0])).toContain("visibilitychange");
      expect(winRemove.mock.calls.map((c) => c[0])).toContain("focus");
    });

    it("after cleanup, foreground/focus no longer trigger checks", () => {
      const { dispose } = register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();

      dispose();
      vi.advanceTimersByTime(PWA_UPDATE_POLL_INTERVAL_MS * 3);
      fireVisibility("visible");
      window.dispatchEvent(new Event("focus"));

      expect(reg.update).not.toHaveBeenCalled();
    });

    it("a failing registration.update() is swallowed and logged, never thrown", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      register();
      const reg = makeRegistration();
      reg.update.mockRejectedValue(new Error("offline"));

      expect(() => fireRegistered(reg)).not.toThrow();
      await flushMicrotasks();
      expect(warnSpy).toHaveBeenCalled();

      reg.update.mockResolvedValue(undefined);
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);
      fireVisibility("visible");
      expect(reg.update).toHaveBeenCalledTimes(2);
    });

    it("shows the banner when a worker is already waiting at registration time", () => {
      const { callback } = register();
      const reg = makeRegistration();
      reg.waiting = makeSW("installed");
      fireRegistered(reg);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it("shows the banner when vite-plugin-pwa reports onNeedRefresh after registration", () => {
      const { callback } = register();
      const reg = makeRegistration();
      fireRegistered(reg);
      callback.mockClear();

      reg.waiting = makeSW("installed");
      capturedOptions.onNeedRefresh?.();

      expect(callback).toHaveBeenCalledWith(true);
    });

    it("does not re-fire the banner for the same waiting worker on repeated checks (no spam)", async () => {
      const { callback } = register();
      const reg = makeRegistration();
      reg.waiting = makeSW("installed");
      fireRegistered(reg);
      expect(callback).toHaveBeenCalledTimes(1);
      callback.mockClear();

      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);
      fireVisibility("visible");
      await flushMicrotasks();

      expect(callback).not.toHaveBeenCalled();
    });

    it("re-fires the banner when a genuinely new worker is staged", async () => {
      const { callback } = register();
      const reg = makeRegistration();
      reg.waiting = makeSW("installed");
      fireRegistered(reg);
      callback.mockClear();

      reg.waiting = makeSW("installed"); // a second deploy
      vi.advanceTimersByTime(PWA_UPDATE_CHECK_THROTTLE_MS + 1_000);
      fireVisibility("visible");
      await flushMicrotasks();

      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  // ==========================================================================
  describe("activation: installPWAUpdate", () => {
    it("posts SKIP_WAITING to an already-waiting worker and reloads once on controllerchange", async () => {
      register();
      const reg = makeRegistration();
      const waiting = makeSW("installed");
      reg.waiting = waiting;
      fireRegistered(reg);
      const container = setContainer();

      const promise = installPWAUpdate();
      await flushMicrotasks();

      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
      expect(reloadMock).not.toHaveBeenCalled();

      container.dispatchEvent(new Event("controllerchange"));
      await promise;

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("does not reload twice when controllerchange fires more than once", async () => {
      register();
      const reg = makeRegistration();
      reg.waiting = makeSW("installed");
      fireRegistered(reg);
      const container = setContainer();

      const promise = installPWAUpdate();
      await flushMicrotasks();

      container.dispatchEvent(new Event("controllerchange"));
      container.dispatchEvent(new Event("controllerchange"));
      await promise;

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("calls update() and waits for a newly installed worker, then activates it", async () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      const container = setContainer();

      const promise = installPWAUpdate();
      await flushMicrotasks();
      expect(reg.update).toHaveBeenCalledTimes(1);

      reg.installing = makeSW("installing");
      reg.dispatchEvent(new Event("updatefound"));
      const newWorker = makeSW("installed");
      reg.waiting = newWorker;
      reg.installing.setState("installed");
      await flushMicrotasks();

      expect(newWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

      container.dispatchEvent(new Event("controllerchange"));
      await promise;
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to navigator.serviceWorker.getRegistration() when no handle is stored", async () => {
      register(); // no fireRegistered -> no stored registration
      const reg = makeRegistration();
      const waiting = makeSW("installed");
      reg.waiting = waiting;
      const container = setContainer({ getRegistration: vi.fn().mockResolvedValue(reg) });

      const promise = installPWAUpdate();
      await flushMicrotasks();

      expect(container.getRegistration).toHaveBeenCalled();
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

      container.dispatchEvent(new Event("controllerchange"));
      await promise;
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("rejects with a controlled error (no reload) when the handover never completes", async () => {
      register();
      const reg = makeRegistration();
      const waiting = makeSW("installed");
      reg.waiting = waiting;
      fireRegistered(reg);
      setContainer();

      const outcome = outcomeOf(installPWAUpdate());
      await flushMicrotasks();
      expect(waiting.postMessage).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(PWA_ACTIVATION_TIMEOUT_MS + 100);

      const err = await outcome;
      expect(err).toBeInstanceOf(PWAUpdateError);
      expect((err as PWAUpdateError).reason).toBe("activation-timeout");
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it("still reloads on timeout if the worker took over without a controllerchange event (iOS)", async () => {
      register();
      const reg = makeRegistration();
      const waiting = makeSW("installed");
      reg.waiting = waiting;
      fireRegistered(reg);
      const container = setContainer();

      const promise = installPWAUpdate();
      await flushMicrotasks();

      waiting.state = "activated";
      container.controller = waiting;

      await vi.advanceTimersByTimeAsync(PWA_ACTIVATION_TIMEOUT_MS + 100);
      await promise;

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("throws a controlled error when there is no service worker registration at all", async () => {
      register();
      setContainer({ getRegistration: vi.fn().mockResolvedValue(undefined) });

      const err = await installPWAUpdate().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PWAUpdateError);
      expect((err as PWAUpdateError).reason).toBe("no-registration");
    });

    it("settles (does not hang) when update() rejects and nothing gets staged", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      register();
      const reg = makeRegistration();
      reg.update.mockRejectedValue(new Error("network"));
      fireRegistered(reg);
      setContainer();

      const outcome = outcomeOf(installPWAUpdate());
      await vi.advanceTimersByTimeAsync(PWA_WAITING_WORKER_TIMEOUT_MS + 100);

      const err = await outcome;
      expect(err).toBeInstanceOf(PWAUpdateError);
      expect((err as PWAUpdateError).reason).toBe("no-waiting-worker");
    });
  });

  // ==========================================================================
  describe("manual: checkForPWAUpdate", () => {
    it("resolves { updateReady: false } when no service worker is registered", async () => {
      register();
      await expect(checkForPWAUpdate()).resolves.toEqual({ updateReady: false });
    });

    it("runs update() and reports { updateReady: false } when nothing is staged", async () => {
      register();
      const reg = makeRegistration();
      fireRegistered(reg);
      reg.update.mockClear();
      setContainer();

      const p = checkForPWAUpdate();
      await vi.advanceTimersByTimeAsync(PWA_WAITING_WORKER_TIMEOUT_MS + 100);

      await expect(p).resolves.toEqual({ updateReady: false });
      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    it("reports { updateReady: true } and fires the banner callback for an already-waiting worker", async () => {
      const { callback } = register();
      const reg = makeRegistration();
      reg.waiting = makeSW("installed");
      fireRegistered(reg);
      callback.mockClear();

      await expect(checkForPWAUpdate()).resolves.toEqual({ updateReady: true });
      expect(callback).toHaveBeenCalledWith(true);
    });

    it("surfaces a worker that becomes ready during the check", async () => {
      const { callback } = register();
      const reg = makeRegistration();
      fireRegistered(reg);
      callback.mockClear();
      reg.update.mockImplementation(async () => {
        reg.waiting = makeSW("installed");
      });
      setContainer();

      await expect(checkForPWAUpdate()).resolves.toEqual({ updateReady: true });
      expect(callback).toHaveBeenCalledWith(true);
    });
  });
});

describe("vite.config.ts - PWA manifest", () => {
  it('declares manifest.id "/" so the PWA identity is stable across deploys', () => {
    // vitest runs from the repo root; the config isn't importable here
    // (its plugin array captures the manifest in closures), so this is a
    // source-contract check - it fails loudly if manifest.id is dropped.
    const configSrc = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf-8");
    expect(configSrc).toMatch(/manifest:\s*\{/);
    expect(configSrc).toMatch(/\bid:\s*["']\/["']/);
  });
});
