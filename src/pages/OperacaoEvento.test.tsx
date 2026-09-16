import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// empresaId: null mantém as queries internas de PainelOperacional/
// ChecklistCentral desabilitadas (enabled: !!empresaId) - cada uma renderiza
// seu próprio estado vazio de forma síncrona, sem precisar simular a cadeia
// completa do query builder do Supabase. isMasterAdmin: true garante
// canAccess=true nas duas (useModuleAccess), então a maioria destes testes
// foca só no comportamento de abas/rota da página nova, não nos dados
// internos das telas reaproveitadas (isso é responsabilidade de cada tela,
// inalterada). moduleKeys é configurável por teste (P1: abas somem sem o
// respectivo módulo).
const { authState, moduleState } = vi.hoisted(() => ({
  authState: { empresaId: null as string | null, isMasterAdmin: true },
  moduleState: { enabledKeys: new Set<string>(["painel_operacional", "checklist_tecnico"]) },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: (featureKey: string) => moduleState.enabledKeys.has(featureKey),
    isLoading: false,
  }),
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
    moduleState.enabledKeys = new Set(["painel_operacional", "checklist_tecnico"]);
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

  // P1 fix: a tab's trigger must not appear when its own module is inactive,
  // for a non-master user (master keeps bypassing both, covered by the
  // suite's default fixture above).
  describe("P1: tab triggers hidden per module (non-master)", () => {
    beforeEach(() => {
      authState.isMasterAdmin = false;
    });

    it("hides the Checklist tab and defaults to Painel Operacional when only painel_operacional is active", async () => {
      moduleState.enabledKeys = new Set(["painel_operacional"]);
      renderPage();

      expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /checklist/i })).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /painel operacional/i })).toBeInTheDocument();
    });

    it("hides the Painel Operacional tab and defaults to Checklist when only checklist_tecnico is active", async () => {
      moduleState.enabledKeys = new Set(["checklist_tecnico"]);
      renderPage();

      expect(await screen.findByRole("heading", { name: /checklist técnico/i })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /painel operacional/i })).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /checklist/i })).toBeInTheDocument();
    });

    it("shows both tabs when both modules are active", async () => {
      moduleState.enabledKeys = new Set(["painel_operacional", "checklist_tecnico"]);
      renderPage();

      expect(await screen.findByRole("tab", { name: /painel operacional/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /checklist/i })).toBeInTheDocument();
    });
  });
});
