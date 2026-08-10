import { afterEach, describe, expect, it, vi } from "vitest";

const { isTauri, invoke, openUrl } = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("@/features/update/UpdateService", () => ({ isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { openWhatsApp } from "./whatsapp-launcher";

const PROTOCOL_URL = "whatsapp://send?phone=5511999998888&text=oi";
const WEB_URL = "https://wa.me/5511999998888?text=oi";

describe("openWhatsApp", () => {
  afterEach(() => {
    isTauri.mockReset();
    invoke.mockReset();
    openUrl.mockReset();
  });

  it("on desktop with WhatsApp installed, tries the whatsapp:// protocol first and never touches window.open", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
    openUrl.mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, "open");

    await openWhatsApp("5511999998888", "oi");

    expect(invoke).toHaveBeenCalledWith("is_whatsapp_app_available");
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(PROTOCOL_URL);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("does not fall back to wa.me once the whatsapp:// protocol succeeds", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
    openUrl.mockResolvedValue(undefined);

    await openWhatsApp("5511999998888", "oi");

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).not.toHaveBeenCalledWith(WEB_URL);
  });

  it("falls back to https://wa.me when the app is available but the protocol launch itself fails", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
    openUrl.mockRejectedValueOnce(new Error("launch failed")).mockResolvedValueOnce(undefined);
    const openSpy = vi.spyOn(window, "open");

    await openWhatsApp("5511999998888", "oi");

    expect(openUrl).toHaveBeenNthCalledWith(1, PROTOCOL_URL);
    expect(openUrl).toHaveBeenNthCalledWith(2, WEB_URL);
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("falls back to https://wa.me straight away when no app is registered for the protocol, without ever attempting it", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(false);
    openUrl.mockResolvedValue(undefined);

    await openWhatsApp("5511999998888", "oi");

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(WEB_URL);
  });

  it("treats a failed availability check as unavailable instead of throwing", async () => {
    isTauri.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("command not found"));
    openUrl.mockResolvedValue(undefined);

    await openWhatsApp("5511999998888", "oi");

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(WEB_URL);
  });

  it("on the web/PWA build, always opens wa.me via window.open and never touches Tauri APIs", async () => {
    isTauri.mockReturnValue(false);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    await openWhatsApp("5511999998888", "oi");

    expect(openSpy).toHaveBeenCalledWith(WEB_URL, "_blank", "noopener,noreferrer");
    expect(invoke).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
