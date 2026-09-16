import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 fix: the 4 financial cards, the "Financeiro Mensal" chart and the
// financials-dashboard query itself must all be gated on financeiro_avancado
// (useModuleAccess), not rendered/fetched unconditionally.
const { authState, moduleState, fromMock } = vi.hoisted(() => ({
  authState: { empresaId: "company-1" as string | null, role: "admin_empresa" as string | null, isMasterAdmin: false },
  moduleState: { enabledKeys: new Set<string>() },
  fromMock: vi.fn(),
}));

function chainable(result: { data: unknown[]; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
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
}));

import Dashboard from "./Dashboard";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard - P1 financeiro_avancado gate", () => {
  beforeEach(() => {
    authState.empresaId = "company-1";
    authState.role = "admin_empresa";
    authState.isMasterAdmin = false;
    moduleState.enabledKeys = new Set();
    fromMock.mockClear();
  });

  it("hides the 4 financial cards and the Financeiro Mensal chart, and never queries financials, when financeiro_avancado is inactive", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.queryByText("Lucro líquido")).not.toBeInTheDocument();
    expect(screen.queryByText("Financeiro Mensal")).not.toBeInTheDocument();
    // Core (non-financial) content stays unaffected.
    expect(screen.getByText("Status dos Eventos")).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalledWith("financials");
  });

  it("shows the 4 financial cards and the Financeiro Mensal chart, and queries financials, when financeiro_avancado is active", async () => {
    moduleState.enabledKeys = new Set(["financeiro_avancado"]);
    renderPage();

    expect(await screen.findByText("Lucro líquido")).toBeInTheDocument();
    expect(screen.getByText("Financeiro Mensal")).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("financials"));
  });

  it("a linked master_admin sees the financial cards even with financeiro_avancado inactive (existing bypass, not a new one)", async () => {
    authState.isMasterAdmin = true;
    renderPage();

    expect(await screen.findByText("Lucro líquido")).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("financials"));
  });
});
