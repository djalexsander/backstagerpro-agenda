import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 fix regression: useQuery.enabled must require canAccess (useModuleAccess),
// not just !!empresaId - otherwise the checklist-data fetch fires before the
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
    order: () => obj,
    limit: () => obj,
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

import ChecklistCentral from "./ChecklistCentral";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ChecklistCentral />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ChecklistCentral - P1 module gate", () => {
  beforeEach(() => {
    authState.empresaId = "company-1";
    authState.isMasterAdmin = false;
    moduleState.enabledKeys = new Set();
    fromMock.mockClear();
  });

  it("shows the module-inactive placeholder and never fetches checklist data when checklist_tecnico is inactive", async () => {
    renderPage();

    expect(await screen.findByText(/módulo checklist não ativo/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /checklist técnico/i })).not.toBeInTheDocument();

    // Give any wrongly-enabled query a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalledWith("events");
    expect(fromMock).not.toHaveBeenCalledWith("event_checklist_items");
  });

  it("fetches checklist data and renders normally once checklist_tecnico is active", async () => {
    moduleState.enabledKeys = new Set(["checklist_tecnico"]);
    renderPage();

    expect(await screen.findByRole("heading", { name: /checklist técnico/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("events"));
    expect(fromMock).toHaveBeenCalledWith("event_checklist_items");
  });

  it("a linked master_admin sees the real checklist (existing bypass, not a new one) even with the module inactive", async () => {
    authState.isMasterAdmin = true;
    renderPage();

    expect(await screen.findByRole("heading", { name: /checklist técnico/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("events"));
  });
});
