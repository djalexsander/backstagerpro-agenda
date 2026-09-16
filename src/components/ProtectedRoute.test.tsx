import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  loading: false,
  isAccountActivated: true,
  isAdmin: false,
  isMasterAdmin: false,
  empresaBloqueada: false,
  precisaEscolherPlano: false,
  statusPagamento: null as string | null,
}));

// P2: ProtectedRoute agora aceita requiredModule, delegado a <ModuleGate>,
// que por sua vez usa useCompanyModules (+ isMasterAdmin de useAuth, já
// mockado acima). Estado configurável por teste, mesmo padrão já usado em
// ModuleGate.test.tsx.
const moduleState = vi.hoisted(() => ({
  enabledKeys: new Set<string>(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => auth,
}));

vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: (featureKey: string) => moduleState.enabledKeys.has(featureKey),
    isLoading: false,
  }),
}));

import { ProtectedRoute } from "./ProtectedRoute";

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/agenda"]}>
      <Routes>
        <Route
          path="/agenda"
          element={
            <ProtectedRoute>
              <div>conteudo protegido</div>
            </ProtectedRoute>
          }
        />
        <Route path="/primeiro-acesso" element={<div>primeiro acesso</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute activation gate", () => {
  beforeEach(() => {
    auth.user = { id: "user-1" };
    auth.loading = false;
    auth.isAccountActivated = true;
  });

  it("redirects an authenticated unactivated account to Primeiro Acesso", () => {
    auth.isAccountActivated = false;

    renderRoute();

    expect(screen.getByText("primeiro acesso")).toBeInTheDocument();
    expect(screen.queryByText("conteudo protegido")).not.toBeInTheDocument();
  });

  it("keeps protected routes available to an activated account", () => {
    renderRoute();

    expect(screen.getByText("conteudo protegido")).toBeInTheDocument();
  });
});

// P2 (centralização de rotas): requiredModule delega inteiramente a
// <ModuleGate mode="lock"> depois das checagens de auth/role acima - mesmo
// comportamento que a composição manual <ProtectedRoute><ModuleGate>...
// já tinha em App.tsx antes desta etapa, só que centralizado num prop.
describe("ProtectedRoute - requiredModule (centralized module gate)", () => {
  beforeEach(() => {
    auth.user = { id: "user-1" };
    auth.loading = false;
    auth.isAccountActivated = true;
    auth.isAdmin = false;
    auth.isMasterAdmin = false;
    moduleState.enabledKeys = new Set();
  });

  function renderModuleRoute() {
    return render(
      <MemoryRouter initialEntries={["/materiais"]}>
        <Routes>
          <Route
            path="/materiais"
            element={
              <ProtectedRoute requiredModule="gestao_materiais">
                <div>conteudo do modulo</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the ModuleGate lock placeholder and hides the route content when the module is inactive", () => {
    renderModuleRoute();

    expect(screen.getByText("Módulo não disponível")).toBeInTheDocument();
    expect(screen.queryByText("conteudo do modulo")).not.toBeInTheDocument();
  });

  it("renders the route content normally once the module is active", () => {
    moduleState.enabledKeys.add("gestao_materiais");
    renderModuleRoute();

    expect(screen.getByText("conteudo do modulo")).toBeInTheDocument();
    expect(screen.queryByText("Módulo não disponível")).not.toBeInTheDocument();
  });

  it("a master_admin bypasses requiredModule even with the module inactive (ModuleGate's own existing bypass, not a new one)", () => {
    auth.isMasterAdmin = true;
    renderModuleRoute();

    expect(screen.getByText("conteudo do modulo")).toBeInTheDocument();
  });

  it("adminOnly is still checked before requiredModule - a non-admin is redirected and never sees the module gate", () => {
    moduleState.enabledKeys.add("financeiro_avancado");
    render(
      <MemoryRouter initialEntries={["/financeiro"]}>
        <Routes>
          <Route
            path="/financeiro"
            element={
              <ProtectedRoute adminOnly requiredModule="financeiro_avancado">
                <div>conteudo financeiro</div>
              </ProtectedRoute>
            }
          />
          <Route path="/agenda" element={<div>agenda</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("agenda")).toBeInTheDocument();
    expect(screen.queryByText("conteudo financeiro")).not.toBeInTheDocument();
    expect(screen.queryByText("Módulo não disponível")).not.toBeInTheDocument();
  });

  it("supports an array of feature keys with OR semantics, matching /funcionarios", () => {
    moduleState.enabledKeys.add("painel_operacional");
    render(
      <MemoryRouter initialEntries={["/funcionarios"]}>
        <Routes>
          <Route
            path="/funcionarios"
            element={
              <ProtectedRoute requiredModule={["financeiro_avancado", "checklist_tecnico", "painel_operacional"]}>
                <div>conteudo funcionarios</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("conteudo funcionarios")).toBeInTheDocument();
  });

  it("without requiredModule, behaves exactly as before - no ModuleGate involved, no module check", () => {
    render(
      <MemoryRouter initialEntries={["/agenda"]}>
        <Routes>
          <Route
            path="/agenda"
            element={
              <ProtectedRoute>
                <div>conteudo sem modulo</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("conteudo sem modulo")).toBeInTheDocument();
  });
});
