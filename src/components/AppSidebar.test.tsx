import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

const mockUseAuth = vi.fn();
const mockUseCompanyModules = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => mockUseCompanyModules(),
}));
vi.mock("@/hooks/useSystemSettings", () => ({
  usePlatformBranding: () => ({ platformName: "Backstage Pro", platformLogoUrl: null, isLoading: false }),
}));

function renderSidebar(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function baseAuth(overrides: Partial<ReturnType<typeof mockUseAuth>> = {}) {
  return {
    isMasterAdmin: false,
    isAdminEmpresa: true,
    profile: { full_name: "Admin" },
    signOut: vi.fn(),
    empresaLogoUrl: null,
    empresaNome: "Empresa Teste",
    empresaReadOnly: false,
    role: "admin_empresa",
    ...overrides,
  };
}

describe("AppSidebar grouping", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseCompanyModules.mockReset();
  });

  it("preserves module gates: only shows items whose module is enabled, hides the rest", () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseCompanyModules.mockReturnValue({
      hasModule: (key: string) => key === "controle_estoque",
    });

    renderSidebar();

    expect(screen.getByText("Estoque")).toBeInTheDocument();
    expect(screen.queryByText("Materiais")).not.toBeInTheDocument();
    expect(screen.queryByText("Locações")).not.toBeInTheDocument();
    expect(screen.queryByText("Etiquetas")).not.toBeInTheDocument();
  });

  it("hides an entire group when none of its items are available", () => {
    mockUseAuth.mockReturnValue(baseAuth({ isAdminEmpresa: false, role: "usuario" }));
    mockUseCompanyModules.mockReturnValue({ hasModule: () => false });

    renderSidebar();

    // "Materiais & Operações" tem zero itens disponiveis para um usuario sem
    // nenhum modulo - o grupo inteiro não deve aparecer.
    expect(screen.queryByText("Materiais & Operações")).not.toBeInTheDocument();
    // "Administração" também é vazio para "usuario" (mesma regra de antes:
    // moduleGatedItems nunca entrava no menu de usuario comum).
    expect(screen.queryByText("Administração")).not.toBeInTheDocument();
    // "Principal" continua existindo porque Agenda é sempre visível.
    expect(screen.getByText("Agenda")).toBeInTheDocument();
  });

  it("always offers the Impressoras configuration entry for any recognized role", () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseCompanyModules.mockReturnValue({ hasModule: () => false });

    renderSidebar();

    expect(screen.getByText("Impressoras")).toBeInTheDocument();
  });

  it("does not leak master-only navigation to a company admin", () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseCompanyModules.mockReturnValue({ hasModule: () => true });

    renderSidebar();

    expect(screen.queryByText("Painel Master")).not.toBeInTheDocument();
    expect(screen.queryByText("Empresas")).not.toBeInTheDocument();
  });

  it("shows every module-gated item for master_admin regardless of the company's own module flags", () => {
    mockUseAuth.mockReturnValue(baseAuth({ isMasterAdmin: true, isAdminEmpresa: false, role: "master_admin" }));
    mockUseCompanyModules.mockReturnValue({ hasModule: () => false });

    renderSidebar();

    expect(screen.getByText("Materiais")).toBeInTheDocument();
    expect(screen.getByText("Locações")).toBeInTheDocument();
    // "Financeiro" aparece 2x para master: uma vez em Master (/master/financeiro)
    // e outra no grupo Administração da empresa (/financeiro) - preserva o
    // comportamento anterior de mostrar as duas seções simultaneamente.
    expect(screen.getAllByText("Financeiro").length).toBe(2);
    expect(screen.getByText("Painel Master")).toBeInTheDocument();
  });

  describe("Operação do Evento (Painel Operacional + Checklist consolidados)", () => {
    it("never shows Painel Operacional or Checklist as standalone entries, regardless of module state", () => {
      mockUseAuth.mockReturnValue(baseAuth());
      mockUseCompanyModules.mockReturnValue({ hasModule: () => true });

      renderSidebar();

      expect(screen.queryByText("Painel Operacional")).not.toBeInTheDocument();
      expect(screen.queryByText("Checklist")).not.toBeInTheDocument();
    });

    it("shows the single 'Operação do Evento' entry inside Materiais & Operações when only Painel Operacional is active", () => {
      mockUseAuth.mockReturnValue(baseAuth());
      mockUseCompanyModules.mockReturnValue({ hasModule: (key: string) => key === "painel_operacional" });

      renderSidebar();

      expect(screen.getByText("Operação do Evento")).toBeInTheDocument();
    });

    it("shows 'Operação do Evento' when only Checklist Técnico is active (the other module being off doesn't hide the merged entry)", () => {
      mockUseAuth.mockReturnValue(baseAuth());
      mockUseCompanyModules.mockReturnValue({ hasModule: (key: string) => key === "checklist_tecnico" });

      renderSidebar();

      expect(screen.getByText("Operação do Evento")).toBeInTheDocument();
    });

    it("hides 'Operação do Evento' entirely for a non-master user when neither module is active", () => {
      mockUseAuth.mockReturnValue(baseAuth());
      mockUseCompanyModules.mockReturnValue({ hasModule: () => false });

      renderSidebar();

      expect(screen.queryByText("Operação do Evento")).not.toBeInTheDocument();
    });

    it("shows 'Operação do Evento' for master_admin even with no company module active", () => {
      mockUseAuth.mockReturnValue(baseAuth({ isMasterAdmin: true, isAdminEmpresa: false, role: "master_admin" }));
      mockUseCompanyModules.mockReturnValue({ hasModule: () => false });

      renderSidebar();

      expect(screen.getByText("Operação do Evento")).toBeInTheDocument();
    });
  });
});
