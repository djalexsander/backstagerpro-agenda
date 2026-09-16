import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 fix regression: useQuery.enabled must require canAccess (useModuleAccess),
// not just !!empresaId - otherwise the operational-data fetch fires before the
// module gate resolves, even though the placeholder ends up shown anyway.
const { authState, moduleState, fromMock } = vi.hoisted(() => ({
  authState: { empresaId: "company-1" as string | null, isMasterAdmin: false },
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

import PainelOperacional from "./PainelOperacional";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PainelOperacional />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PainelOperacional - P1 module gate", () => {
  beforeEach(() => {
    authState.empresaId = "company-1";
    authState.isMasterAdmin = false;
    moduleState.enabledKeys = new Set();
    fromMock.mockClear();
  });

  it("shows the module-inactive placeholder and never fetches operational data when painel_operacional is inactive", async () => {
    renderPage();

    expect(await screen.findByText(/módulo painel operacional não ativo/i)).toBeInTheDocument();
    // level: 1 targets the real page's <h1> specifically - the placeholder's
    // own <h2> ("Módulo Painel Operacional não ativo") also matches a loose
    // /painel operacional/i name and would otherwise false-negative this.
    expect(screen.queryByRole("heading", { level: 1, name: /painel operacional/i })).not.toBeInTheDocument();

    // Give any wrongly-enabled query a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalledWith("events");
    expect(fromMock).not.toHaveBeenCalledWith("event_funcionarios");
    expect(fromMock).not.toHaveBeenCalledWith("event_checklist_items");
  });

  it("fetches operational data and renders normally once painel_operacional is active", async () => {
    moduleState.enabledKeys = new Set(["painel_operacional"]);
    renderPage();

    expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("events"));
    expect(fromMock).toHaveBeenCalledWith("event_funcionarios");
    expect(fromMock).toHaveBeenCalledWith("event_checklist_items");
  });

  it("a linked master_admin sees the real panel (existing bypass, not a new one) even with the module inactive", async () => {
    authState.isMasterAdmin = true;
    renderPage();

    expect(await screen.findByRole("heading", { name: /painel operacional/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("events"));
  });
});
