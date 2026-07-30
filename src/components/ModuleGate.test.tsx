import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleGate } from "@/components/ModuleGate";

const access = vi.hoisted(() => ({
  enabled: false,
  loading: false,
  master: false,
}));

vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: () => access.enabled,
    isLoading: access.loading,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isMasterAdmin: access.master,
  }),
}));

describe("ModuleGate", () => {
  beforeEach(() => {
    access.enabled = false;
    access.loading = false;
    access.master = false;
  });

  it("blocks a protected route when the company module is disabled", () => {
    render(
      <ModuleGate
        featureKey="gestao_materiais"
        mode="custom"
        fallback={<span>acesso bloqueado</span>}
      >
        <span>materiais</span>
      </ModuleGate>,
    );

    expect(screen.getByText("acesso bloqueado")).toBeInTheDocument();
    expect(screen.queryByText("materiais")).not.toBeInTheDocument();
  });

  it("shows a controlled unavailable state in lock mode", () => {
    render(
      <ModuleGate featureKey="gestao_materiais" mode="lock">
        <span>materiais</span>
      </ModuleGate>,
    );

    expect(screen.getByText("Módulo não disponível")).toBeInTheDocument();
    expect(screen.queryByText("materiais")).not.toBeInTheDocument();
  });

  it("renders the protected route when the module is active", () => {
    access.enabled = true;
    render(
      <ModuleGate featureKey="gestao_materiais">
        <span>materiais</span>
      </ModuleGate>,
    );

    expect(screen.getByText("materiais")).toBeInTheDocument();
  });

  it("preserves the global master bypass", () => {
    access.master = true;
    render(
      <ModuleGate featureKey="gestao_materiais">
        <span>materiais</span>
      </ModuleGate>,
    );

    expect(screen.getByText("materiais")).toBeInTheDocument();
  });
});
