import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleGate } from "@/components/ModuleGate";

const access = vi.hoisted(() => ({
  enabledKeys: new Set<string>(),
  loading: false,
  master: false,
  set enabled(value: boolean) {
    if (value) this.enabledKeys.add("gestao_materiais");
    else this.enabledKeys.delete("gestao_materiais");
  },
}));

vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: (featureKey: string) => access.enabledKeys.has(featureKey),
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
    access.enabledKeys.clear();
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

  it("renders when ANY of a list of feature keys is active (public.funcionarios' own OR)", () => {
    access.enabledKeys.add("painel_operacional");
    render(
      <ModuleGate featureKey={["financeiro_avancado", "checklist_tecnico", "painel_operacional"]}>
        <span>funcionarios</span>
      </ModuleGate>,
    );

    expect(screen.getByText("funcionarios")).toBeInTheDocument();
  });

  it("blocks when NONE of a list of feature keys is active", () => {
    render(
      <ModuleGate
        featureKey={["financeiro_avancado", "checklist_tecnico", "painel_operacional"]}
        mode="custom"
        fallback={<span>acesso bloqueado</span>}
      >
        <span>funcionarios</span>
      </ModuleGate>,
    );

    expect(screen.getByText("acesso bloqueado")).toBeInTheDocument();
    expect(screen.queryByText("funcionarios")).not.toBeInTheDocument();
  });
});
