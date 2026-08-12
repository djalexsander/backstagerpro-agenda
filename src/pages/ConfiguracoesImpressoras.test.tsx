import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke, html2canvasMock, toastMock } = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(), html2canvasMock: vi.fn(), toastMock: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
// This page never mounts a <Toaster/> in this test tree, so toast() calls
// wouldn't render anything to assert on - mocked directly instead, same as
// LabelPrintDialog.test.tsx.
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
// html2canvas is exercised for real here (only its own dependency is
// mocked) so this file keeps testing rasterizeHtmlToPngBytes/
// printImagesToWindowsPrinter's real wiring, same "mock the lowest
// boundary" approach already used for invoke/isTauri below. jsdom has no
// real canvas 2D context, hence the mock; always resolves regardless of
// call count/args since Vitest's runner invokes a dynamically-imported
// mock an extra time during teardown (see printer-service.test.ts).
vi.mock("html2canvas", () => ({ default: html2canvasMock }));
// The etiqueta "Testar impressão" card now runs printBobinaTestPage for
// real (see material-label-print.tsx), which renders a real barcode via
// JsBarcode for its synthetic test cells. JsBarcode measures text via a
// real canvas 2D context to lay out the human-readable value - jsdom has
// none (same gap as html2canvas) - so it's mocked minimally, identical to
// material-label-print.test.tsx.
vi.mock("jsbarcode", () => ({
  default: (svg: SVGElement, value: string) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = value;
    svg.appendChild(text);
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ role: "admin_empresa", empresaId: "company", isMasterAdmin: false }),
}));
// Real isTauri() reads window.__TAURI__ directly - mocked with the exact
// same check (not a stubbed constant) so isDesktopRuntime() is genuinely
// exercised against "global present/absent", matching printer-service.test.ts.
vi.mock("@/features/update/UpdateService", () => ({
  isTauri: () => Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__),
}));

import ConfiguracoesImpressoras from "./ConfiguracoesImpressoras";
import { getTerminalPrinterOverride, saveTerminalPrinterOverride } from "@/lib/terminal-printer-config";

const etiquetaConfig = {
  id: "cfg-1", empresa_id: "company", finalidade: "etiqueta", nome_impressora: "PT-260",
  formato: "50x30mm", largura_mm: 50, altura_mm: 30, orientacao: "retrato", ativo: true, configuracoes: {},
  perfil_bobina_padrao_id: null,
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ConfiguracoesImpressoras /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConfiguracoesImpressoras", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    invoke.mockReset();
    toastMock.mockReset();
    html2canvasMock.mockReset();
    html2canvasMock.mockResolvedValue({
      toBlob: (callback: (blob: unknown) => void) => callback({ arrayBuffer: async () => new Uint8Array([9]).buffer }),
    });
  });
  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
  });

  it("prefers this terminal's saved local override over the company-wide printer, both for display and for the actual test print", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null }); // company default nome_impressora: "PT-260"
    saveTerminalPrinterOverride("company", "etiqueta", {
      printerName: "LOCAL-LABEL", format: "50x30mm", widthMm: 50, heightMm: 30,
      orientation: "retrato", bobinaProfileId: null,
    });
    invoke.mockImplementation((command: string) => {
      if (command === "list_windows_printers") return Promise.resolve([{ name: "LOCAL-LABEL", is_default: false }]);
      if (command === "print_label_batch") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });

    renderPage();
    expect(await screen.findByText(/Configuração específica deste terminal/i)).toBeInTheDocument();

    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("print_label_batch", expect.objectContaining({ printerName: "LOCAL-LABEL" })),
    );
  });

  it("keeps the manual nickname text field on the web build and never touches the native bridge", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null });

    renderPage();

    expect(screen.getByText(/Navegador não tem acesso/i)).toBeInTheDocument();
    // The banner text renders on the first paint regardless of data; wait
    // on the config-derived value instead so the query has actually settled.
    expect(await screen.findByDisplayValue("PT-260")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("on desktop, shows the Windows default printer and flags the saved selection as offline once it's no longer installed", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null });
    invoke.mockResolvedValue([{ name: "TSC E210", is_default: true }]);

    renderPage();

    expect(await screen.findByText(/padrão do sistema/i)).toBeInTheDocument();
    expect(await screen.findByText(/"PT-260" não encontrada\/offline/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_windows_printers");
  });

  it("on desktop, 'Testar impressão' sends the test content straight to the configured printer instead of opening a window", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null });
    invoke.mockImplementation((command: string) => {
      if (command === "list_windows_printers") return Promise.resolve([{ name: "PT-260", is_default: false }]);
      if (command === "print_label_batch") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected invoke: ${command}`));
    });
    const openSpy = vi.spyOn(window, "open");

    renderPage();
    // PURPOSES = ["etiqueta", "cupom", "documento"] - the first card/button is etiqueta.
    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "print_label_batch",
        expect.objectContaining({ printerName: "PT-260" }),
      ),
    );
    expect(openSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Teste enviado para a impressora" })),
    );
    openSpy.mockRestore();
  });

  it("on desktop, 'Testar impressão' shows a specific error instead of failing silently when no printer is configured", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    rpc.mockResolvedValue({ data: [], error: null });
    invoke.mockResolvedValue([{ name: "PT-260", is_default: false }]);

    renderPage();
    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/Nenhuma impressora de etiquetas configurada/) }),
      ),
    );
    expect(invoke).not.toHaveBeenCalledWith("print_label_batch", expect.anything());
  });

  it("on web, 'Testar impressão' uses a disposable iframe instead of a popup or native bridge", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null });
    const openSpy = vi.spyOn(window, "open");
    const focusMock = vi.fn();
    const printMock = vi.fn();
    const nativeCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = nativeCreateElement(tagName, options);
      if (tagName.toLowerCase() === "iframe") {
        Object.defineProperty(element, "contentWindow", { value: { focus: focusMock, print: printMock } });
        Object.defineProperty(element, "contentDocument", { value: document });
      }
      return element;
    }) as typeof document.createElement);

    renderPage();
    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    const iframe = await waitFor(() => {
      const found = document.querySelector("iframe[aria-hidden='true']") as HTMLIFrameElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    iframe.dispatchEvent(new Event("load"));
    await waitFor(() => expect(printMock).toHaveBeenCalled());
    expect(focusMock).toHaveBeenCalled();
    await waitFor(() => expect(document.body.contains(iframe)).toBe(false));
    expect(openSpy).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("print_label_batch", expect.anything());
    createElementSpy.mockRestore();
    openSpy.mockRestore();
  });
});

describe("ConfiguracoesImpressoras bobina profile wiring", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  const bobinaProfile = {
    id: "profile-1", empresa_id: "company", nome: "50x30 - 2 colunas",
    largura_etiqueta_mm: 50, altura_etiqueta_mm: 30, colunas: 2,
    espacamento_horizontal_mm: 4, espacamento_vertical_mm: 2,
    margem_esquerda_mm: 2, margem_direita_mm: 2, margem_superior_mm: 2, margem_inferior_mm: 2,
    orientacao: "retrato", largura_midia_mm: null, offset_horizontal_mm: 0, offset_vertical_mm: 0,
    dpi: "automatico", dpi_personalizado: null, padrao: true, ativo: true, updated_at: "2026-01-01T00:00:00Z",
  };
  const linkedConfig = { ...etiquetaConfig, perfil_bobina_padrao_id: "profile-1" };

  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    rpc.mockReset();
    invoke.mockReset();
    toastMock.mockReset();
    rpc.mockImplementation((name: string) => {
      if (name === "listar_perfis_bobina") return Promise.resolve({ data: [bobinaProfile], error: null });
      if (name === "obter_configuracoes_impressora") return Promise.resolve({ data: [linkedConfig], error: null });
      if (name === "salvar_configuracao_impressora") return Promise.resolve({ data: linkedConfig, error: null });
      return Promise.resolve({ data: null, error: null });
    });
  });
  afterEach(() => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
  });

  it("lists available bobina profiles in the etiqueta card's picker", async () => {
    renderPage();
    expect(await screen.findByText(/50x30 - 2 colunas · 50×30mm · 2 col\./)).toBeInTheDocument();
  });

  it("'Salvar' persists the selected bobina profile id locally for this terminal, without touching the company-wide RPC by default", async () => {
    renderPage();
    await screen.findByText(/50x30 - 2 colunas · 50×30mm · 2 col\./);
    rpc.mockClear();

    fireEvent.click(screen.getAllByRole("button", { name: /^salvar$/i })[0]);

    await waitFor(() =>
      expect(getTerminalPrinterOverride("company", "etiqueta")?.bobinaProfileId).toBe("profile-1"),
    );
    expect(rpc).not.toHaveBeenCalledWith("salvar_configuracao_impressora", expect.anything());
    expect(await screen.findByText(/Configuração específica deste terminal/i)).toBeInTheDocument();
  });

  it("also writes the company-wide RPC when 'Definir também como padrão da empresa' is checked before saving", async () => {
    renderPage();
    await screen.findByText(/50x30 - 2 colunas · 50×30mm · 2 col\./);
    rpc.mockClear();

    fireEvent.click(screen.getAllByRole("checkbox", { name: /definir também como padrão da empresa/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^salvar$/i })[0]);

    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      "salvar_configuracao_impressora",
      expect.objectContaining({ _perfil_bobina_padrao_id: "profile-1" }),
    ));
  });

  it("'Usar padrão da empresa' clears this terminal's override and reverts the card to the company config", async () => {
    renderPage();
    await screen.findByText(/50x30 - 2 colunas · 50×30mm · 2 col\./);
    fireEvent.click(screen.getAllByRole("button", { name: /^salvar$/i })[0]);
    await screen.findByText(/Configuração específica deste terminal/i);

    fireEvent.click(screen.getByRole("button", { name: /usar padrão da empresa/i }));

    await waitFor(() => expect(getTerminalPrinterOverride("company", "etiqueta")).toBeNull());
    expect(screen.queryByText(/Configuração específica deste terminal/i)).not.toBeInTheDocument();
  });

  it("runs the etiqueta test print through the bobina pipeline, rendering one cell per column from the linked profile", async () => {
    const openSpy = vi.spyOn(window, "open");
    renderPage();
    await screen.findByText(/50x30 - 2 colunas · 50×30mm · 2 col\./);

    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    const iframe = await waitFor(() => {
      const found = document.querySelector("iframe[aria-hidden='true']") as HTMLIFrameElement | null;
      expect(found).not.toBeNull();
      return found!;
    });
    expect(iframe.srcdoc).toContain("TESTE");
    expect(iframe.srcdoc).toContain("Coluna 1");
    expect(iframe.srcdoc).toContain("Coluna 2");
    expect(iframe.srcdoc.match(/class="label"/g)).toHaveLength(2);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
