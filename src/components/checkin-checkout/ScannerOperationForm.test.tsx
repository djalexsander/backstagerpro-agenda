import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustodyMaterialSearchResult, CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { RentalDetail, RentalListItem, RentalItemView } from "@/lib/material-rental-types";
import type { StockLocation } from "@/lib/stock-types";
import type {
  TraceabilityOpenCustody,
  TraceabilitySearchResult,
  TraceabilitySituacao,
} from "@/lib/material-traceability-types";
import type { ScannerOperationContext, ScannerPendingRead } from "@/lib/scanner-remoto-domain";

vi.mock("@/lib/checkin-checkout-service", () => ({
  searchCustodyMaterials: vi.fn().mockResolvedValue([]),
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
  return { supabase: { from: () => chain, rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } };
});

import { ScannerOperationForm } from "./ScannerOperationForm";
import { searchCustodyMaterials } from "@/lib/checkin-checkout-service";
import { getMaterialRental, listMaterialRentals } from "@/lib/material-rental-service";
import { supabase } from "@/integrations/supabase/client";

// --- fixtures ---------------------------------------------------------------

function loc(id: string, codigo: string, nome: string, ativa = true): StockLocation {
  return {
    id,
    empresa_id: "company-1",
    codigo,
    nome,
    tipo: "deposito",
    localizacao_pai_id: null,
    descricao: null,
    ativa,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
    updated_at: "2026-08-01T00:00:00.000Z",
    updated_by: null,
  };
}

const LOCATIONS: StockLocation[] = [
  loc("l-bar", "BAR", "Barracão"),
  loc("l-dep", "DEP", "Depósito"),
  loc("l-old", "OLD", "Galpão antigo", false),
];

const RESPONSIBLES: CustodyResponsibleOption[] = [
  { tipo: "usuario", id: "u1", nome: "Alex", detalhe: "admin" },
];

function disponivelResumo(): TraceabilitySituacao {
  return {
    situacao: "disponivel",
    localizacoes: [{ localizacao_id: "l-bar", localizacao_codigo: "BAR", localizacao_nome: "Barracão" }],
    ultimo_retorno_em: null,
    ultimo_retorno_recebido_por: null,
    custodias_abertas: [],
    quantidade_total: 1,
    quantidade_disponivel: 1,
    quantidade_fora: 0,
  };
}

function traceMaterial(overrides: Partial<TraceabilitySearchResult> = {}): TraceabilitySearchResult {
  return {
    id: "mat-1",
    nome: "NEO 210 #07",
    codigo_interno: "NEO-210-07",
    numero_patrimonio: "PAT-207",
    numero_serie: null,
    codigo_barras: null,
    identificador_unico: "15b13cd1-6921-49a4-b67d-54c1b0e39acc",
    status_operacional: "disponivel",
    ativo: true,
    foto_path: null,
    resumo: disponivelResumo(),
    ...overrides,
  };
}

function openCustody(overrides: Partial<TraceabilityOpenCustody> = {}): TraceabilityOpenCustody {
  return {
    custodia_id: "cust-1",
    status: "aberta",
    finalidade: "uso_interno",
    referencia_tipo: null,
    referencia_id: null,
    quantidade_retirada: 1,
    quantidade_devolvida: 0,
    quantidade_pendente: 1,
    retirado_por: "João",
    liberado_por: "Alex",
    retirada_em: "2026-09-01T09:00:00Z",
    previsao_retorno: null,
    localizacao_origem_id: "l-bar",
    localizacao_origem_nome: "Barracão",
    condicao_saida: "bom",
    evento: null,
    locacao: null,
    ...overrides,
  };
}

function pendingRead(overrides: Partial<ScannerPendingRead> = {}): ScannerPendingRead {
  return {
    code: "NEO-210-07",
    material: traceMaterial(),
    resumo: disponivelResumo(),
    selectedCustody: null,
    selectedOperation: null,
    operationContext: null,
    ...overrides,
  };
}

function custodySearchResult(
  saldos: CustodyMaterialSearchResult["saldos"],
  overrides: Partial<CustodyMaterialSearchResult> = {},
): CustodyMaterialSearchResult {
  return {
    id: "mat-1",
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
    saldos,
    custodias_abertas: [],
    ...overrides,
  };
}

function balance(
  overrides: Partial<CustodyMaterialSearchResult["saldos"][number]> = {},
): CustodyMaterialSearchResult["saldos"][number] {
  return {
    localizacao_id: "l-bar",
    localizacao_codigo: "BAR",
    localizacao_nome: "Barracão",
    localizacao_ativa: true,
    quantidade: 5,
    ...overrides,
  };
}

function rentalListItem(overrides: Partial<RentalListItem> = {}): RentalListItem {
  return {
    id: "rent-1",
    empresa_id: "company-1",
    cliente_id: "cli-1",
    numero: "LOC-2026-000123",
    status: "em_andamento",
    retirada_prevista_em: "2026-09-05T10:00:00Z",
    devolucao_prevista_em: "2026-09-10T10:00:00Z",
    responsavel_nome: "Alex",
    valor_total: 0,
    cliente_nome: "Empresa X",
    cliente_nome_fantasia: null,
    quantidade_itens: 1,
    quantidade_retirada: 0,
    quantidade_devolvida: 0,
    quantidade_com_cliente: 0,
    atrasada: false,
    ...overrides,
  };
}

function rentalItemView(
  overrides: Partial<RentalItemView> & { materialId?: string } = {},
): RentalItemView {
  const { materialId = "mat-1", ...rest } = overrides;
  return {
    id: "ri-1",
    material_id: materialId,
    quantidade_contratada: 1,
    modalidade_cobranca: "diaria",
    unidades_cobranca: 1,
    valor_unitario: 0,
    desconto: 0,
    subtotal: 0,
    observacoes: null,
    quantidade_retirada: 0,
    quantidade_devolvida: 0,
    quantidade_com_cliente: 0,
    quantidade_pendente_retirada: 1,
    material: {
      id: materialId,
      nome: "NEO 210 #07",
      codigo_interno: "NEO-210-07",
      tipo_controle: "individual",
      unidade_medida: "un",
      numero_serie: null,
      numero_patrimonio: "PAT-207",
      codigo_barras: null,
      identificador_unico: "15b13cd1-6921-49a4-b67d-54c1b0e39acc",
    },
    ...rest,
  };
}

function rentalDetail(overrides: Partial<RentalDetail> = {}): RentalDetail {
  return {
    ...rentalListItem(),
    observacoes: null,
    valor_bruto: 0,
    desconto: 0,
    cliente: {
      id: "cli-1",
      tipo_pessoa: "pessoa_juridica",
      nome: "Empresa X",
      nome_fantasia: null,
      cpf_cnpj: null,
      email: null,
      telefone: null,
    },
    evento: null,
    itens: [rentalItemView()],
    custodias: [],
    historico: [],
    ...overrides,
  };
}

// --- render helper ---------------------------------------------------------

function renderForm(props: Partial<Parameters<typeof ScannerOperationForm>[0]> = {}) {
  const onConfirm = vi.fn<(context: ScannerOperationContext) => void>();
  const onCancel = vi.fn();
  const onEditAgain = vi.fn();
  const onExecute = vi.fn<(context: ScannerOperationContext) => Promise<void>>().mockResolvedValue();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScannerOperationForm
        pendingRead={pendingRead()}
        companyId="company-1"
        locations={LOCATIONS}
        responsibles={RESPONSIBLES}
        rentalModuleEnabled
        canCheckout
        canCheckin
        onCancel={onCancel}
        onConfirm={onConfirm}
        onEditAgain={onEditAgain}
        onExecute={onExecute}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onConfirm, onCancel, onEditAgain, onExecute };
}

function openSelect(labelText: string) {
  // <Label> renderiza <label>; filtra o <span> do valor selecionado de outro
  // Select que por acaso mostre o mesmo texto (ex.: "Evento").
  const field = screen.getByText(labelText, { selector: "label" }).closest("div") as HTMLElement;
  const trigger = within(field).getByRole("combobox");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  return trigger;
}

async function pickOption(labelText: string, optionName: string | RegExp) {
  openSelect(labelText);
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

// O check-out consulta os saldos (read-only) ao montar; espera essa consulta
// assentar antes de qualquer interação.
async function settleCheckoutSaldos() {
  await waitFor(() =>
    expect(screen.queryByText(/Verificando saldo/)).not.toBeInTheDocument(),
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
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  mockEvents = [];
  vi.mocked(searchCustodyMaterials).mockReset().mockResolvedValue([]);
  vi.mocked(listMaterialRentals).mockReset().mockResolvedValue({ items: [], total: 0 });
  vi.mocked(getMaterialRental).mockReset();
  vi.mocked(supabase.rpc).mockClear();
});

// ==========================================================================
// CHECK-IN
// ==========================================================================

describe("ScannerOperationForm - CHECK-IN", () => {
  const checkinRead = (custody: Partial<TraceabilityOpenCustody> = {}) =>
    pendingRead({ selectedOperation: "checkin", selectedCustody: openCustody(custody) });

  it("1. mostra a origem derivada da custódia e não pede origem ao operador", () => {
    renderForm({ pendingRead: checkinRead({ localizacao_origem_nome: "Depósito" }) });

    // origem aparece como contexto (derivada), não como campo editável
    expect(screen.getByText("Origem")).toBeInTheDocument();
    expect(screen.getByText("Saiu de")).toBeInTheDocument();
    expect(screen.getByText("Depósito")).toBeInTheDocument();
    expect(screen.queryByText("Localização de origem")).not.toBeInTheDocument();
    // só destino + condição são escolhidos
    expect(screen.getByText("Localização de destino")).toBeInTheDocument();
    expect(screen.getByText("Condição de retorno")).toBeInTheDocument();
  });

  it("2. exige uma localização de destino antes de montar o contexto", async () => {
    const { onConfirm } = renderForm({ pendingRead: checkinRead() });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(await screen.findByText("Selecione a localização de destino.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("3. permite escolher a condição de retorno da lista existente do Check-in", async () => {
    renderForm({ pendingRead: checkinRead() });
    openSelect("Condição de retorno");

    for (const label of ["Bom", "Com avaria", "Danificado", "Manutenção necessária", "Incompleto"]) {
      expect(await screen.findByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("4. custódia de locacao_item preserva rentalId + rentalItemId para a futura devolução", async () => {
    const { onConfirm } = renderForm({
      pendingRead: checkinRead({
        custodia_id: "cust-loc",
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
    });

    await pickOption("Localização de destino", /Depósito/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(onConfirm).toHaveBeenCalledWith({
      operation: "checkin",
      custodyId: "cust-loc",
      originLocationId: "l-bar",
      destinationLocationId: "l-dep",
      returnCondition: "bom",
      rental: { rentalId: "loc-1", rentalItemId: "item-1" },
    });
  });

  it("5. confirmar apenas monta o contexto - nenhuma RPC é chamada", async () => {
    const { onConfirm } = renderForm({ pendingRead: checkinRead() });

    await pickOption("Localização de destino", /Depósito/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "checkin", destinationLocationId: "l-dep", rental: null }),
    );
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
    expect(vi.mocked(searchCustodyMaterials)).not.toHaveBeenCalled();
  });

  it("23. bloqueia quando o destino escolhido é a mesma localização de onde o material saiu", async () => {
    const { onConfirm } = renderForm({
      pendingRead: checkinRead({ localizacao_origem_id: "l-bar", localizacao_origem_nome: "Barracão" }),
    });

    await pickOption("Localização de destino", /Barracão/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(
      await screen.findByText("Origem e destino não podem ser a mesma localização."),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("bloqueia o check-in de um material sem custódia aberta", () => {
    const { onConfirm } = renderForm({
      pendingRead: pendingRead({ selectedOperation: "checkin", selectedCustody: null }),
    });

    expect(
      screen.getByText("Este material não possui check-out em aberto para devolver."),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// CHECK-OUT
// ==========================================================================

const soleSaldo = () => [
  custodySearchResult([
    balance({ localizacao_id: "l-dep", localizacao_codigo: "DEP", localizacao_nome: "Depósito", quantidade: 4 }),
  ]),
];

describe("ScannerOperationForm - CHECK-OUT", () => {
  const checkoutRead = () => pendingRead({ selectedOperation: "checkout" });

  it("6. lista somente localizações de origem com saldo disponível e ativas", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue([
      custodySearchResult([
        balance({ localizacao_id: "l-bar", localizacao_nome: "Barracão", quantidade: 5 }),
        balance({ localizacao_id: "l-dep", localizacao_nome: "Depósito", quantidade: 2 }),
        balance({ localizacao_id: "l-zero", localizacao_nome: "Sala zero", quantidade: 0 }),
        balance({ localizacao_id: "l-off", localizacao_nome: "Inativa", localizacao_ativa: false, quantidade: 9 }),
      ]),
    ]);
    renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    openSelect("Localização de origem");
    expect(await screen.findByRole("option", { name: /Barracão/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Depósito/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sala zero/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Inativa/ })).not.toBeInTheDocument();
  });

  it("7. uma única origem válida é pré-selecionada e mostrada, sem seletor", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
    renderForm({ pendingRead: checkoutRead() });

    expect(await screen.findByText("DEP · Depósito (4)")).toBeInTheDocument();
    const originField = screen.getByText("Localização de origem").closest("div") as HTMLElement;
    expect(within(originField).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("8. com múltiplas origens válidas, exige a escolha antes de montar o contexto", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue([
      custodySearchResult([
        balance({ localizacao_id: "l-bar", localizacao_nome: "Barracão", quantidade: 5 }),
        balance({ localizacao_id: "l-dep", localizacao_nome: "Depósito", quantidade: 2 }),
      ]),
    ]);
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    const originField = screen.getByText("Localização de origem").closest("div") as HTMLElement;
    expect(within(originField).getByRole("combobox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));
    expect(await screen.findByText("Selecione a localização de origem.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("9. responsável continua obrigatório (mesma regra do CheckoutDialog)", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));

    expect(await screen.findByText("Selecione o responsável.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("10. finalidade usa SELECTABLE_CUSTODY_PURPOSES", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
    renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    openSelect("Finalidade");
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

  it("11. 'Locação futura' não aparece na finalidade", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
    renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    openSelect("Finalidade");
    await screen.findByRole("option", { name: "Uso interno" });
    expect(screen.queryByRole("option", { name: "Locação futura" })).not.toBeInTheDocument();
  });

  it("monta o contexto de check-out com origem, responsável, finalidade e condição", async () => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Uso interno");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));

    expect(onConfirm).toHaveBeenCalledWith({
      operation: "checkout",
      originLocationId: "l-dep",
      responsibleType: "usuario",
      responsibleId: "u1",
      condition: "bom",
      purpose: "uso_interno",
      event: null,
      rental: null,
    });
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// EVENTO
// ==========================================================================

describe("ScannerOperationForm - EVENTO", () => {
  const checkoutRead = () => pendingRead({ selectedOperation: "checkout" });

  beforeEach(() => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
  });

  it("12. finalidade Evento exige a escolha de um evento", async () => {
    mockEvents = [{ id: "evt-1", name: "Show X", date: "2026-08-20" }];
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Evento");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));

    expect(await screen.findByText("Selecione o evento.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("13. o contexto guarda referenceType='evento' + events.id", async () => {
    mockEvents = [{ id: "evt-1", name: "Show X", date: "2026-08-20" }];
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });
    await settleCheckoutSaldos();

    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Evento");
    await pickOption("Evento", "Show X · 20/08/2026");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "checkout",
        purpose: "evento",
        event: { referenceType: "evento", referenceId: "evt-1" },
        rental: null,
      }),
    );
  });
});

// ==========================================================================
// CLIENTE -> LOCAÇÃO
// ==========================================================================

describe("ScannerOperationForm - CLIENTE -> LOCAÇÃO", () => {
  const checkoutRead = () => pendingRead({ selectedOperation: "checkout" });

  beforeEach(() => {
    vi.mocked(searchCustodyMaterials).mockResolvedValue(soleSaldo());
  });

  // Chega até o seletor de Locação com todos os campos anteriores preenchidos.
  async function reachRentalPicker() {
    await settleCheckoutSaldos();
    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Cliente");
  }

  it("14. finalidade Cliente revela o seletor obrigatório de Locação", async () => {
    vi.mocked(listMaterialRentals).mockResolvedValue({ items: [rentalListItem()], total: 1 });
    renderForm({ pendingRead: checkoutRead() });

    await reachRentalPicker();

    expect(await screen.findByText("Locação")).toBeInTheDocument();
    const rentalField = screen.getByText("Locação").closest("div") as HTMLElement;
    expect(within(rentalField).getByRole("combobox")).toBeInTheDocument();
  });

  it("15. lista apenas locações em status operável", async () => {
    vi.mocked(listMaterialRentals).mockResolvedValue({
      items: [
        rentalListItem({ id: "r-and", numero: "LOC-AND", status: "em_andamento" }),
        rentalListItem({ id: "r-res", numero: "LOC-RES", status: "reservada" }),
        rentalListItem({ id: "r-con", numero: "LOC-CON", status: "concluida" }),
        rentalListItem({ id: "r-can", numero: "LOC-CAN", status: "cancelada" }),
        rentalListItem({ id: "r-ras", numero: "LOC-RAS", status: "rascunho" }),
      ],
      total: 5,
    });
    renderForm({ pendingRead: checkoutRead() });

    await reachRentalPicker();
    openSelect("Locação");

    expect(await screen.findByRole("option", { name: /LOC-AND/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /LOC-RES/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /LOC-CON/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /LOC-CAN/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /LOC-RAS/ })).not.toBeInTheDocument();
  });

  it("16. material fora dos itens da locação bloqueia a confirmação", async () => {
    vi.mocked(listMaterialRentals).mockResolvedValue({ items: [rentalListItem()], total: 1 });
    vi.mocked(getMaterialRental).mockResolvedValue(
      rentalDetail({ itens: [rentalItemView({ id: "ri-outro", materialId: "mat-outro" })] }),
    );
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });

    await reachRentalPicker();
    await pickOption("Locação", /LOC-2026-000123/);

    expect(
      await screen.findByText("Este material não pertence à locação selecionada."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Check-out" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("17. material pertencente à locação resolve rentalId + material_locacao_itens.id", async () => {
    vi.mocked(listMaterialRentals).mockResolvedValue({ items: [rentalListItem()], total: 1 });
    vi.mocked(getMaterialRental).mockResolvedValue(
      rentalDetail({ itens: [rentalItemView({ id: "ri-1", material_id: "mat-1" })] }),
    );
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });

    await reachRentalPicker();
    await pickOption("Locação", /LOC-2026-000123/);
    await waitFor(() =>
      expect(vi.mocked(getMaterialRental)).toHaveBeenCalledWith("company-1", "rent-1"),
    );
    await act(() => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "checkout",
        purpose: "cliente",
        event: null,
        rental: { rentalId: "rent-1", rentalItemId: "ri-1" },
      }),
    );
  });

  it("18. nenhuma retirada de locação é executada ao montar o contexto", async () => {
    vi.mocked(listMaterialRentals).mockResolvedValue({ items: [rentalListItem()], total: 1 });
    vi.mocked(getMaterialRental).mockResolvedValue(
      rentalDetail({ itens: [rentalItemView({ id: "ri-1", material_id: "mat-1" })] }),
    );
    const { onConfirm } = renderForm({ pendingRead: checkoutRead() });

    await reachRentalPicker();
    await pickOption("Locação", /LOC-2026-000123/);
    await waitFor(() => expect(vi.mocked(getMaterialRental)).toHaveBeenCalled());
    await act(() => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // só leitura: listar/obter locação. Nada de registrar_retirada_locacao_material.
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
  });

  it("Cliente sem o módulo Locação ativo é bloqueado", async () => {
    const { onConfirm } = renderForm({ pendingRead: checkoutRead(), rentalModuleEnabled: false });

    await settleCheckoutSaldos();
    await pickOption("Responsável", "Alex");
    await pickOption("Finalidade", "Cliente");

    expect(
      await screen.findByText(
        "O módulo Locação de Materiais precisa estar ativo para vincular a um cliente.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-out" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(listMaterialRentals)).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Estado pronto / permissões
// ==========================================================================

describe("ScannerOperationForm - estado pronto e permissões", () => {
  const readyCheckin = () =>
    pendingRead({
      selectedOperation: "checkin",
      selectedCustody: openCustody(),
      operationContext: {
        operation: "checkin",
        custodyId: "cust-1",
        originLocationId: "l-bar",
        destinationLocationId: "l-dep",
        returnCondition: "bom",
        rental: null,
      },
    });

  it("mostra o estado pronto com o botão de confirmação final", () => {
    const { onExecute } = renderForm({ pendingRead: readyCheckin() });

    expect(screen.getByText("Check-in pronto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Check-in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refazer" })).toBeInTheDocument();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("E5: confirmar dispara onExecute com o contexto pronto", async () => {
    const { onExecute } = renderForm({ pendingRead: readyCheckin() });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    await waitFor(() =>
      expect(onExecute).toHaveBeenCalledWith({
        operation: "checkin",
        custodyId: "cust-1",
        originLocationId: "l-bar",
        destinationLocationId: "l-dep",
        returnCondition: "bom",
        rental: null,
      }),
    );
  });

  it("E5: um erro de onExecute aparece na tela e o botão volta a ficar disponível", async () => {
    const onExecute = vi
      .fn<(context: ScannerOperationContext) => Promise<void>>()
      .mockRejectedValue(new Error("Você não tem permissão para esta operação."));
    renderForm({ pendingRead: readyCheckin(), onExecute });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar Check-in" }));

    expect(
      await screen.findByText("Você não tem permissão para esta operação."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Check-in" })).toBeEnabled();
  });

  it("E5: Refazer volta ao formulário sem executar", () => {
    const { onExecute, onEditAgain } = renderForm({ pendingRead: readyCheckin() });

    fireEvent.click(screen.getByRole("button", { name: "Refazer" }));

    expect(onEditAgain).toHaveBeenCalledTimes(1);
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("check-out sem permissão de check-out é bloqueado", () => {
    const { onConfirm } = renderForm({
      pendingRead: pendingRead({ selectedOperation: "checkout" }),
      canCheckout: false,
    });

    expect(screen.getByText("Sua conta não tem permissão para check-out.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(searchCustodyMaterials)).not.toHaveBeenCalled();
  });

  it("check-in sem permissão de check-in é bloqueado", () => {
    renderForm({
      pendingRead: pendingRead({ selectedOperation: "checkin", selectedCustody: openCustody() }),
      canCheckin: false,
    });

    expect(screen.getByText("Sua conta não tem permissão para check-in.")).toBeInTheDocument();
  });
});
