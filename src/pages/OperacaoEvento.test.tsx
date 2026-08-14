import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// empresaId: null mantém as queries internas de PainelOperacional/
// ChecklistCentral desabilitadas (enabled: !!empresaId) - cada uma renderiza
// seu próprio estado vazio de forma síncrona, sem precisar simular a cadeia
// completa do query builder do Supabase. isMasterAdmin: true garante
// canAccess=true nas duas (useModuleAccess), então este teste foca só no
// comportamento de abas/rota da página nova, não nos dados internos das
// telas reaproveitadas (isso é responsabilidade de cada tela, inalterada).
const { authState } = vi.hoisted(() => ({
  authState: { empresaId: null as string | null, isMasterAdmin: true },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => true, isLoading: false }),
}));

import OperacaoEvento from "./OperacaoEvento";

function renderPage(initialPath = "/operacao-evento") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialPath]}>
        <OperacaoEvento />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OperacaoEvento", () => {
  beforeEach(() => {
    authState.empresaId = null;
    authState.isMasterAdmin = true;
  });

  it("reuses the existing Painel Operacional and Checklist pages as tabs of one screen, not duplicated screens", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();

    // Radix TabsTrigger ativa no onMouseDown (não onClick) - ver
    // @radix-ui/react-tabs, então o teste precisa disparar esse evento
    // específico em vez de fireEvent.click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /checklist/i }));

    expect(await screen.findByRole("heading", { name: /checklist técnico/i })).toBeInTheDocument();
  });

  it("defaults to the Painel Operacional tab when opened with no query param", async () => {
    renderPage("/operacao-evento");
    expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();
  });

  it("opens directly on the Checklist tab via ?aba=checklist (old /checklist bookmark redirect)", async () => {
    renderPage("/operacao-evento?aba=checklist");
    expect(await screen.findByRole("heading", { name: /checklist técnico/i })).toBeInTheDocument();
  });

  it("opens directly on the Painel Operacional tab via ?aba=painel (old /painel-operacional bookmark redirect)", async () => {
    renderPage("/operacao-evento?aba=painel");
    expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();
  });
});
