import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P2: /financeiro (App.tsx) is now wrapped in <ProtectedRoute adminOnly
// requiredModule={MODULE_KEYS.FINANCEIRO_AVANCADO}>, which itself delegates
// to <ModuleGate mode="lock"> (see ProtectedRoute.tsx) - the exact same
// underlying gate this suite already proved generically in
// ProtectedRoute.test.tsx. This suite renders the real App.tsx composition
// for this one route (not the whole router) to prove the page never mounts
// - and so never queries financials - without the module.
const { authState, moduleState, fromMock } = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1" } as { id: string } | null,
    loading: false,
    isAccountActivated: true,
    isAdmin: true,
    isMasterAdmin: false,
    empresaBloqueada: false,
    precisaEscolherPlano: false,
    statusPagamento: null as string | null,
    empresaId: "company-1" as string | null,
    empresaNome: "Empresa Teste",
    empresaLogoUrl: null as string | null,
    empresaReadOnly: false,
    role: "admin_empresa" as string | null,
  },
  moduleState: { enabledKeys: new Set<string>() },
  fromMock: vi.fn(),
}));

function chainable(result: { data: unknown[]; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    order: () => obj,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return obj;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => { fromMock(table); return chainable({ data: [], error: null }); } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: (featureKey: string) => moduleState.enabledKeys.has(featureKey),
    isLoading: false,
  }),
}));
vi.mock("@/lib/financial-ledger-service", () => ({
  getRentalsFinancialSummary: vi.fn().mockResolvedValue({
    valorContratado: 0, valorRecebido: 0, valorAReceber: 0, valorVencido: 0, valorPendenteRegularizacao: 0,
  }),
  getMaintenanceExpensesSummary: vi.fn().mockResolvedValue({ valorTotal: 0, entries: [] }),
}));
vi.mock("@/components/financeiro/EventosFinanceiroPanel", () => ({
  EventosFinanceiroPanel: () => <div>eventos-panel</div>,
}));
vi.mock("@/components/financeiro/LocacoesReceivablesPanel", () => ({
  LocacoesReceivablesPanel: () => <div>locacoes-panel</div>,
}));
vi.mock("@/components/financeiro/ManutencaoDespesasPanel", () => ({
  ManutencaoDespesasPanel: () => <div>manutencoes-panel</div>,
}));

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MODULE_KEYS } from "@/constants/module-keys";
import Financeiro from "./Financeiro";

function renderRoute() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/financeiro"]}>
        <ProtectedRoute adminOnly requiredModule={MODULE_KEYS.FINANCEIRO_AVANCADO}>
          <Financeiro />
        </ProtectedRoute>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("/financeiro route - module gate (ProtectedRoute requiredModule, as composed in App.tsx)", () => {
  beforeEach(() => {
    authState.user = { id: "user-1" };
    authState.loading = false;
    authState.isAccountActivated = true;
    authState.isAdmin = true;
    authState.isMasterAdmin = false;
    authState.empresaBloqueada = false;
    authState.precisaEscolherPlano = false;
    authState.statusPagamento = null;
    authState.empresaId = "company-1";
    authState.role = "admin_empresa";
    moduleState.enabledKeys = new Set();
    fromMock.mockClear();
  });

  it("shows the locked-module placeholder and never queries financials when financeiro_avancado is inactive", async () => {
    renderRoute();

    expect(await screen.findByText(/módulo não disponível/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^financeiro$/i })).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalledWith("financials");
  });

  it("renders the real Financeiro page and queries financials once financeiro_avancado is active", async () => {
    moduleState.enabledKeys = new Set(["financeiro_avancado"]);
    renderRoute();

    expect(await screen.findByRole("heading", { name: /^financeiro$/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("financials"));
  });
});
