import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, relaunchMock, registerSWMock, updateModeQueryMock, toastErrorMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
  registerSWMock: vi.fn(),
  updateModeQueryMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock, success: vi.fn(), message: vi.fn() } }));
// Overrides the vitest.config.ts alias (src/test/pwa-register-stub.ts) just
// for this file: that stub never invokes its onNeedRefresh callback at all,
// which is fine for tests that don't care, but the web/PWA integration
// test below needs to actually trigger it.
vi.mock("virtual:pwa-register", () => ({ registerSW: registerSWMock }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: updateModeQueryMock }),
      }),
    }),
  },
}));

import { UpdateProvider } from "./UpdateProvider";
import { UpdateBanner } from "./UpdateBanner";
import { PWA_DISMISS_REARM_AFTER_MS } from "./UpdateService";

function renderApp() {
  return render(
    <UpdateProvider>
      <UpdateBanner />
    </UpdateProvider>,
  );
}

describe("UpdateProvider + UpdateBanner integration", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
    registerSWMock.mockReset();
    registerSWMock.mockReturnValue(() => Promise.resolve());
    updateModeQueryMock.mockReset();
    toastErrorMock.mockReset();
    // No update_mode row configured -> stays manual by default.
    updateModeQueryMock.mockResolvedValue({ data: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  // A web/PWA session with the banner already showing (registerSW captured,
  // onNeedRefresh fired). Returns the captured lifecycle callbacks.
  async function renderPwaBannerShowing() {
    let captured: { onNeedRefresh?: () => void } = {};
    registerSWMock.mockImplementation((options: { onNeedRefresh?: () => void }) => {
      captured = options;
      return () => Promise.resolve();
    });
    const view = renderApp();
    captured.onNeedRefresh?.();
    await screen.findByRole("button", { name: /atualizar agora/i });
    return { view, captured };
  }

  it("stays hidden when the desktop check finds nothing", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue(null);
    renderApp();
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument();
  });

  it("shows the banner with the version once a desktop update is found", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue({ version: "1.2.0", close: vi.fn().mockResolvedValue(undefined) });
    renderApp();
    expect(await screen.findByText("v1.2.0")).toBeInTheDocument();
  });

  it("web/PWA path: shows the banner (without a version) when the service worker reports onNeedRefresh", async () => {
    let captured: { onNeedRefresh?: () => void } = {};
    registerSWMock.mockImplementation((options: { onNeedRefresh?: () => void }) => {
      captured = options;
      return () => Promise.resolve();
    });

    renderApp();
    expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument();
    captured.onNeedRefresh?.();
    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument();
    // PWA path never reports a version string (see registerPWAUpdate).
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });

  it("manual click installs and relaunches; the button is not left disabled afterwards", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue({
      version: "1.2.0",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    relaunchMock.mockResolvedValue(undefined);
    renderApp();
    await screen.findByText("v1.2.0");

    fireEvent.click(screen.getByRole("button", { name: /atualizar agora/i }));

    await waitFor(() => expect(relaunchMock).toHaveBeenCalled());
  });

  it("manual click failure resets isUpdating (button clickable again) and shows a friendly error", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue({
      version: "1.2.0",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("network blip")),
    });
    renderApp();
    await screen.findByText("v1.2.0");

    fireEvent.click(screen.getByRole("button", { name: /atualizar agora/i }));

    expect(await screen.findByText("Falha ao baixar/instalar a atualização.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar agora/i })).not.toBeDisabled();
  });

  it("automatic mode (system_settings.update_mode = 'auto') installs without any click", async () => {
    vi.stubGlobal("isTauri", true);
    updateModeQueryMock.mockResolvedValue({ data: { value: "auto" } });
    checkMock.mockResolvedValue({
      version: "1.2.0",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    relaunchMock.mockResolvedValue(undefined);

    renderApp();

    await waitFor(() => expect(relaunchMock).toHaveBeenCalled());
  });

  it("regression: automatic-mode failure resets isUpdating instead of leaving the banner stuck on 'Atualizando...' forever", async () => {
    vi.stubGlobal("isTauri", true);
    updateModeQueryMock.mockResolvedValue({ data: { value: "auto" } });
    checkMock.mockResolvedValue({
      version: "1.2.0",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("disk full")),
    });

    renderApp();

    expect(await screen.findByText("Falha ao baixar/instalar a atualização.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar agora/i })).not.toBeDisabled();
  });

  it("manual mode is untouched by a missing/unreadable update_mode row (stays manual, no crash)", async () => {
    vi.stubGlobal("isTauri", true);
    updateModeQueryMock.mockRejectedValue(new Error("table not found"));
    checkMock.mockResolvedValue({ version: "1.2.0", close: vi.fn().mockResolvedValue(undefined) });

    renderApp();

    expect(await screen.findByText("v1.2.0")).toBeInTheDocument();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("dismissing hides the banner", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue({ version: "1.2.0", close: vi.fn().mockResolvedValue(undefined) });
    renderApp();
    await screen.findByText("v1.2.0");

    fireEvent.click(screen.getByLabelText(/dispensar/i));

    // AnimatePresence keeps the element mounted through its exit transition
    // (exit={{ y: -80, opacity: 0 }}) - it leaves the DOM once that
    // resolves, not synchronously on the state change that triggered it.
    await waitFor(() => expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument());
  });

  it("web/PWA: a dismissed banner comes back when a fresh onNeedRefresh fires (e.g. a second deploy)", async () => {
    let captured: { onNeedRefresh?: () => void } = {};
    registerSWMock.mockImplementation((options: { onNeedRefresh?: () => void }) => {
      captured = options;
      return () => Promise.resolve();
    });

    renderApp();
    captured.onNeedRefresh?.();
    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/dispensar/i));
    await waitFor(() =>
      expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument(),
    );

    captured.onNeedRefresh?.();
    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument();
  });

  it("web/PWA: a dismissed banner returns on a later foreground while the update is still pending", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    let captured: { onNeedRefresh?: () => void } = {};
    registerSWMock.mockImplementation((options: { onNeedRefresh?: () => void }) => {
      captured = options;
      return () => Promise.resolve();
    });

    renderApp();
    captured.onNeedRefresh?.();
    await screen.findByText(/Nova versão disponível/i);

    fireEvent.click(screen.getByLabelText(/dispensar/i));
    await waitFor(() =>
      expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument(),
    );

    // user comes back to the app well after PWA_DISMISS_REARM_AFTER_MS
    nowSpy.mockReturnValue(1_000_000 + PWA_DISMISS_REARM_AFTER_MS + 1);
    fireEvent(document, new Event("visibilitychange"));

    expect(await screen.findByText(/Nova versão disponível/i)).toBeInTheDocument();
  });

  it("web/PWA: a dismissed banner stays hidden on a foreground shortly afterwards (no spam)", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    let captured: { onNeedRefresh?: () => void } = {};
    registerSWMock.mockImplementation((options: { onNeedRefresh?: () => void }) => {
      captured = options;
      return () => Promise.resolve();
    });

    renderApp();
    captured.onNeedRefresh?.();
    await screen.findByText(/Nova versão disponível/i);

    fireEvent.click(screen.getByLabelText(/dispensar/i));
    await waitFor(() =>
      expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument(),
    );

    nowSpy.mockReturnValue(1_000_000 + 90 * 1000); // 90s later - too soon
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument();
  });

  it("Tauri shell: never registers a PWA service worker", async () => {
    vi.stubGlobal("isTauri", true);
    checkMock.mockResolvedValue(null);

    renderApp();

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(registerSWMock).not.toHaveBeenCalled();
  });

  it("web/PWA: unmounting the provider removes the update listeners it added", () => {
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderApp();
    unmount();

    expect(docRemove.mock.calls.map((call) => call[0])).toContain("visibilitychange");
    expect(winRemove.mock.calls.map((call) => call[0])).toContain("focus");
  });

  it("web/PWA: the update button is clickable the moment the banner appears", async () => {
    await renderPwaBannerShowing();
    expect(screen.getByRole("button", { name: /atualizar agora/i })).toBeEnabled();
  });

  it("web/PWA: clicking shows 'Atualizando...' (disabled), then recovers with an error + toast on failure", async () => {
    let resolveGetRegistration: (v: unknown) => void = () => {};
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: () => new Promise((r) => { resolveGetRegistration = r; }) },
    });

    await renderPwaBannerShowing();

    fireEvent.click(screen.getByRole("button", { name: /atualizar agora/i }));

    // in-flight: button locked and labelled "Atualizando..."
    expect(await screen.findByRole("button", { name: /atualizando/i })).toBeDisabled();

    // installPWAUpdate can't find a registration -> controlled failure
    resolveGetRegistration(undefined);

    expect(
      await screen.findByText("Não foi possível aplicar a atualização. Tente novamente."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar agora/i })).toBeEnabled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível aplicar a atualização. Tente novamente.",
    );
  });

  it("web/PWA: a stuck 'Atualizando...' is freed if a newer version is detected", async () => {
    // never resolves -> the button would otherwise stay "Atualizando..."
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: () => new Promise(() => {}) },
    });

    const { captured } = await renderPwaBannerShowing();
    fireEvent.click(screen.getByRole("button", { name: /atualizar agora/i }));
    await screen.findByRole("button", { name: /atualizando/i });

    // a fresh onNeedRefresh (e.g. yet another deploy) clears the stuck state
    captured.onNeedRefresh?.();

    expect(await screen.findByRole("button", { name: /atualizar agora/i })).toBeEnabled();
  });
});
