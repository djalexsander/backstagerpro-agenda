import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannerRemotoSessao } from "@/lib/scanner-remoto-types";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";
import type {
  TraceabilityOpenCustody,
  TraceabilitySearchResult,
  TraceabilitySituacao,
} from "@/lib/material-traceability-types";

function makeSession(
  overrides: Partial<ScannerRemotoSessao> & { id: string },
): ScannerRemotoSessao {
  return {
    empresa_id: "company-1",
    tipo_operacao: "misto",
    responsavel_tipo: null,
    responsavel_id: null,
    finalidade: null,
    condicao: "bom",
    localizacao_origem_id: null,
    localizacao_destino_id: null,
    referencia_tipo: null,
    referencia_id: null,
    titulo: null,
    observacao: null,
    status: "aberta",
    criado_por: "user-1",
    aberta_em: "2026-09-01T10:00:00Z",
    encerrada_em: null,
    encerrada_por: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

const openSession = makeSession({ id: "session-1", titulo: "Load-out sexta" });

// Mock com estado: startSession empurra a sessão criada em `mockSessions` para
// que `sessions.find(activeSessionId)` da página resolva após um create OK -
// mesmo efeito da invalidação de query no fluxo real.
let mockSessions: ScannerRemotoSessao[] = [];
const startSession = vi.fn();
const registerRead = vi.fn();
const endSession = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    role: "admin_empresa",
    empresaId: "company-1",
    empresaReadOnly: false,
    isMasterAdmin: false,
  }),
}));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({ hasModule: () => true, isLoading: false }),
}));
vi.mock("@/hooks/useModulePermission", () => ({
  useModulePermission: () => ({
    permission: { canView: true, canCreate: true, canEdit: true, canDelete: true },
  }),
}));
vi.mock("@/hooks/useScannerRemoto", () => ({
  useScannerRemoto: () => ({
    sessions: mockSessions,
    reads: [],
    realtimeStatus: "connected",
    startSession,
    registerRead,
    endSession,
  }),
}));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/components/materials/MaterialQrScanner", () => ({ MaterialQrScanner: () => null }));
vi.mock("@/lib/stock-service", () => ({ listStockLocations: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/checkin-checkout-service", () => ({
  listCustodyOperations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  listCustodyResponsibles: vi.fn().mockResolvedValue([]),
  searchCustodyMaterials: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/material-traceability-service", () => ({
  searchMaterialTraceability: vi.fn(),
  getMaterialTraceability: vi.fn(),
}));
vi.mock("@/lib/material-rental-service", () => ({
  listMaterialRentals: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getMaterialRental: vi.fn(),
}));
let mockEvents: { id: string; name: string; date: string }[] = [];
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: mockEvents, error: null }),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    },
  };
});

import ScannerRemoto from "./ScannerRemoto";
import {
  listCustodyOperations,
  listCustodyResponsibles,
  searchCustodyMaterials,
} from "@/lib/checkin-checkout-service";
import { listStockLocations } from "@/lib/stock-service";
import { searchMaterialTraceability } from "@/lib/material-traceability-service";
import { getMaterialRental, listMaterialRentals } from "@/lib/material-rental-service";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScannerRemoto />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Radix Select's keyboard-open path calls scrollIntoView on the active item -
  // jsdom 20 does not implement it.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  mockSessions = [];
  mockEvents = [];
  toastMock.mockReset();
  startSession.mockReset().mockResolvedValue(undefined);
  registerRead
    .mockReset()
    .mockResolvedValue({ acao_executada: "nao_encontrado", resultado: { mensagem: "sem material" } });
  endSession.mockReset().mockResolvedValue({});
  vi.mocked(searchCustodyMaterials).mockReset().mockResolvedValue([]);
  vi.mocked(listCustodyOperations).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listCustodyResponsibles).mockReset().mockResolvedValue([]);
  vi.mocked(listStockLocations).mockReset().mockResolvedValue([]);
  vi.mocked(searchMaterialTraceability).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(listMaterialRentals).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getMaterialRental).mockReset();
});

// --- fixtures E4 --------------------------------------------------------------

function traceMaterial(
  overrides: Partial<TraceabilitySearchResult> = {},
): TraceabilitySearchResult {
  return {
    id: "mat-207",
    nome: "NEO 210 #07",
    codigo_interno: "NEO-210-07",
    numero_patrimonio: "PAT-207",
    numero_serie: null,
    codigo_barras: null,
    identificador_unico: "15b13cd1-6921-49a4-b67d-54c1b0e39acc",
    status_operacional: "disponivel",
    ativo: true,
    foto_path: null,
    resumo: {
      situacao: "disponivel",
      localizacoes: [
        { localizacao_id: "l1", localizacao_codigo: "BAR", localizacao_nome: "Barracão" },
      ],
      ultimo_retorno_em: null,
      ultimo_retorno_recebido_por: null,
      custodias_abertas: [],
      quantidade_total: 1,
      quantidade_disponivel: 1,
      quantidade_fora: 0,
    },
    ...overrides,
  };
}

function openCustody(overrides: Partial<TraceabilityOpenCustody> = {}): TraceabilityOpenCustody {
  return {
    custodia_id: "c1",
    status: "aberta",
    finalidade: "uso_interno",
    referencia_tipo: null,
    referencia_id: null,
    quantidade_retirada: 3,
    quantidade_devolvida: 0,
    quantidade_pendente: 3,
    retirado_por: "João",
    liberado_por: "Alex",
    retirada_em: "2026-09-01T09:00:00Z",
    previsao_retorno: null,
    localizacao_origem_id: "l1",
    localizacao_origem_nome: "Barracão",
    condicao_saida: "bom",
    evento: null,
    locacao: null,
    ...overrides,
  };
}

function withCustodies(custodias: TraceabilityOpenCustody[]): TraceabilitySituacao {
  return {
    situacao: "emprestado",
    custodia_id: custodias[0]?.custodia_id ?? "c0",
    custodia_status: "aberta",
    finalidade: custodias[0]?.finalidade ?? "uso_interno",
    retirada_em: "2026-09-01T09:00:00Z",
    previsao_retorno: null,
    atrasado: false,
    retirado_por: "João",
    liberado_por: "Alex",
    locacao: null,
    evento: null,
    custodias_abertas: custodias,
    quantidade_total: 12,
    quantidade_disponivel: 4,
    quantidade_fora: custodias.reduce((sum, custody) => sum + custody.quantidade_pendente, 0),
  };
}

function custodyOpView(overrides: Partial<CustodyOperationView>): CustodyOperationView {
  return {
    id: "op1",
    empresa_id: "company-1",
    material_id: "mat-207",
    material_nome: "NEO 210",
    material_codigo: "NEO-210",
    material_identificador: null,
    foto_path: null,
    tipo_controle: "quantidade",
    quantidade_retirada: 4,
    quantidade_devolvida: 0,
    quantidade_baixada: 0,
    quantidade_pendente: 4,
    localizacao_origem_id: "l1",
    localizacao_origem_nome: "Barracão",
    retirada_em: "2026-09-01T09:00:00Z",
    previsao_retorno: null,
    executado_por: "user-1",
    executor_nome: "Alex",
    responsavel_tipo: "usuario",
    responsavel_usuario_id: "user-1",
    responsavel_funcionario_id: null,
    responsavel_nome: "Alex",
    finalidade: "uso_interno",
    referencia_tipo: null,
    referencia_id: null,
    observacao_saida: null,
    condicao_saida: "bom",
    status: "aberta",
    movimento_saida_id: "mov1",
    encerrada_em: null,
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
    ...overrides,
  };
}

async function startAutomaticSession() {
  startSession.mockImplementation(async () => {
    const created = makeSession({ id: "auto-1" });
    mockSessions = [created];
    return created;
  });
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Nova sessão automática" }));
  return screen.findByPlaceholderText(/Digite ou cole o código/i);
}

async function scan(code: string) {
  const input = screen.getByPlaceholderText(/Digite ou cole o código/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Ler" }));
}

describe("ScannerRemoto - Nova sessão automática (E3)", () => {
  it("mostra 'Nova sessão automática' como caminho principal e mantém o formulário configurado", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Nova sessão automática" })).toBeInTheDocument();
    // o formulário configurado antigo continua disponível, separado
    expect(screen.getByText("Nova sessão configurada")).toBeInTheDocument();
    expect(screen.getByText("Tipo de operação")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sessão" })).toBeInTheDocument();
  });

  it("clicar chama startSession uma única vez com um payload misto neutro", async () => {
    startSession.mockImplementation(async (input) => {
      const created = makeSession({ id: "auto-1", tipo_operacao: input.tipoOperacao });
      mockSessions = [created];
      return created;
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Nova sessão automática" }));

    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    const payload = startSession.mock.calls[0][0];

    // payload exato: só tipoOperacao/condicao/clientUuid
    expect(Object.keys(payload).sort()).toEqual(["clientUuid", "condicao", "tipoOperacao"]);
    expect(payload.tipoOperacao).toBe("misto");
    expect(payload.condicao).toBe("bom");
    expect(payload.clientUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // nenhum contexto operacional - nem chave, nem string vazia, nem null
    for (const key of [
      "originLocationId",
      "destinationLocationId",
      "responsibleType",
      "responsibleId",
      "purpose",
      "referenceType",
      "referenceId",
      "titulo",
      "observacao",
      "eventId",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(Object.values(payload)).not.toContain("");
    expect(Object.values(payload)).not.toContain(null);
  });

  it("sucesso torna a sessão retornada ativa e pronta para leitura, com botão Finalizar", async () => {
    startSession.mockImplementation(async () => {
      const created = makeSession({ id: "auto-42", titulo: null });
      mockSessions = [created];
      return created;
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Nova sessão automática" }));

    // entrou na sessão ativa: campo de leitura + câmera + Finalizar
    expect(await screen.findByPlaceholderText(/Digite ou cole o código/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir câmera/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
    // sem toast de erro; a criação de sessão saiu de vista
    expect(toastMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Nova sessão automática" })).not.toBeInTheDocument();
  });

  it("durante a criação o botão fica desabilitado e não dispara startSession de novo", async () => {
    let resolveStart: (v: ScannerRemotoSessao) => void = () => {};
    startSession.mockImplementation(
      () =>
        new Promise<ScannerRemotoSessao>((resolve) => {
          resolveStart = resolve;
        }),
    );
    renderPage();

    const button = screen.getByRole("button", { name: "Nova sessão automática" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(startSession).toHaveBeenCalledTimes(1);

    const created = makeSession({ id: "auto-1" });
    mockSessions = [created];
    resolveStart(created);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Digite ou cole o código/i)).toBeInTheDocument(),
    );
  });

  it("erro não cria sessão ativa falsa, mostra toast e permite tentar de novo", async () => {
    startSession.mockRejectedValueOnce(new Error("Falha de rede"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Nova sessão automática" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive", description: "Falha de rede" }),
      ),
    );
    // não entrou em sessão ativa
    expect(screen.queryByPlaceholderText(/Digite ou cole o código/i)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Nova sessão automática" });
    expect(button).not.toBeDisabled();

    // retry funciona
    startSession.mockImplementationOnce(async () => {
      const created = makeSession({ id: "auto-2" });
      mockSessions = [created];
      return created;
    });
    fireEvent.click(button);
    expect(await screen.findByPlaceholderText(/Digite ou cole o código/i)).toBeInTheDocument();
  });

});

describe("ScannerRemoto - E4: leitura read-only na sessão automática", () => {
  it("leitura encontrada não movimenta nada: sem registerRead, sem o pré-check do fluxo antigo", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({ items: [traceMaterial()], total: 1 });
    await startAutomaticSession();
    await scan("NEO-210-07");

    expect(await screen.findByText("Material identificado")).toBeInTheDocument();
    // read-only: só searchMaterialTraceability foi chamado
    expect(vi.mocked(searchMaterialTraceability)).toHaveBeenCalledWith("company-1", "NEO-210-07");
    expect(registerRead).not.toHaveBeenCalled();
    expect(vi.mocked(searchCustodyMaterials)).not.toHaveBeenCalled();
  });

  it("mostra o material identificado e a situação atual do resumo", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({ items: [traceMaterial()], total: 1 });
    await startAutomaticSession();
    await scan("NEO-210-07");

    expect(await screen.findByText("NEO 210 #07")).toBeInTheDocument();
    expect(screen.getByText("PAT-207")).toBeInTheDocument();
    expect(screen.getByText("Disponível")).toBeInTheDocument();
    expect(screen.getByText("Localização")).toBeInTheDocument();
    expect(screen.getByText("Barracão")).toBeInTheDocument();
  });

  it("custódia vinculada a evento mostra 'Em evento' + nome + data", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          nome: "NEO 210 #18",
          numero_patrimonio: "PAT-218",
          resumo: withCustodies([
            openCustody({
              finalidade: "evento",
              referencia_tipo: "evento",
              referencia_id: "evt-1",
              evento: { evento_id: "evt-1", evento_nome: "Show Y", evento_data: "2026-08-20" },
            }),
          ]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("PAT-218");

    expect(await screen.findByText("Em evento")).toBeInTheDocument();
    expect(screen.getByText("Show Y")).toBeInTheDocument();
    expect(screen.getByText("20/08/2026")).toBeInTheDocument();
  });

  it("custódia vinculada a locacao_item mostra 'Locado' + número da locação + cliente", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          nome: "NEO 210 #12",
          numero_patrimonio: "PAT-212",
          resumo: withCustodies([
            openCustody({
              finalidade: "locacao",
              referencia_tipo: "locacao_item",
              referencia_id: "item-1",
              locacao: {
                locacao_id: "loc-1",
                locacao_numero: "LOC-2026-000123",
                cliente_id: "cli-1",
                cliente_nome: "Empresa X",
              },
            }),
          ]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("PAT-212");

    expect(await screen.findByText("Locado")).toBeInTheDocument();
    expect(screen.getByText("LOC-2026-000123")).toBeInTheDocument();
    expect(screen.getByText("Empresa X")).toBeInTheDocument();
  });

  it("mostra os botões Check-out e Check-in; escolher uma operação abre o formulário sem movimentar", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({ items: [traceMaterial()], total: 1 });
    await startAutomaticSession();
    await scan("NEO-210-07");
    await screen.findByText("Material identificado");

    expect(screen.getByRole("button", { name: "Check-out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check-in" })).toBeInTheDocument();

    // E4.5: escolher Check-out abre o formulário de contexto (ainda sem gravar)
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    expect(await screen.findByText("Localização de origem")).toBeInTheDocument();
    expect(screen.getByText("Finalidade")).toBeInTheDocument();

    // Cancelar a operação volta aos dois botões, sem nunca movimentar
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("button", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.queryByText("Localização de origem")).not.toBeInTheDocument();
    expect(registerRead).not.toHaveBeenCalled();
  });

  it("leitura não encontrada mostra erro e não grava nada", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({ items: [], total: 0 });
    await startAutomaticSession();
    await scan("CODIGO-INEXISTENTE");

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Material não encontrado", variant: "destructive" }),
      ),
    );
    expect(screen.queryByText("Material identificado")).not.toBeInTheDocument();
    expect(registerRead).not.toHaveBeenCalled();
  });

  it("uma nova leitura substitui a leitura pendente anterior (nunca mistura material A com B)", async () => {
    vi.mocked(searchMaterialTraceability)
      .mockResolvedValueOnce({
        items: [traceMaterial({ id: "a", nome: "Material A", codigo_interno: "A-1", numero_patrimonio: "PAT-A" })],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [traceMaterial({ id: "b", nome: "Material B", codigo_interno: "B-2", numero_patrimonio: "PAT-B" })],
        total: 1,
      });
    await startAutomaticSession();

    await scan("A-1");
    expect(await screen.findByText("Material A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    expect(await screen.findByText("Localização de origem")).toBeInTheDocument();

    await scan("B-2");
    expect(await screen.findByText("Material B")).toBeInTheDocument();
    expect(screen.queryByText("Material A")).not.toBeInTheDocument();
    // a operação escolhida para A não vaza para B: o formulário sumiu, voltou aos botões
    expect(screen.queryByText("Localização de origem")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check-out" })).toBeInTheDocument();
    expect(registerRead).not.toHaveBeenCalled();
  });

  it("finalizar a sessão descarta a leitura pendente, sem movimentar", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({ items: [traceMaterial()], total: 1 });
    await startAutomaticSession();
    await scan("NEO-210-07");
    await screen.findByText("Material identificado");
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() => expect(endSession).toHaveBeenCalledWith("auto-1"));
    await waitFor(() => expect(screen.queryByText("Material identificado")).not.toBeInTheDocument());
    expect(registerRead).not.toHaveBeenCalled();
  });

  it("material individual (uma custódia) é tratado direto, sem abrir o seletor", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          nome: "NEO 210 #09",
          numero_patrimonio: "PAT-209",
          resumo: withCustodies([openCustody({ finalidade: "cliente" })]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("PAT-209");

    expect(await screen.findByText("NEO 210 #09")).toBeInTheDocument();
    expect(screen.getByText("Emprestado")).toBeInTheDocument();
    expect(vi.mocked(listCustodyOperations)).not.toHaveBeenCalled();
    expect(screen.queryByText("De onde está voltando?")).not.toBeInTheDocument();
  });

  it("material por quantidade com 2+ custódias reutiliza o CheckinOriginDialog existente", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          nome: "NEO 210",
          codigo_interno: "NEO-210",
          numero_patrimonio: null,
          resumo: withCustodies([
            openCustody({ custodia_id: "c1", finalidade: "evento", quantidade_pendente: 4, localizacao_origem_nome: "Barracão" }),
            openCustody({ custodia_id: "c2", finalidade: "locacao", quantidade_pendente: 8, localizacao_origem_nome: "Depósito" }),
          ]),
        }),
      ],
      total: 1,
    });
    vi.mocked(listCustodyOperations).mockResolvedValue({
      items: [
        custodyOpView({ id: "c1", finalidade: "evento", quantidade_pendente: 4, localizacao_origem_nome: "Barracão" }),
        custodyOpView({ id: "c2", finalidade: "locacao", quantidade_pendente: 8, localizacao_origem_nome: "Depósito" }),
      ],
      total: 2,
    });
    await startAutomaticSession();
    await scan("NEO-210");

    // o diálogo do fluxo de check-in é reutilizado - nada de identidade por unidade
    expect(await screen.findByText("De onde está voltando?")).toBeInTheDocument();
    expect(vi.mocked(listCustodyOperations)).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Locação futura · Depósito"));

    expect(await screen.findByText("Material identificado")).toBeInTheDocument();
    expect(screen.getByText("Locado")).toBeInTheDocument();
    expect(registerRead).not.toHaveBeenCalled();
  });

  it("a sessão configurada antiga continua no fluxo antigo (searchCustodyMaterials + registerRead)", async () => {
    mockSessions = [
      makeSession({
        id: "cfg-1",
        titulo: "Sessão configurada",
        localizacao_origem_id: "loc1",
        localizacao_destino_id: "loc2",
        responsavel_tipo: "usuario",
        responsavel_id: "u1",
        finalidade: "uso_interno",
      }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    await screen.findByPlaceholderText(/Digite ou cole o código/i);
    await scan("MAT-1");

    await waitFor(() =>
      expect(vi.mocked(searchCustodyMaterials)).toHaveBeenCalledWith("company-1", "MAT-1"),
    );
    await waitFor(() =>
      expect(registerRead).toHaveBeenCalledWith(
        expect.objectContaining({ sessaoId: "cfg-1", codigoLido: "MAT-1" }),
      ),
    );
    // não usa o painel read-only da E4
    expect(vi.mocked(searchMaterialTraceability)).not.toHaveBeenCalled();
    expect(screen.queryByText("Material identificado")).not.toBeInTheDocument();
  });
});

describe("ScannerRemoto - E4.5: montar contexto da operação sem movimentar", () => {
  function openCardSelect(labelText: string) {
    const field = screen.getByText(labelText, { selector: "label" }).closest("div") as HTMLElement;
    const trigger = within(field).getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  }

  it("19. cancelar a operação volta ao card do material identificado, mantendo o material", async () => {
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          nome: "NEO 210 #09",
          numero_patrimonio: "PAT-209",
          resumo: withCustodies([openCustody({ finalidade: "uso_interno", localizacao_origem_nome: "Depósito" })]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("PAT-209");
    await screen.findByText("Material identificado");

    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    // origem derivada da custódia aparece no contexto
    expect(await screen.findByText("Localização de destino")).toBeInTheDocument();
    expect(screen.getAllByText("Depósito").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    // volta ao card, material preservado, nenhum registro
    expect(await screen.findByRole("button", { name: "Check-out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.getByText("NEO 210 #09")).toBeInTheDocument();
    expect(screen.queryByText("Localização de destino")).not.toBeInTheDocument();
    await waitFor(() => expect(registerRead).not.toHaveBeenCalled());
  });

  it("24. fluxo automático completo (Check-in) chega a 'pronta para confirmação' sem nenhuma escrita", async () => {
    vi.mocked(listStockLocations).mockResolvedValue([
      {
        id: "l-dest",
        empresa_id: "company-1",
        codigo: "DEP",
        nome: "Depósito",
        tipo: "deposito",
        localizacao_pai_id: null,
        descricao: null,
        ativa: true,
        created_at: "2026-08-01T00:00:00.000Z",
        created_by: null,
        updated_at: "2026-08-01T00:00:00.000Z",
        updated_by: null,
      },
    ]);
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          resumo: withCustodies([
            openCustody({ finalidade: "uso_interno", localizacao_origem_id: "l-bar", localizacao_origem_nome: "Barracão" }),
          ]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("NEO-210-07");
    await screen.findByText("Material identificado");

    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    await screen.findByText("Localização de destino");

    openCardSelect("Localização de destino");
    fireEvent.click(await screen.findByRole("option", { name: "DEP · Depósito" }));
    // botão "Confirmar Check-in" do formulário só monta o contexto (E4.5)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(await screen.findByText("Check-in pronto")).toBeInTheDocument();
    // ainda nada gravado: montar o contexto não chama registrar_leitura
    expect(registerRead).not.toHaveBeenCalled();
    expect(endSession).not.toHaveBeenCalled();
    expect(vi.mocked(searchCustodyMaterials)).not.toHaveBeenCalled();

    // a leitura/operação pendente nunca impede finalizar a sessão
    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));
    await waitFor(() => expect(endSession).toHaveBeenCalledWith("auto-1"));
    expect(registerRead).not.toHaveBeenCalled();
  });
});

describe("ScannerRemoto - E5: confirmação final executa a movimentação", () => {
  const location = (id: string, codigo: string, nome: string) => ({
    id,
    empresa_id: "company-1",
    codigo,
    nome,
    tipo: "deposito" as const,
    localizacao_pai_id: null,
    descricao: null,
    ativa: true,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
    updated_at: "2026-08-01T00:00:00.000Z",
    updated_by: null,
  });

  function openCardSelect(labelText: string) {
    const field = screen.getByText(labelText, { selector: "label" }).closest("div") as HTMLElement;
    const trigger = within(field).getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  }

  async function pickOption(labelText: string, optionName: string | RegExp) {
    openCardSelect(labelText);
    fireEvent.click(await screen.findByRole("option", { name: optionName }));
  }

  async function reachCheckinReady() {
    vi.mocked(listStockLocations).mockResolvedValue([location("l-dest", "DEP", "Depósito")]);
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [
        traceMaterial({
          resumo: withCustodies([
            openCustody({
              custodia_id: "cust-1",
              finalidade: "uso_interno",
              localizacao_origem_id: "l-bar",
              localizacao_origem_nome: "Barracão",
            }),
          ]),
        }),
      ],
      total: 1,
    });
    await startAutomaticSession();
    await scan("NEO-210-07");
    await screen.findByText("Material identificado");
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    await screen.findByText("Localização de destino");
    openCardSelect("Localização de destino");
    fireEvent.click(await screen.findByRole("option", { name: "DEP · Depósito" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));
    await screen.findByText("Check-in pronto");
  }

  it("check-in: a confirmação final chama registrar_leitura com o contexto e a custódia", async () => {
    registerRead.mockResolvedValue({
      id: "leitura-1",
      acao_executada: "checkin",
      resultado: { mensagem: "Check-in registrado." },
    });
    await reachCheckinReady();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    await waitFor(() => expect(registerRead).toHaveBeenCalledTimes(1));
    expect(registerRead).toHaveBeenCalledWith(
      expect.objectContaining({
        sessaoId: "auto-1",
        codigoLido: "NEO-210-07",
        custodiaId: "cust-1",
        contexto: {
          operation: "checkin",
          localizacao_destino_id: "l-dest",
          condicao: "bom",
        },
      }),
    );
    // sucesso limpa o pendingRead
    await waitFor(() =>
      expect(screen.queryByText("Material identificado")).not.toBeInTheDocument(),
    );
  });

  it("check-out: a confirmação final manda o contexto de check-out (origem/responsável/finalidade)", async () => {
    vi.mocked(listCustodyResponsibles).mockResolvedValue([
      { tipo: "usuario", id: "u1", nome: "Alex", detalhe: "" },
    ]);
    vi.mocked(searchCustodyMaterials).mockResolvedValue([
      {
        id: "mat-207",
        nome: "NEO 210 #07",
        codigo_interno: "NEO-210-07",
        identificador_unico: null,
        codigo_barras: null,
        conteudo_qr_code: null,
        numero_patrimonio: "PAT-207",
        numero_serie: null,
        tipo_controle: "individual",
        status_operacional: "disponivel",
        ativo: true,
        unidade_medida: "un",
        foto_path: null,
        saldos: [
          {
            localizacao_id: "l-bar",
            localizacao_codigo: "BAR",
            localizacao_nome: "Barracão",
            localizacao_ativa: true,
            quantidade: 3,
          },
        ],
        custodias_abertas: [],
      },
    ]);
    vi.mocked(searchMaterialTraceability).mockResolvedValue({
      items: [traceMaterial()],
      total: 1,
    });
    registerRead.mockResolvedValue({
      id: "leitura-2",
      acao_executada: "checkout",
      resultado: { mensagem: "Check-out registrado." },
    });

    await startAutomaticSession();
    await scan("NEO-210-07");
    await screen.findByText("Material identificado");
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    await waitFor(() =>
      expect(screen.queryByText(/Verificando saldo/)).not.toBeInTheDocument(),
    );

    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Uso interno");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));
    await screen.findByText("Check-out pronto");

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));

    await waitFor(() => expect(registerRead).toHaveBeenCalledTimes(1));
    const call = registerRead.mock.calls[0][0];
    expect(call.custodiaId).toBeUndefined();
    expect(call.contexto).toEqual({
      operation: "checkout",
      localizacao_origem_id: "l-bar",
      responsavel_tipo: "usuario",
      responsavel_id: "u1",
      finalidade: "uso_interno",
      condicao: "bom",
    });
    await waitFor(() =>
      expect(screen.queryByText("Material identificado")).not.toBeInTheDocument(),
    );
  });

  it("erro na movimentação mantém a leitura pendente e mostra a mensagem (retry)", async () => {
    registerRead.mockResolvedValue({
      id: "leitura-3",
      acao_executada: "erro",
      resultado: { mensagem: "Você não tem permissão para esta operação." },
    });
    await reachCheckinReady();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(
      await screen.findByText("Você não tem permissão para esta operação."),
    ).toBeInTheDocument();
    // pendingRead preservado para retry
    expect(screen.getByText("Material identificado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Check-in" })).toBeEnabled();
  });

  it("sessão configurada antiga: registrar_leitura continua SEM contexto", async () => {
    mockSessions = [
      makeSession({
        id: "cfg-1",
        titulo: "Sessão configurada",
        localizacao_origem_id: "loc1",
        localizacao_destino_id: "loc2",
        responsavel_tipo: "usuario",
        responsavel_id: "u1",
        finalidade: "uso_interno",
      }),
    ];
    registerRead.mockResolvedValue({
      id: "leitura-4",
      acao_executada: "checkout",
      resultado: { mensagem: "Check-out registrado." },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    await screen.findByPlaceholderText(/Digite ou cole o código/i);
    await scan("MAT-1");

    await waitFor(() => expect(registerRead).toHaveBeenCalled());
    const call = registerRead.mock.calls[0][0];
    expect(call).not.toHaveProperty("contexto");
    expect(call).toMatchObject({ sessaoId: "cfg-1", codigoLido: "MAT-1" });
  });
});

describe("ScannerRemoto - Finalizar sessão continua intacto", () => {
  beforeEach(() => {
    mockSessions = [openSession];
  });

  it("lista uma sessão aberta com 'Usar' e 'Finalizar'", () => {
    renderPage();

    expect(screen.getByText("Load-out sexta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
  });

  it("'Finalizar' abre confirmação e confirmar chama o endSession existente com o id da sessão", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    expect(
      screen.getByText(
        /Deseja finalizar esta sessão\? As leituras e movimentações já realizadas serão preservadas\./i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finalizar sessão" }));

    await waitFor(() => expect(endSession).toHaveBeenCalledWith("session-1"));
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it("cancelar a confirmação não encerra a sessão", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Finalizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Usar" })).toBeInTheDocument();
    expect(endSession).not.toHaveBeenCalled();
  });
});

describe("ScannerRemoto - seletor de Finalidade (Nova sessão configurada)", () => {
  beforeEach(() => {
    mockSessions = [openSession];
  });

  function openFinalidadeSelect() {
    const field = screen.getByText("Finalidade").closest("div") as HTMLElement;
    const trigger = within(field).getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
    return trigger;
  }

  it("não oferece 'Locação futura' - o backend rejeita finalidade='locacao' (CI023)", async () => {
    renderPage();
    openFinalidadeSelect();

    await screen.findByRole("option", { name: "Uso interno" });
    expect(screen.queryByRole("option", { name: "Locação futura" })).not.toBeInTheDocument();
  });

  it("continua oferecendo todas as demais finalidades, incluindo Evento", async () => {
    renderPage();
    openFinalidadeSelect();

    for (const label of [
      "Uso interno",
      "Funcionário",
      "Evento",
      "Cliente",
      "Manutenção",
      "Transferência operacional",
      "Outro",
    ]) {
      expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("selecionar Evento continua revelando o seletor de Evento (comportamento inalterado)", async () => {
    renderPage();
    openFinalidadeSelect();

    fireEvent.click(await screen.findByRole("option", { name: "Evento" }));

    expect(await screen.findByText("Selecione o evento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
  });

  it("o formulário configurado continua exigindo o contexto (handler intacto)", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Iniciar sessão" }));

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Preencha origem, responsável e finalidade" }),
    );
    expect(startSession).not.toHaveBeenCalled();
  });
});
