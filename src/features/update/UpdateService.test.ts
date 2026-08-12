import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
}));
// Mocked at the plugin-package boundary (same "mock the lowest boundary"
// principle already used for html2canvas in printer-service.test.ts) rather
// than at the raw @tauri-apps/api/core invoke level - this doesn't need to
// know the plugin's internal IPC command names, and works transparently for
// the dynamic import() in UpdateService.ts (vi.mock intercepts dynamic
// imports the same way it does static ones).
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));

// UpdateService.ts imports the Vite-only "virtual:pwa-register" module,
// resolvable here only via the vitest.config.ts alias to
// src/test/pwa-register-stub.ts - this lets the real module load and
// isTauri() run for real, unlike every other test file in this repo, which
// mocks UpdateService away entirely instead.
import { isTauri, checkForTauriUpdate, installTauriUpdate, UpdateInstallError } from "./UpdateService";

describe("isTauri (real implementation)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false in a plain web/PWA build with no Tauri IPC bridge present", () => {
    expect(isTauri()).toBe(false);
  });

  it("returns true from globalThis.isTauri alone, without needing window.__TAURI__", () => {
    // This app's tauri.conf.json does not set app.withGlobalTauri, so
    // window.__TAURI__ is never injected in the real packaged app - only
    // globalThis.isTauri is (set unconditionally by Tauri's IPC bootstrap).
    // Asserting the fragile global stays absent here is what pins down the
    // regression this fix addresses: isTauri() must not depend on it.
    vi.stubGlobal("isTauri", true);
    expect((window as unknown as { __TAURI__?: unknown }).__TAURI__).toBeUndefined();

    expect(isTauri()).toBe(true);
  });
});

describe("checkForTauriUpdate", () => {
  beforeEach(() => {
    checkMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never calls the updater plugin outside the desktop shell (web/PWA)", async () => {
    const result = await checkForTauriUpdate();
    expect(result).toEqual({ available: false });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("reports the new version and releases the Update resource when one is available", async () => {
    vi.stubGlobal("isTauri", true);
    const closeMock = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ version: "1.2.0", close: closeMock });

    await expect(checkForTauriUpdate()).resolves.toEqual({ available: true, version: "1.2.0" });
    expect(closeMock).toHaveBeenCalled();
  });

  it("reports unavailable when check() resolves null (already on the latest version)", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue(null);

    await expect(checkForTauriUpdate()).resolves.toEqual({ available: false });
  });

  it("reports unavailable instead of throwing when the check itself fails (no internet, endpoint down, malformed latest.json)", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockRejectedValue(new Error("network error"));

    await expect(checkForTauriUpdate()).resolves.toEqual({ available: false });
  });
});

describe("installTauriUpdate", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing outside the desktop shell", async () => {
    await installTauriUpdate();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("does nothing when there is no update to install", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue(null);

    await installTauriUpdate();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("downloads, installs and relaunches on a full success", async () => {
    vi.stubGlobal("isTauri", true);
    const downloadAndInstallMock = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ version: "1.2.0", downloadAndInstall: downloadAndInstallMock });
    relaunchMock.mockResolvedValue(undefined);

    await installTauriUpdate();
    expect(downloadAndInstallMock).toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalled();
  });

  it('raises an UpdateInstallError with stage "download" when downloadAndInstall itself fails (interrupted download, invalid signature, etc.)', async () => {
    vi.stubGlobal("isTauri", true);
    const downloadAndInstallMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    checkMock.mockResolvedValue({ version: "1.2.0", downloadAndInstall: downloadAndInstallMock });

    const error = await installTauriUpdate().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpdateInstallError);
    expect((error as UpdateInstallError).stage).toBe("download");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it('raises an UpdateInstallError with stage "relaunch" when the update installs but the automatic restart fails', async () => {
    vi.stubGlobal("isTauri", true);
    const downloadAndInstallMock = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ version: "1.2.0", downloadAndInstall: downloadAndInstallMock });
    relaunchMock.mockRejectedValue(new Error("os blocked the restart"));

    const error = await installTauriUpdate().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpdateInstallError);
    expect((error as UpdateInstallError).stage).toBe("relaunch");
  });
});
