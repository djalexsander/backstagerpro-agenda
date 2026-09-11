import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  catalogRows: [] as any[],
  empresaModuleRows: [] as any[],
  moduleRequestRows: [] as any[],
  batchRequestRows: [] as any[],
  modulePaymentRows: [] as any[],
  moduleDependencyRows: [] as any[],
  empresaRow: null as any,
  refreshProfile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    empresaId: "company-1",
    refreshProfile: mocks.refreshProfile,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/hooks/useSystemSettings", () => ({
  usePlatformBranding: () => ({ platformName: "Backstage Pro", platformLogoUrl: null, isLoading: false }),
}));

// Mirrors PlanoAssinatura.tsx's read shape: module_catalog, empresa_modules,
// module_requests, module_batch_requests, module_payments and
// module_dependencies feed getSelfServiceAvailableModules /
// expandModuleSelectionWithDependencies; empresas feeds the plan summary.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      switch (table) {
        case "module_catalog":
          return {
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: mocks.catalogRows, error: null }),
              }),
            }),
          };
        case "empresa_modules":
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: mocks.empresaModuleRows, error: null }),
            }),
            insert: (rows: any[]) => Promise.resolve({ data: rows, error: null }),
          };
        case "module_requests":
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: mocks.moduleRequestRows, error: null }),
            }),
          };
        case "module_batch_requests":
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: mocks.batchRequestRows, error: null }),
            }),
          };
        case "module_payments":
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: mocks.modulePaymentRows, error: null }),
            }),
          };
        case "module_dependencies":
          return {
            select: () => Promise.resolve({ data: mocks.moduleDependencyRows, error: null }),
          };
        case "empresas":
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: mocks.empresaRow, error: null }),
              }),
            }),
          };
        case "notificacoes_master":
          return { insert: (row: any) => Promise.resolve({ data: row, error: null }) };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  },
}));

import OnboardingModulos from "./OnboardingModulos";

const materiais = {
  id: "mod-materiais",
  feature_key: "gestao_materiais",
  nome: "Gestão de Materiais",
  descricao: "Controle de materiais",
  ativo: true,
  categoria: "operacional",
  valor: 49.9,
  periodicidade: "mensal",
  is_capacity_module: false,
  capacidade_extra_usuarios: 0,
  capacidade_extra_eventos: 0,
};

const rfid = {
  id: "mod-rfid",
  feature_key: "rfid_materiais",
  nome: "RFID",
  descricao: "Leitura RFID",
  ativo: true,
  categoria: "premium",
  valor: 99.9,
  periodicidade: "mensal",
  is_capacity_module: false,
  capacidade_extra_usuarios: 0,
  capacidade_extra_eventos: 0,
};

const legado = {
  id: "mod-legado",
  feature_key: "modulo_legado",
  nome: "Módulo Legado Fora de Venda",
  descricao: null,
  ativo: false,
  categoria: "operacional",
  valor: 19.9,
  periodicidade: "mensal",
  is_capacity_module: false,
  capacidade_extra_usuarios: 0,
  capacidade_extra_eventos: 0,
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <OnboardingModulos />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OnboardingModulos", () => {
  beforeEach(() => {
    mocks.catalogRows = [materiais, rfid, legado];
    mocks.empresaModuleRows = [];
    mocks.moduleRequestRows = [];
    mocks.batchRequestRows = [];
    mocks.modulePaymentRows = [];
    mocks.moduleDependencyRows = [];
    mocks.empresaRow = {
      plano_id: "plano-1",
      plano: "essencial",
      planos: { nome: "Essencial", valor: 99, periodicidade: "mensal" },
    };
    mocks.refreshProfile.mockReset();
    mocks.toast.mockReset();
  });

  it("empresa nova com placeholders inactive vê os módulos como vendáveis", async () => {
    mocks.empresaModuleRows = [
      { empresa_id: "company-1", module_id: "mod-materiais", status: "inactive" },
      { empresa_id: "company-1", module_id: "mod-rfid", status: "inactive" },
    ];
    renderPage();

    expect(await screen.findByText("Gestão de Materiais")).toBeInTheDocument();
    expect(screen.getByText("RFID")).toBeInTheDocument();
  });

  it("não oferece módulo com entitlement active para nova compra", async () => {
    mocks.empresaModuleRows = [
      { empresa_id: "company-1", module_id: "mod-materiais", status: "active" },
    ];
    renderPage();

    expect(await screen.findByText("RFID")).toBeInTheDocument();
    expect(screen.queryByText("Gestão de Materiais")).not.toBeInTheDocument();
  });

  it("não oferece módulo com solicitação pending", async () => {
    mocks.empresaModuleRows = [
      { empresa_id: "company-1", module_id: "mod-materiais", status: "pending" },
    ];
    renderPage();

    expect(await screen.findByText("RFID")).toBeInTheDocument();
    expect(screen.queryByText("Gestão de Materiais")).not.toBeInTheDocument();
  });

  it("volta a oferecer módulo com status cancelled", async () => {
    mocks.empresaModuleRows = [
      { empresa_id: "company-1", module_id: "mod-materiais", status: "cancelled" },
    ];
    renderPage();

    expect(await screen.findByText("Gestão de Materiais")).toBeInTheDocument();
  });

  it("nunca exibe módulo fora de venda (ativo=false), independente do status", async () => {
    renderPage();

    await screen.findByText("Gestão de Materiais");
    expect(screen.queryByText("Módulo Legado Fora de Venda")).not.toBeInTheDocument();
  });

  it("seleciona automaticamente a dependência obrigatória ao marcar o módulo dependente", async () => {
    mocks.moduleDependencyRows = [{ module_id: "mod-rfid", required_module_id: "mod-materiais" }];
    renderPage();

    fireEvent.click(await screen.findByText("RFID"));

    expect(
      await screen.findByRole("button", { name: /Solicitar 2 módulos e Continuar/i }),
    ).toBeInTheDocument();
  });
});
