import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// UpdateService.ts imports the Vite-only "virtual:pwa-register" module,
// which doesn't resolve under Vitest. Mocked here with the exact same
// one-liner as the real isTauri() (src/features/update/UpdateService.ts)
// so isDesktopRuntime() is still exercised against real "no __TAURI__
// global" / "window.__TAURI__ set" behaviour, not a stubbed constant.
vi.mock("@/features/update/UpdateService", () => ({
  isTauri: () => Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__),
}));

import {
  isDesktopRuntime,
  isPrinterCurrentlyInstalled,
  listPrinterConfigs,
  listSystemPrinters,
  openPrintWindow,
  savePrinterConfig,
} from "./printer-service";

describe("printer-service RPC calls", () => {
  beforeEach(() => rpc.mockReset());

  it("lists printer configs for the given company via the canonical RPC", async () => {
    rpc.mockResolvedValue({ data: [{ id: "cfg" }], error: null });
    const result = await listPrinterConfigs("company-1");
    expect(rpc).toHaveBeenCalledWith("obter_configuracoes_impressora", { _empresa_id: "company-1" });
    expect(result).toEqual([{ id: "cfg" }]);
  });

  it("saves a printer config via the canonical RPC with the purpose mapped to _finalidade", async () => {
    rpc.mockResolvedValue({ data: { id: "cfg" }, error: null });
    await savePrinterConfig("company-1", {
      purpose: "etiqueta",
      printerName: "Zebra",
      format: "50x30",
      widthMm: 50,
      heightMm: 30,
      orientation: "retrato",
      active: true,
      settings: {},
    });
    expect(rpc).toHaveBeenCalledWith(
      "salvar_configuracao_impressora",
      expect.objectContaining({ _empresa_id: "company-1", _finalidade: "etiqueta", _nome_impressora: "Zebra" }),
    );
  });

  it("maps a known error code to a Portuguese message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PR001", message: "raw" } });
    await expect(listPrinterConfigs("company-1")).rejects.toThrow("Selecione a empresa.");
  });
});

describe("isDesktopRuntime", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
  });

  it("returns false and does not throw when there is no native Tauri bridge on window (plain web build)", () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    expect(() => isDesktopRuntime()).not.toThrow();
    expect(isDesktopRuntime()).toBe(false);
  });

  it("returns true when running inside the Tauri desktop shell", () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    expect(isDesktopRuntime()).toBe(true);
  });
});

describe("listSystemPrinters", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
    invoke.mockReset();
  });

  it("throws a clear error instead of invoking the native bridge outside the desktop shell", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    await expect(listSystemPrinters()).rejects.toThrow(/desktop/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("calls the Rust command and maps its snake_case response into the camelCase SystemPrinter shape", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    invoke.mockResolvedValue([
      { name: "POS-80", is_default: true },
      { name: "TSC E210", is_default: false },
    ]);

    const printers = await listSystemPrinters();

    expect(invoke).toHaveBeenCalledWith("list_windows_printers");
    expect(printers).toEqual([
      { name: "POS-80", isDefault: true },
      { name: "TSC E210", isDefault: false },
    ]);
  });
});

describe("isPrinterCurrentlyInstalled", () => {
  const systemPrinters = [
    { name: "POS-80", isDefault: true },
    { name: "TSC E210", isDefault: false },
  ];

  it("is false when nothing is saved yet", () => {
    expect(isPrinterCurrentlyInstalled(null, systemPrinters)).toBe(false);
    expect(isPrinterCurrentlyInstalled(undefined, systemPrinters)).toBe(false);
    expect(isPrinterCurrentlyInstalled("", systemPrinters)).toBe(false);
  });

  it("matches only an exact name among the currently installed printers", () => {
    expect(isPrinterCurrentlyInstalled("POS-80", systemPrinters)).toBe(true);
    expect(isPrinterCurrentlyInstalled("PT-260", systemPrinters)).toBe(false);
  });
});

describe("openPrintWindow", () => {
  it("opens a popup and writes the given HTML into it, triggering the browser's print flow (web fallback)", () => {
    const popup = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn(), title: "" },
    };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    const result = openPrintWindow("<html>conteúdo</html>", "recibo");

    expect(openSpy).toHaveBeenCalledWith("", "_blank", "popup,width=900,height=700");
    expect(popup.document.write).toHaveBeenCalledWith("<html>conteúdo</html>");
    expect(popup.document.close).toHaveBeenCalled();
    expect(result).toBe(popup);

    openSpy.mockRestore();
  });

  it("throws a clear, actionable error instead of silently failing when the browser blocks the popup", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => openPrintWindow("<html></html>")).toThrow(/pop-up/i);
    openSpy.mockRestore();
  });
});
