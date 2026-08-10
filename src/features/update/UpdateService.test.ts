import { afterEach, describe, expect, it, vi } from "vitest";

// UpdateService.ts imports the Vite-only "virtual:pwa-register" module,
// resolvable here only via the vitest.config.ts alias to
// src/test/pwa-register-stub.ts - this lets the real module load and
// isTauri() run for real, unlike every other test file in this repo, which
// mocks UpdateService away entirely instead.
import { isTauri } from "./UpdateService";

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
