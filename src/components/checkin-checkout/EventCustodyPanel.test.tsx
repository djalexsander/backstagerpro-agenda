import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustodyOperationView } from "@/lib/checkin-checkout-types";
import type { EventCustodyMaterialPageResult, EventCustodyTotals } from "@/lib/checkin-checkout-service";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

const { getEventCustodyTotals, listEventCustodyMaterials } = vi.hoisted(() => ({
  getEventCustodyTotals: vi.fn(),
  listEventCustodyMaterials: vi.fn(),
}));
vi.mock("@/lib/checkin-checkout-service", () => ({
  getEventCustodyTotals,
  listEventCustodyMaterials,
}));

vi.mock("@/components/checkin-checkout/CheckinDialog", () => ({
  CheckinDialog: ({ open, operation }: { open: boolean; operation: { id: string } | null }) =>
    open ? <div data-testid="checkin-dialog">checkin-para:{operation?.id}</div> : null,
}));

import { EventCustodyPanel } from "./EventCustodyPanel";

function operation(overrides: Partial<CustodyOperationView>): CustodyOperationView {
  return {
    id: "op1",
    empresa_id: "empresa1",
    material_id: "m1",
    material_nome: "Mesa de Som",
    material_codigo: "MESA-001",
    material_identificador: null,
    foto_path: null,
    tipo_controle: "quantidade",
    quantidade_retirada: 1,
    quantidade_devolvida: 0,
    quantidade_baixada: 0,
    quantidade_pendente: 1,
    localizacao_origem_id: "loc1",
    localizacao_origem_nome: "Depósito",
    retirada_em: "2026-08-14T18:42:00Z",
    previsao_retorno: null,
    executado_por: "user1",
    executor_nome: "Alex",
    responsavel_tipo: "funcionario",
    responsavel_usuario_id: null,
    responsavel_funcionario_id: "f1",
    responsavel_nome: "João",
    finalidade: "evento",
    referencia_tipo: "evento",
    referencia_id: "e1",
    observacao_saida: null,
    condicao_saida: "bom",
    status: "aberta",
    movimento_saida_id: "mov1",
    encerrada_em: null,
    created_at: "2026-08-14T18:42:00Z",
    updated_at: "2026-08-14T18:42:00Z",
    ...overrides,
  };
}

function totals(overrides: Partial<EventCustodyTotals> = {}): EventCustodyTotals {
  return { totalRetirado: 3, totalDevolvido: 1, totalPendente: 2, ...overrides };
}

function page(overrides: Partial<EventCustodyMaterialPageResult> = {}): EventCustodyMaterialPageResult {
  return { items: [], total: 0, ...overrides };
}

function mockEventsQuery(rows: Array<{ id: string; name: string; date: string }>) {
  fromMock.mockImplementation((table: string) => {
    if (table === "events") {
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      return { select };
    }
    if (table === "materiais") {
      const inMock = vi.fn().mockResolvedValue({ data: [], error: null });
      const eq = vi.fn().mockReturnValue({ in: inMock });
      const select = vi.fn().mockReturnValue({ eq });
      return { select };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function renderPanel(canCheckin = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EventCustodyPanel companyId="empresa1" canCheckin={canCheckin} locations={[]} />
    </QueryClientProvider>,
  );
}

// Mesmo padrão de ScannerOperationForm.test.tsx para abrir um <Select>
// Radix em jsdom (clique simples não é confiável aqui): foca o combobox e
// abre por teclado, escopado pela <Label> para não colidir com o outro
// Select (Localização de saída) que só aparece depois do evento escolhido.
function openSelect(labelText: string) {
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

async function selectEvent() {
  await pickOption("Evento", /Show de Encerramento/);
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
  vi.clearAllMocks();
  mockEventsQuery([{ id: "evt1", name: "Show de Encerramento", date: "2026-09-20" }]);
  getEventCustodyTotals.mockResolvedValue(totals());
  listEventCustodyMaterials.mockResolvedValue(page());
});

describe("EventCustodyPanel - carregamento inicial por evento", () => {
  it("não consulta nada até um evento ser selecionado", async () => {
    renderPanel();
    await screen.findByText("Selecione um evento para ver os materiais retirados e pendentes de devolução.");
    expect(getEventCustodyTotals).not.toHaveBeenCalled();
    expect(listEventCustodyMaterials).not.toHaveBeenCalled();
  });

  it("ao selecionar o evento, busca os totais e as duas listas (pendentes/devolvidos) já na primeira página", async () => {
    renderPanel();
    await selectEvent();

    await waitFor(() => expect(getEventCustodyTotals).toHaveBeenCalledWith("empresa1", "evt1", { search: undefined, locationId: undefined }));
    expect(listEventCustodyMaterials).toHaveBeenCalledWith("empresa1", "evt1", {
      pendente: true,
      page: 1,
      pageSize: 10,
      search: undefined,
      locationId: undefined,
    });
    expect(listEventCustodyMaterials).toHaveBeenCalledWith("empresa1", "evt1", {
      pendente: false,
      page: 1,
      pageSize: 10,
      search: undefined,
      locationId: undefined,
    });
    // scan support: a 3rd, unfiltered call capped at 100, used only for
    // resolving a barcode/QR code regardless of the visible page/filter.
    expect(listEventCustodyMaterials).toHaveBeenCalledWith("empresa1", "evt1", {
      pendente: true,
      page: 1,
      pageSize: 100,
    });

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("EventCustodyPanel - paginação real e independente por lista", () => {
  it("avança a página da lista de pendentes sem afetar a de devolvidos", async () => {
    listEventCustodyMaterials.mockImplementation(async (_company, _event, args) => {
      if (args.pendente === true && args.pageSize === 10) {
        return page({
          items: [
            {
              materialId: "m1",
              materialNome: "Mesa de Som",
              materialCodigo: "MESA-001",
              quantidadeRetirada: 1,
              quantidadeDevolvida: 0,
              quantidadePendente: 1,
              custodiasAbertas: [operation({})],
            },
          ],
          total: 25,
        });
      }
      return page();
    });

    renderPanel();
    await selectEvent();
    await screen.findByText("Mesa de Som");

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));

    await waitFor(() =>
      expect(listEventCustodyMaterials).toHaveBeenCalledWith("empresa1", "evt1", {
        pendente: true,
        page: 2,
        pageSize: 10,
        search: undefined,
        locationId: undefined,
      }),
    );
    // Nunca pediu página 2 da lista de devolvidos - as duas paginam de forma independente.
    expect(listEventCustodyMaterials).not.toHaveBeenCalledWith(
      "empresa1",
      "evt1",
      expect.objectContaining({ pendente: false, page: 2 }),
    );
  });

  it("digitar no filtro de busca reenvia a busca para as duas listas e volta para a página 1", async () => {
    renderPanel();
    await selectEvent();
    await waitFor(() => expect(listEventCustodyMaterials).toHaveBeenCalled());
    vi.clearAllMocks();
    mockEventsQuery([{ id: "evt1", name: "Show de Encerramento", date: "2026-09-20" }]);
    getEventCustodyTotals.mockResolvedValue(totals());
    listEventCustodyMaterials.mockResolvedValue(page());

    fireEvent.change(screen.getByPlaceholderText("Nome ou código do material"), { target: { value: "mesa" } });

    await waitFor(() =>
      expect(listEventCustodyMaterials).toHaveBeenCalledWith("empresa1", "evt1", {
        pendente: true,
        page: 1,
        pageSize: 10,
        search: "mesa",
        locationId: undefined,
      }),
    );
    expect(getEventCustodyTotals).toHaveBeenCalledWith("empresa1", "evt1", { search: "mesa", locationId: undefined });
    // A busca de escaneamento (pageSize 100, sem filtros) já foi buscada uma
    // vez ao selecionar o evento e não depende de "search" - sua queryKey não
    // muda, então não é refeita aqui. Cobrir que ELA fica sem filtro é
    // responsabilidade do teste "busca os totais e as duas listas" acima.
  });
});

describe("EventCustodyPanel - check-in continua funcionando", () => {
  it("clicar em 'Fazer check-in' de um material pendente abre o CheckinDialog na custódia correta", async () => {
    listEventCustodyMaterials.mockImplementation(async (_company, _event, args) => {
      if (args.pendente === true) {
        return page({
          items: [
            {
              materialId: "m1",
              materialNome: "Mesa de Som",
              materialCodigo: "MESA-001",
              quantidadeRetirada: 1,
              quantidadeDevolvida: 0,
              quantidadePendente: 1,
              custodiasAbertas: [operation({ id: "custodia-alvo" })],
            },
          ],
          total: 1,
        });
      }
      return page();
    });

    renderPanel();
    await selectEvent();
    await screen.findByText("Mesa de Som");

    fireEvent.click(screen.getByRole("button", { name: /Fazer check-in/ }));

    expect(await screen.findByTestId("checkin-dialog")).toHaveTextContent("checkin-para:custodia-alvo");
  });

  it("escanear um código que casa com um material pendente abre o CheckinDialog na custódia mais antiga", async () => {
    listEventCustodyMaterials.mockImplementation(async (_company, _event, args) => {
      if (args.pendente === true) {
        return page({
          items: [
            {
              materialId: "m1",
              materialNome: "Mesa de Som",
              materialCodigo: "MESA-001",
              quantidadeRetirada: 1,
              quantidadeDevolvida: 0,
              quantidadePendente: 1,
              custodiasAbertas: [operation({ id: "custodia-scan" })],
            },
          ],
          total: 1,
        });
      }
      return page();
    });

    renderPanel();
    await selectEvent();
    await screen.findByText("Mesa de Som");

    fireEvent.change(screen.getByPlaceholderText("Digite ou leia o código do material"), {
      target: { value: "MESA-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByTestId("checkin-dialog")).toHaveTextContent("checkin-para:custodia-scan");
  });

  it("escanear um código sem material pendente correspondente mostra erro e não abre o diálogo", async () => {
    renderPanel();
    await selectEvent();
    await waitFor(() => expect(listEventCustodyMaterials).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText("Digite ou leia o código do material"), {
      target: { value: "NAO-EXISTE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    expect(await screen.findByText("Nenhum material pendente encontrado para este código.")).toBeInTheDocument();
    expect(screen.queryByTestId("checkin-dialog")).not.toBeInTheDocument();
  });

  it("sem permissão de check-in, oculta o card de escaneamento e as ações de check-in", async () => {
    listEventCustodyMaterials.mockImplementation(async (_company, _event, args) => {
      if (args.pendente === true) {
        return page({
          items: [
            {
              materialId: "m1",
              materialNome: "Mesa de Som",
              materialCodigo: "MESA-001",
              quantidadeRetirada: 1,
              quantidadeDevolvida: 0,
              quantidadePendente: 1,
              custodiasAbertas: [operation({})],
            },
          ],
          total: 1,
        });
      }
      return page();
    });

    renderPanel(false);
    await selectEvent();
    await screen.findByText("Mesa de Som");

    expect(screen.queryByPlaceholderText("Digite ou leia o código do material")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fazer check-in/ })).not.toBeInTheDocument();
    // Sem permissão de check-in, a busca dedicada ao scan nunca precisa rodar.
    expect(listEventCustodyMaterials).not.toHaveBeenCalledWith(
      "empresa1",
      "evt1",
      expect.objectContaining({ pageSize: 100 }),
    );
  });
});
