import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, html2canvasMock } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), html2canvasMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// jsdom has no real canvas 2D context, so html2canvas can't actually
// rasterize anything under vitest - mocked at the module boundary, same
// principle as mocking invoke/isTauri below.
vi.mock("html2canvas", () => ({ default: html2canvasMock }));

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
  getConfiguredPrinter,
  listPrinterConfigs,
  listSystemPrinters,
  printHtmlDocument,
  printHtmlInBrowser,
  printImagesToWindowsPrinter,
  rasterizeHtmlToPngBytes,
  resolveConfiguredPrinter,
  resolveEffectivePrinterConfig,
  savePrinterConfig,
} from "./printer-service";
import { clearTerminalPrinterOverride, saveTerminalPrinterOverride } from "./terminal-printer-config";
import type { PrinterConfig, PrinterPurpose } from "./printer-types";

function config(purpose: PrinterPurpose, overrides: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id: `cfg-${purpose}`, empresa_id: "company-1", finalidade: purpose,
    nome_impressora: `PRINTER-${purpose}`, formato: null, largura_mm: null,
    altura_mm: null, orientacao: "retrato", ativo: true, configuracoes: {},
    perfil_bobina_padrao_id: null,
    ...overrides,
  };
}

// Terminal overrides live in localStorage (see terminal-printer-config.ts),
// which jsdom persists across tests in the same file unless cleared - a
// leftover override from one test would otherwise silently shadow the next
// test's plain DB-config expectations.
beforeEach(() => localStorage.clear());

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

describe("configured printer resolution", () => {
  beforeEach(() => rpc.mockReset());

  it.each<PrinterPurpose>(["etiqueta", "cupom", "documento"])("resolves the active %s configuration", async (purpose) => {
    const expected = config(purpose);
    rpc.mockResolvedValue({ data: [expected], error: null });
    await expect(getConfiguredPrinter("company-1", purpose)).resolves.toEqual(expected);
    expect(rpc).toHaveBeenCalledWith("obter_configuracoes_impressora", { _empresa_id: "company-1" });
  });

  it("ignores inactive and blank-name configurations", () => {
    expect(resolveConfiguredPrinter([config("cupom", { ativo: false })], "cupom")).toBeNull();
    expect(resolveConfiguredPrinter([config("cupom", { nome_impressora: "  " })], "cupom")).toBeNull();
  });

  it.each([
    ["etiqueta", /Nenhuma impressora de etiquetas configurada/],
    ["cupom", /Nenhuma impressora de cupom configurada/],
    ["documento", /Nenhuma impressora de documentos configurada/],
  ] as const)("uses the standardized missing message for %s", async (purpose, message) => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getConfiguredPrinter("company-1", purpose)).rejects.toThrow(message);
  });
});

describe("resolveEffectivePrinterConfig (per-terminal override over the company default)", () => {
  beforeEach(() => rpc.mockReset());

  it("falls back to the company-wide config when this terminal has no override", () => {
    const dbConfig = config("cupom");
    expect(resolveEffectivePrinterConfig("company-1", [dbConfig], "cupom")).toEqual(dbConfig);
  });

  it("prefers this terminal's local override over the company-wide config", () => {
    saveTerminalPrinterOverride("company-1", "cupom", {
      printerName: "POS-LOCAL", format: "80mm", widthMm: 80, heightMm: null,
      orientation: "retrato", bobinaProfileId: null,
    });
    const resolved = resolveEffectivePrinterConfig("company-1", [config("cupom", { nome_impressora: "POS-COMPANY" })], "cupom");
    expect(resolved?.nome_impressora).toBe("POS-LOCAL");
  });

  it("reverts to the company-wide config once the local override is cleared", () => {
    saveTerminalPrinterOverride("company-1", "cupom", {
      printerName: "POS-LOCAL", format: "80mm", widthMm: 80, heightMm: null,
      orientation: "retrato", bobinaProfileId: null,
    });
    clearTerminalPrinterOverride("company-1", "cupom");
    const resolved = resolveEffectivePrinterConfig("company-1", [config("cupom", { nome_impressora: "POS-COMPANY" })], "cupom");
    expect(resolved?.nome_impressora).toBe("POS-COMPANY");
  });

  it("scopes the override to one purpose - an etiqueta override never shadows cupom's company config", () => {
    saveTerminalPrinterOverride("company-1", "etiqueta", {
      printerName: "LABEL-LOCAL", format: "50x30mm", widthMm: 50, heightMm: 30,
      orientation: "retrato", bobinaProfileId: "profile-1",
    });
    const resolved = resolveEffectivePrinterConfig("company-1", [config("cupom", { nome_impressora: "POS-COMPANY" })], "cupom");
    expect(resolved?.nome_impressora).toBe("POS-COMPANY");
  });

  it("scopes the override to one company - never leaks across companies for a master admin switching between them", () => {
    saveTerminalPrinterOverride("company-a", "cupom", {
      printerName: "POS-A", format: "80mm", widthMm: 80, heightMm: null,
      orientation: "retrato", bobinaProfileId: null,
    });
    const resolved = resolveEffectivePrinterConfig("company-b", [config("cupom", { nome_impressora: "POS-B" })], "cupom");
    expect(resolved?.nome_impressora).toBe("POS-B");
  });

  it("getConfiguredPrinter (the function every real print job resolves through) also prefers the local override", async () => {
    rpc.mockResolvedValue({ data: [config("cupom", { nome_impressora: "POS-COMPANY" })], error: null });
    saveTerminalPrinterOverride("company-1", "cupom", {
      printerName: "POS-LOCAL", format: "80mm", widthMm: 80, heightMm: null,
      orientation: "retrato", bobinaProfileId: null,
    });
    await expect(getConfiguredPrinter("company-1", "cupom")).resolves.toEqual(
      expect.objectContaining({ nome_impressora: "POS-LOCAL" }),
    );
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

describe("printHtmlInBrowser", () => {
  it("prints through a same-origin iframe and removes it without using window.open", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    const openSpy = vi.spyOn(window, "open");
    const promise = printHtmlInBrowser("<!doctype html><html><body>recibo</body></html>", "Recibo");
    const iframe = document.querySelector("iframe[aria-hidden='true']") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const focusSpy = vi.spyOn(iframe.contentWindow!, "focus").mockImplementation(() => undefined);
    const printSpy = vi.spyOn(iframe.contentWindow!, "print").mockImplementation(() => undefined);
    iframe.dispatchEvent(new Event("load"));
    await promise;

    expect(focusSpy).toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalled();
    expect(document.body.contains(iframe)).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("rasterizeHtmlToPngBytes", () => {
  // The Vitest 4.1 runner invokes a dynamically-imported mock an extra time
  // during its own teardown, with no arguments (reproduced: stack goes
  // through @vitest/runner's callCleanupHooks, not through
  // rasterizeHtmlToPngBytes) - harmless for the invoke-based tests above
  // since toHaveBeenCalledWith only needs one matching call, but it means
  // any custom mockImplementation here must tolerate a call with no
  // `element` instead of assuming it only ever runs once.
  beforeEach(() => html2canvasMock.mockReset());

  it("renders the html off-screen at the given physical size, then removes the container even on success", async () => {
    let captured: HTMLElement | null = null;
    const fakeBlob = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    html2canvasMock.mockImplementation(async (element?: HTMLElement) => {
      if (element) captured = element;
      return { toBlob: (callback: (blob: unknown) => void) => callback(fakeBlob) };
    });

    const bytes = await rasterizeHtmlToPngBytes({ widthMm: 50, heightMm: 30, html: "<p>ola</p>" });

    expect(captured).not.toBeNull();
    expect(captured!.style.width).toBe("50mm");
    expect(captured!.style.height).toBe("30mm");
    expect(captured!.innerHTML).toContain("ola");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(document.body.contains(captured)).toBe(false);
  });

  it("still removes the offscreen container when html2canvas itself throws", async () => {
    let captured: HTMLElement | null = null;
    html2canvasMock.mockImplementation(async (element?: HTMLElement) => {
      if (!element) return undefined;
      captured = element;
      throw new Error("boom");
    });

    await expect(rasterizeHtmlToPngBytes({ widthMm: 10, heightMm: 10, html: "<p/>" })).rejects.toThrow("boom");
    expect(captured).not.toBeNull();
    expect(document.body.contains(captured)).toBe(false);
  });

  it.each([58, 80])("uses a configured %smm cupom width and measures height dynamically", async (widthMm) => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    rpc.mockResolvedValue({ data: [config("cupom", { largura_mm: widthMm })], error: null });
    let captured: HTMLElement | null = null;
    html2canvasMock.mockImplementation(async (element?: HTMLElement) => {
      if (element) captured = element;
      return { toBlob: (callback: (blob: unknown) => void) => callback({ arrayBuffer: async () => new Uint8Array([1]).buffer }) };
    });
    invoke.mockResolvedValue(undefined);

    await printHtmlDocument({
      companyId: "company-1", purpose: "cupom", documentName: "Cupom", dynamicHeight: true,
      html: ({ widthMm: resolvedWidth }) => `<p>${resolvedWidth}mm</p>`,
    });

    expect(captured!.style.width).toBe(`${widthMm}mm`);
    expect(captured!.style.height).not.toBe("");
    expect(invoke).toHaveBeenCalledWith("print_label_batch", expect.objectContaining({
      jobs: [expect.objectContaining({ widthMm, heightMm: expect.any(Number) })],
    }));
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });
});

describe("printHtmlBatch job.rasterScale", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  beforeEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    invoke.mockReset();
    html2canvasMock.mockReset();
  });
  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
  });

  it("forwards a job's rasterScale as html2canvas's scale option (higher DPI bobina profiles)", async () => {
    rpc.mockResolvedValue({ data: [config("etiqueta")], error: null });
    let capturedScale: number | undefined;
    html2canvasMock.mockImplementation(async (_element?: HTMLElement, options?: { scale?: number }) => {
      capturedScale = options?.scale;
      return { toBlob: (callback: (blob: unknown) => void) => callback({ arrayBuffer: async () => new Uint8Array([1]).buffer }) };
    });
    invoke.mockResolvedValue(undefined);

    await printHtmlDocument({
      companyId: "company-1", purpose: "etiqueta", documentName: "Etiqueta",
      widthMm: 50, heightMm: 30, rasterScale: 300 / 96, html: "<p>etiqueta</p>",
    });

    expect(capturedScale).toBeCloseTo(300 / 96, 5);
  });

  it("omits the scale option (rasterizeHtmlToPngImage's own default) when no job specifies one", async () => {
    rpc.mockResolvedValue({ data: [config("etiqueta")], error: null });
    let capturedOptions: { scale?: number } | undefined;
    html2canvasMock.mockImplementation(async (_element?: HTMLElement, options?: { scale?: number }) => {
      capturedOptions = options;
      return { toBlob: (callback: (blob: unknown) => void) => callback({ arrayBuffer: async () => new Uint8Array([1]).buffer }) };
    });
    invoke.mockResolvedValue(undefined);

    await printHtmlDocument({
      companyId: "company-1", purpose: "etiqueta", documentName: "Etiqueta",
      widthMm: 50, heightMm: 30, html: "<p>etiqueta</p>",
    });

    expect(capturedOptions?.scale).toBe(4); // rasterizeHtmlToPngImage's own default, untouched
  });
});

describe("savePrinterConfig bobina profile link", () => {
  beforeEach(() => rpc.mockReset());

  it("forwards bobinaProfileId as _perfil_bobina_padrao_id", async () => {
    rpc.mockResolvedValue({ data: config("etiqueta"), error: null });
    await savePrinterConfig("company-1", { purpose: "etiqueta", bobinaProfileId: "profile-1" });
    expect(rpc).toHaveBeenCalledWith(
      "salvar_configuracao_impressora",
      expect.objectContaining({ _perfil_bobina_padrao_id: "profile-1" }),
    );
  });

  it("omits the link when no bobina profile is selected", async () => {
    rpc.mockResolvedValue({ data: config("etiqueta"), error: null });
    await savePrinterConfig("company-1", { purpose: "etiqueta" });
    expect(rpc).toHaveBeenCalledWith(
      "salvar_configuracao_impressora",
      expect.objectContaining({ _perfil_bobina_padrao_id: undefined }),
    );
  });
});

describe("printImagesToWindowsPrinter", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  beforeEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    invoke.mockReset();
  });
  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
  });

  it("throws instead of invoking outside the desktop shell", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    await expect(printImagesToWindowsPrinter("LABEL", [], "doc")).rejects.toThrow(/desktop/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the printer name, document name and jobs (bytes as plain arrays) to the Rust command", async () => {
    invoke.mockResolvedValue(undefined);
    await printImagesToWindowsPrinter("LABEL", [{ pngBytes: new Uint8Array([1, 2, 3]), quantity: 3 }], "Etiquetas - lote 1");
    expect(invoke).toHaveBeenCalledWith("print_label_batch", {
      printerName: "LABEL",
      documentName: "Etiquetas - lote 1",
      jobs: [{ pngBytes: [1, 2, 3], quantity: 3, widthMm: undefined, heightMm: undefined }],
    });
  });

  it('maps the Rust "NOT_FOUND" sentinel to a message naming the configured printer', async () => {
    invoke.mockRejectedValue("NOT_FOUND");
    await expect(
      printImagesToWindowsPrinter("LABEL", [{ pngBytes: new Uint8Array(), quantity: 1 }], "doc"),
    ).rejects.toThrow(/"LABEL".*não foi encontrada/);
  });

  it("lets a caller override the not-found and failure messages for flow-specific wording", async () => {
    invoke.mockRejectedValue("NOT_FOUND");
    await expect(
      printImagesToWindowsPrinter("LABEL", [{ pngBytes: new Uint8Array(), quantity: 1 }], "doc", { notFound: "mensagem customizada" }),
    ).rejects.toThrow("mensagem customizada");
  });

  it("wraps any other spool error with a generic message plus the Rust detail", async () => {
    invoke.mockRejectedValue("driver travado");
    await expect(
      printImagesToWindowsPrinter("LABEL", [{ pngBytes: new Uint8Array(), quantity: 1 }], "doc"),
    ).rejects.toThrow(/Não foi possível enviar a impressão.*driver travado/);
  });
});
