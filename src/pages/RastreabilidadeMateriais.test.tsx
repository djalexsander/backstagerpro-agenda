import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, authState } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  authState: {
    role: "admin_empresa" as string | null,
    empresaId: "company-1" as string | null,
    isMasterAdmin: false,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => true, isLoading: false }),
}));
vi.mock("@/hooks/useModulePermission", () => ({
  useModulePermission: () => ({ permission: null, isLoading: false }),
}));
// Câmera é coberta por MaterialQrScanner.test.tsx - aqui um botão simples
// substitui o diálogo real para testar só o que a página faz com o código
// decodificado, mesmo padrão de CheckinCheckout.test.tsx.
vi.mock("@/components/materials/MaterialQrScanner", () => ({
  MaterialQrScanner: ({
    open,
    onDetected,
  }: {
    open: boolean;
    onDetected: (code: string) => void;
  }) => (open ? <button onClick={() => onDetected("TRK-DISP-001")}>Simular leitura da câmera</button> : null),
}));
vi.mock("@/components/materials/MaterialPhotoImage", () => ({
  MaterialPhotoImage: () => <div data-testid="material-photo" />,
}));

import RastreabilidadeMateriais from "./RastreabilidadeMateriais";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RastreabilidadeMateriais />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const disponivelResumo = {
  situacao: "disponivel",
  localizacoes: [{ localizacao_id: "l1", localizacao_codigo: "EST-A", localizacao_nome: "Estoque Principal" }],
  ultimo_retorno_em: null,
  ultimo_retorno_recebido_por: null,
};

function searchResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "mat-1",
    nome: "Microfone Sem Fio Shure",
    codigo_interno: "MIC-012",
    numero_patrimonio: null,
    numero_serie: null,
    codigo_barras: null,
    identificador_unico: "mat-1-uuid",
    status_operacional: "disponivel",
    ativo: true,
    foto_path: null,
    resumo: disponivelResumo,
    ...overrides,
  };
}

function detailFor(materialId: string) {
  return {
    material: {
      id: materialId,
      nome: "Microfone Sem Fio Shure",
      codigo_interno: "MIC-012",
      numero_patrimonio: null,
      numero_serie: null,
      codigo_barras: null,
      identificador_unico: "mat-1-uuid",
      conteudo_qr_code: null,
      categoria_nome: "Áudio",
      marca: null,
      modelo: null,
      unidade_medida: "unidade",
      tipo_controle: "individual",
      status_operacional: "disponivel",
      ativo: true,
      foto_path: null,
    },
    resumo: disponivelResumo,
    rfid_tags: null,
    timeline: [],
    permissoes: { estoque: true, custodia: true, locacao: true, manutencao: true, rfid: false },
  };
}

function mockRpc(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  rpcMock.mockImplementation((name: string, args: Record<string, unknown>) => {
    const handler = handlers[name];
    if (handler) return Promise.resolve({ data: handler(args), error: null });
    return Promise.resolve({ data: [], error: null });
  });
}

describe("RastreabilidadeMateriais", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    authState.role = "admin_empresa";
    authState.empresaId = "company-1";
    authState.isMasterAdmin = false;
  });
  afterEach(() => vi.clearAllMocks());

  it("typing debounces then searches via buscar_rastreabilidade_materiais scoped to the current company", async () => {
    mockRpc({ buscar_rastreabilidade_materiais: () => [] });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/nome, código, patrimônio/i), {
      target: { value: "microfone" },
    });

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "buscar_rastreabilidade_materiais",
        expect.objectContaining({ _termo: "microfone", _empresa_id: "company-1" }),
      ),
    );
  });

  it("a single match opens the full traceability detail automatically, with no extra click", async () => {
    mockRpc({
      buscar_rastreabilidade_materiais: () => [{ item: searchResult(), total_count: 1 }],
      obter_rastreabilidade_material: (args) => detailFor(args._material_id as string),
    });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/nome, código, patrimônio/i), {
      target: { value: "MIC-012" },
    });

    expect(await screen.findByText(/onde está agora/i)).toBeInTheDocument();
    expect(screen.getByText("DISPONÍVEL")).toBeInTheDocument();
    expect(screen.queryByText(/resultados/i)).not.toBeInTheDocument();
  });

  it("multiple matches show a result list; picking one opens its detail", async () => {
    mockRpc({
      buscar_rastreabilidade_materiais: () => [
        { item: searchResult({ id: "mat-1", nome: "Microfone Shure ULXD #001" }), total_count: 2 },
        { item: searchResult({ id: "mat-2", nome: "Microfone Shure ULXD #002" }), total_count: 2 },
      ],
      obter_rastreabilidade_material: (args) => detailFor(args._material_id as string),
    });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/nome, código, patrimônio/i), {
      target: { value: "microfone" },
    });

    expect(await screen.findByText("Microfone Shure ULXD #001")).toBeInTheDocument();
    expect(screen.getByText("Microfone Shure ULXD #002")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Microfone Shure ULXD #001"));

    expect(await screen.findByText(/onde está agora/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /voltar aos resultados/i })).toBeInTheDocument();
  });

  it("no matches shows an explicit not-found message", async () => {
    mockRpc({ buscar_rastreabilidade_materiais: () => [] });
    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/nome, código, patrimônio/i), {
      target: { value: "inexistente" },
    });

    expect(await screen.findByText(/nenhum material encontrado/i)).toBeInTheDocument();
  });

  it("a simulated camera read searches through the same RPC manual typing uses", async () => {
    mockRpc({
      buscar_rastreabilidade_materiais: () => [{ item: searchResult(), total_count: 1 }],
      obter_rastreabilidade_material: (args) => detailFor(args._material_id as string),
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /ler com a câmera/i }));
    fireEvent.click(await screen.findByRole("button", { name: /simular leitura da câmera/i }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "buscar_rastreabilidade_materiais",
        expect.objectContaining({ _termo: "TRK-DISP-001" }),
      ),
    );
  });

  it("a usuario without a granular view grant sees a permission message instead of the search bar", async () => {
    authState.role = "usuario";
    mockRpc({});
    renderPage();

    expect(await screen.findByText(/não tem permissão para consultar esta tela/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/nome, código, patrimônio/i)).not.toBeInTheDocument();
  });
});
