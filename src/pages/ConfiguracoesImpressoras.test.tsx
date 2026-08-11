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

const etiquetaConfig = {
  id: "cfg-1", empresa_id: "company", finalidade: "etiqueta", nome_impressora: "PT-260",
  formato: "50x30mm", largura_mm: 50, altura_mm: 30, orientacao: "retrato", ativo: true, configuracoes: {},
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
        expect.objectContaining({ description: expect.stringMatching(/Nenhuma impressora configurada para "Etiquetas"/) }),
      ),
    );
    expect(invoke).not.toHaveBeenCalledWith("print_label_batch", expect.anything());
  });

  it("on web, 'Testar impressão' still opens a popup instead of calling the native bridge", async () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    rpc.mockResolvedValue({ data: [etiquetaConfig], error: null });
    const popup = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn(), title: "" } };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    renderPage();
    const testButtons = await screen.findAllByRole("button", { name: /testar impressão/i });
    fireEvent.click(testButtons[0]);

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("", "_blank", "popup,width=900,height=700"));
    expect(invoke).not.toHaveBeenCalledWith("print_label_batch", expect.anything());
    openSpy.mockRestore();
  });
});
