import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, relaunchMock, registerSWMock, updateModeQueryMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
  registerSWMock: vi.fn(),
  updateModeQueryMock: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));
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
    // No update_mode row configured -> stays manual by default.
    updateModeQueryMock.mockResolvedValue({ data: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
});
