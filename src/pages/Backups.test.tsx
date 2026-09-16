import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P2: /backups (App.tsx) is now wrapped in <ProtectedRoute adminOnly
// requiredModule={MODULE_KEYS.RELATORIOS}>, which itself delegates to
// <ModuleGate mode="lock"> (see ProtectedRoute.tsx) - the exact same
// underlying gate this suite already proved generically in
// ProtectedRoute.test.tsx. This suite renders the real App.tsx composition
// for this one route (not the whole router) to prove the page never mounts
// - and so never queries the backups table - without the module.
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
    role: "admin_empresa" as string | null,
    empresaId: "company-1" as string | null,
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

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MODULE_KEYS } from "@/constants/module-keys";
import Backups from "./Backups";

function renderRoute() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/backups"]}>
        <ProtectedRoute adminOnly requiredModule={MODULE_KEYS.RELATORIOS}>
          <Backups />
        </ProtectedRoute>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("/backups route - module gate (ProtectedRoute requiredModule, as composed in App.tsx)", () => {
  beforeEach(() => {
    authState.user = { id: "user-1" };
    authState.loading = false;
    authState.isAccountActivated = true;
    authState.isAdmin = true;
    authState.isMasterAdmin = false;
    authState.empresaBloqueada = false;
    authState.precisaEscolherPlano = false;
    authState.statusPagamento = null;
    authState.role = "admin_empresa";
    authState.empresaId = "company-1";
    moduleState.enabledKeys = new Set();
    fromMock.mockClear();
  });

  it("shows the locked-module placeholder and never queries backups when relatorios is inactive", async () => {
    renderRoute();

    expect(await screen.findByText(/módulo não disponível/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^backups$/i })).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fromMock).not.toHaveBeenCalledWith("backups");
  });

  it("renders the real Backups page and queries backups once relatorios is active", async () => {
    moduleState.enabledKeys = new Set(["relatorios"]);
    renderRoute();

    expect(await screen.findByRole("heading", { name: /^backups$/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("backups"));
  });

  it("a linked master_admin sees the real page even with relatorios inactive (existing bypass, not a new one)", async () => {
    authState.isMasterAdmin = true;
    renderRoute();

    expect(await screen.findByRole("heading", { name: /^backups$/i })).toBeInTheDocument();
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("backups"));
  });
});
