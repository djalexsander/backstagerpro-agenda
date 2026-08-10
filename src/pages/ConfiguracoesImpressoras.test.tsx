import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
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
});
