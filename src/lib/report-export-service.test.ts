import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agendaPdf: vi.fn(),
  financialPdf: vi.fn(),
  eventPdf: vi.fn(),
  dashboardPdf: vi.fn(),
  teamPdf: vi.fn(),
  operationalPdf: vi.fn(),
  getRentalsFinancialSummary: vi.fn(),
  listReceivables: vi.fn(),
  listMaintenanceExpenses: vi.fn(),
  from: vi.fn(),
  tableResults: new Map<string, { data: unknown; error: Error | null }>(),
}));

function createQuery(table: string) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    in() {
      return builder;
    },
    single() {
      return builder;
    },
    then<
      TResult1 = { data: unknown; error: Error | null },
      TResult2 = never,
    >(
      onfulfilled?:
        | ((
            value: { data: unknown; error: Error | null },
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const result = mocks.tableResults.get(table) ?? {
        data: [],
        error: null,
      };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      mocks.from(table);
      return createQuery(table);
    },
  },
}));

// parseEmployeeExpenses/getCachePago etc. stay real (importActual) so the
// "equipe" report's cachê aggregation exercises the same parsing logic the
// "financeiro" report already relies on - only the jsPDF-rendering/save
// functions are stubbed out.
vi.mock("@/lib/pdf-export", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pdf-export")>("@/lib/pdf-export");
  return {
    ...actual,
    exportAgendaPDF: mocks.agendaPdf,
    exportFinancialTotalPDF: mocks.financialPdf,
    exportEventPDF: mocks.eventPdf,
  };
});
vi.mock("@/lib/pdf-export-dashboard", () => ({ exportDashboardSummaryPDF: mocks.dashboardPdf }));
vi.mock("@/lib/pdf-export-team", () => ({ exportTeamReportPDF: mocks.teamPdf }));
vi.mock("@/lib/pdf-export-operational", () => ({ exportOperationalReportPDF: mocks.operationalPdf }));
vi.mock("@/lib/financial-ledger-service", () => ({
  getRentalsFinancialSummary: mocks.getRentalsFinancialSummary,
  listReceivables: mocks.listReceivables,
  listMaintenanceExpenses: mocks.listMaintenanceExpenses,
}));

import {
  buildExportFileName,
  executeReportExport,
  getReportDateRange,
  validateReportFilters,
} from "./report-export-service";

const empresaId = "123e4567-e89b-42d3-a456-426614174000";

describe("report export filters and naming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableResults.clear();
    mocks.agendaPdf.mockResolvedValue(undefined);
    mocks.financialPdf.mockResolvedValue(undefined);
    mocks.eventPdf.mockResolvedValue(undefined);
    mocks.dashboardPdf.mockResolvedValue(undefined);
    mocks.teamPdf.mockResolvedValue(undefined);
    mocks.operationalPdf.mockResolvedValue(undefined);
    mocks.getRentalsFinancialSummary.mockResolvedValue({
      valorContratado: 0,
      valorRecebido: 0,
      valorAReceber: 0,
      valorVencido: 0,
      valorPendenteRegularizacao: 0,
    });
    mocks.listReceivables.mockResolvedValue({ items: [], total: 0 });
    mocks.listMaintenanceExpenses.mockResolvedValue({ items: [], total: 0 });
  });

  it("builds an inclusive calendar-month range", () => {
    expect(
      getReportDateRange({ mode: "mensal", month: 1, year: 2024 }),
    ).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
      title: "Fevereiro 2024",
    });
  });

  it("validates missing, reversed and event-specific filters", () => {
    expect(validateReportFilters({ mode: "mensal", month: 0 })).toMatch(
      /mês e o ano/i,
    );
    expect(
      validateReportFilters({
        mode: "periodo",
        startDate: new Date(2026, 6, 30),
        endDate: new Date(2026, 6, 1),
      }),
    ).toMatch(/não pode ser maior/i);
    expect(validateReportFilters({ mode: "evento" })).toMatch(
      /selecione um evento/i,
    );
  });

  it("normalizes accents and preserves an ISO event calendar date", () => {
    expect(
      buildExportFileName({
        reportType: "financeiro",
        filters: { mode: "evento", eventId: "event-1" },
        eventName: "São João — Edição 2026",
        eventDate: "2026-07-29",
      }),
    ).toBe("relatorio-financeiro-sao-joao-edicao-2026-29-07-2026");
  });

  it("exports only events inside the selected period", async () => {
    mocks.tableResults.set("events", {
      data: [
        {
          id: "event-in",
          empresa_id: empresaId,
          name: "Evento Julho",
          date: "2026-07-15",
        },
        {
          id: "event-out",
          empresa_id: empresaId,
          name: "Evento Agosto",
          date: "2026-08-01",
        },
      ],
      error: null,
    });

    await executeReportExport({
      empresaId,
      reportType: "agenda",
      exportFormat: "pdf",
      filters: {
        mode: "periodo",
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2026, 6, 31),
      },
    });

    expect(mocks.agendaPdf).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "event-in" })],
      undefined,
      "pdf",
      {
        tipo: "",
        customName:
          "relatorio-agenda-periodo-2026-07-01-a-2026-07-31",
      },
    );
  });

  it("exports one event financial report with server-loaded values, no rentals section by default", async () => {
    mocks.tableResults.set("financials", {
      data: [
        {
          id: "financial-1",
          event_id: "event-1",
          empresa_id: empresaId,
          cache: 1000,
          events: {
            name: "Festival Verão",
            artist: "Banda",
            date: "2026-01-10",
            venue: "Arena",
            city: "Recife",
            status: "confirmado",
          },
        },
        {
          id: "financial-2",
          event_id: "event-2",
          empresa_id: empresaId,
          cache: 2000,
          events: {
            name: "Outro",
            date: "2026-01-11",
          },
        },
      ],
      error: null,
    });

    await executeReportExport({
      empresaId,
      reportType: "financeiro",
      exportFormat: "png",
      filters: { mode: "evento", eventId: "event-1" },
    });

    expect(mocks.financialPdf).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "financial-1" })],
      "Evento: Festival Verão",
      undefined,
      "png",
      {
        tipo: "",
        customName:
          "relatorio-financeiro-festival-verao-10-01-2026",
      },
      undefined,
      undefined,
    );
    expect(mocks.getRentalsFinancialSummary).not.toHaveBeenCalled();
    expect(mocks.listMaintenanceExpenses).not.toHaveBeenCalled();
  });

  // Bug report: "Relatório Financeiro mensal" refused to generate
  // ("Nenhum dado financeiro foi encontrado") whenever there were no event
  // financials in the period, even though the Financeiro screen was showing
  // real Locações numbers (Contratado/Recebido/A receber) for that same
  // company. The four cases below are exactly what was asked to be checked
  // explicitly: only eventos, only locações, both, and neither.
  describe("Relatório Financeiro: eventos e locações são fontes independentes", () => {
    const periodoJulho = {
      mode: "periodo" as const,
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2026, 6, 31),
    };

    function makeReceivable(overrides: Partial<Record<string, unknown>>) {
      return {
        id: "r1",
        empresa_id: empresaId,
        origem_tipo: "locacao_material",
        origem_id: "loc-1",
        cliente_id: "c1",
        cliente_nome: "Cliente A",
        cliente_nome_fantasia: null,
        tipo: "receita",
        descricao: "Locação #1",
        forma_cobranca: "avista",
        valor_original: 4000,
        valor_recebido: 2500,
        valor_estornado: 0,
        status: "parcial",
        vencimento: "2026-07-20",
        forma_pagamento: null,
        observacoes: null,
        vencido: false,
        requer_revisao_vencimento: false,
        created_at: "2026-07-15T12:00:00.000Z",
        ...overrides,
      };
    }

    it("somente eventos: gera normalmente sem seção de locações quando não há título no período", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "e1", cache: 1000, events: { name: "Show", date: "2026-07-10" } }],
        error: null,
      });
      mocks.listReceivables.mockResolvedValue({ items: [], total: 0 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.financialPdf).toHaveBeenCalledTimes(1);
      const [financials, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(financials).toHaveLength(1);
      expect(rentals).toEqual({
        summary: { valorContratado: 0, valorRecebido: 0, valorAReceber: 0, valorVencido: 0, valorPendenteRegularizacao: 0 },
        entries: [],
      });
    });

    it("somente locações: NÃO bloqueia mais com 'Nenhum dado financeiro' quando só há locações no período", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listReceivables.mockResolvedValue({ items: [makeReceivable({})], total: 1 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.financialPdf).toHaveBeenCalledTimes(1);
      const [financials, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(financials).toEqual([]);
      expect(rentals.summary).toEqual({
        valorContratado: 4000,
        valorRecebido: 2500,
        valorAReceber: 1500,
        valorVencido: 0,
        valorPendenteRegularizacao: 0,
      });
      expect(rentals.entries).toHaveLength(1);
    });

    it("eventos + locações: as duas seções vêm preenchidas", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "e1", cache: 1000, events: { name: "Show", date: "2026-07-10" } }],
        error: null,
      });
      mocks.listReceivables.mockResolvedValue({ items: [makeReceivable({})], total: 1 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      const [financials, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(financials).toHaveLength(1);
      expect(rentals.entries).toHaveLength(1);
      expect(rentals.summary.valorContratado).toBe(4000);
    });

    it("nenhum dos dois: aí sim lança 'Nenhum dado financeiro'", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listReceivables.mockResolvedValue({ items: [], total: 0 });

      await expect(
        executeReportExport({
          empresaId,
          reportType: "financeiro",
          exportFormat: "pdf",
          filters: periodoJulho,
          includeRentals: true,
        }),
      ).rejects.toThrow(/nenhum dado financeiro/i);

      expect(mocks.financialPdf).not.toHaveBeenCalled();
    });

    it("respeita o período: título de locação fora do mês selecionado não entra no resumo nem na tabela", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listReceivables.mockResolvedValue({
        items: [
          makeReceivable({ id: "in-july", created_at: "2026-07-15T12:00:00.000Z", valor_original: 4000, valor_recebido: 2500 }),
          makeReceivable({ id: "in-august", created_at: "2026-08-15T12:00:00.000Z", valor_original: 9999, valor_recebido: 0 }),
        ],
        total: 2,
      });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      const [, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(rentals.entries.map((e: { id: string }) => e.id)).toEqual(["in-july"]);
      expect(rentals.summary.valorContratado).toBe(4000);
    });

    it("não usa a posição global: obter_resumo_financeiro_locacoes/getRentalsFinancialSummary não é chamado para relatório mensal/período", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listReceivables.mockResolvedValue({ items: [makeReceivable({})], total: 1 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.getRentalsFinancialSummary).not.toHaveBeenCalled();
    });

    it("locações não pertencem a um evento: seção fica ausente (não null-de-erro) em relatório de evento específico", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "event-1", cache: 1000, events: { name: "Festival Verão", date: "2026-07-10" } }],
        error: null,
      });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: { mode: "evento", eventId: "event-1" },
        includeRentals: true,
      });

      expect(mocks.listReceivables).not.toHaveBeenCalled();
      const [, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(rentals).toBeUndefined();
    });

    it("pagina listar_contas_receber até esgotar o total antes de agregar", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      const page1 = Array.from({ length: 100 }, (_, i) => makeReceivable({ id: `p1-${i}`, valor_original: 10, valor_recebido: 0 }));
      const page2 = Array.from({ length: 20 }, (_, i) => makeReceivable({ id: `p2-${i}`, valor_original: 10, valor_recebido: 0 }));
      mocks.listReceivables
        .mockResolvedValueOnce({ items: page1, total: 120 })
        .mockResolvedValueOnce({ items: page2, total: 120 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.listReceivables).toHaveBeenCalledTimes(2);
      const [, , , , , rentals] = mocks.financialPdf.mock.calls[0];
      expect(rentals.entries).toHaveLength(120);
      expect(rentals.summary.valorContratado).toBe(1200);
    });
  });

  // Same bug shape as Locações above, now covering the newly added
  // Manutenções section: a period with only concluded maintenance orders
  // (no event financials, no locações) must not be blocked, must respect
  // the period filter via concluida_em, must stay independent of Locações
  // (no double counting - see computeConsolidatedFinancialResult's own unit
  // tests in pdf-export.test.ts for the arithmetic side of that guarantee),
  // and must be absent for a single-evento report the same way Locações is.
  describe("Relatório Financeiro: manutenções", () => {
    const periodoJulho = {
      mode: "periodo" as const,
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2026, 6, 31),
    };

    function makeMaintenanceExpense(overrides: Partial<Record<string, unknown>>) {
      return {
        id: "m1",
        empresa_id: empresaId,
        origem_id: "ordem-1",
        ordem_numero: "MAN-2026-000001",
        material_id: "mat-1",
        material_nome: "Console A1",
        material_codigo: "COD-1",
        descricao: "Manutenção MAN-2026-000001",
        valor_original: 160,
        status: "recebido",
        concluida_em: "2026-07-15T12:00:00.000Z",
        ...overrides,
      };
    }

    it("somente manutenções: NÃO bloqueia com 'Nenhum dado financeiro' quando só há manutenções no período", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listReceivables.mockResolvedValue({ items: [], total: 0 });
      mocks.listMaintenanceExpenses.mockResolvedValue({ items: [makeMaintenanceExpense({})], total: 1 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.financialPdf).toHaveBeenCalledTimes(1);
      const [financials, , , , , rentals, maintenance] = mocks.financialPdf.mock.calls[0];
      expect(financials).toEqual([]);
      expect(rentals.entries).toEqual([]);
      expect(maintenance.entries).toHaveLength(1);
      expect(maintenance.valorTotal).toBe(160);
    });

    it("eventos + locações + manutenções: as três seções vêm preenchidas ao mesmo tempo", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "e1", cache: 1000, events: { name: "Show", date: "2026-07-10" } }],
        error: null,
      });
      mocks.listReceivables.mockResolvedValue({
        items: [{
          id: "r1", empresa_id: empresaId, origem_tipo: "locacao_material", origem_id: "loc-1",
          cliente_id: "c1", cliente_nome: "Cliente A", cliente_nome_fantasia: null, tipo: "receita",
          descricao: "Locação #1", forma_cobranca: "avista", valor_original: 4000, valor_recebido: 2500,
          valor_estornado: 0, status: "parcial", vencimento: "2026-07-20", forma_pagamento: null,
          observacoes: null, vencido: false, requer_revisao_vencimento: false, created_at: "2026-07-15T12:00:00.000Z",
        }],
        total: 1,
      });
      mocks.listMaintenanceExpenses.mockResolvedValue({ items: [makeMaintenanceExpense({})], total: 1 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      const [financials, , , , , rentals, maintenance] = mocks.financialPdf.mock.calls[0];
      expect(financials).toHaveLength(1);
      expect(rentals.entries).toHaveLength(1);
      expect(maintenance.entries).toHaveLength(1);
      expect(maintenance.valorTotal).toBe(160);
    });

    it("respeita o período: manutenção concluída fora do mês selecionado não entra no total nem na tabela", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      mocks.listMaintenanceExpenses.mockResolvedValue({
        items: [
          makeMaintenanceExpense({ id: "in-july", concluida_em: "2026-07-15T12:00:00.000Z", valor_original: 160 }),
          makeMaintenanceExpense({ id: "in-august", concluida_em: "2026-08-15T12:00:00.000Z", valor_original: 9999 }),
        ],
        total: 2,
      });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      const [, , , , , , maintenance] = mocks.financialPdf.mock.calls[0];
      expect(maintenance.entries.map((e: { id: string }) => e.id)).toEqual(["in-july"]);
      expect(maintenance.valorTotal).toBe(160);
    });

    it("manutenções não pertencem a um evento: seção fica ausente (não null-de-erro) em relatório de evento específico", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "event-1", cache: 1000, events: { name: "Festival Verão", date: "2026-07-10" } }],
        error: null,
      });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: { mode: "evento", eventId: "event-1" },
        includeRentals: true,
      });

      expect(mocks.listMaintenanceExpenses).not.toHaveBeenCalled();
      const [, , , , , , maintenance] = mocks.financialPdf.mock.calls[0];
      expect(maintenance).toBeUndefined();
    });

    it("pagina listar_despesas_manutencao até esgotar o total antes de somar", async () => {
      mocks.tableResults.set("financials", { data: [], error: null });
      const page1 = Array.from({ length: 100 }, (_, i) => makeMaintenanceExpense({ id: `p1-${i}`, valor_original: 10 }));
      const page2 = Array.from({ length: 20 }, (_, i) => makeMaintenanceExpense({ id: `p2-${i}`, valor_original: 10 }));
      mocks.listMaintenanceExpenses
        .mockResolvedValueOnce({ items: page1, total: 120 })
        .mockResolvedValueOnce({ items: page2, total: 120 });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: true,
      });

      expect(mocks.listMaintenanceExpenses).toHaveBeenCalledTimes(2);
      const [, , , , , , maintenance] = mocks.financialPdf.mock.calls[0];
      expect(maintenance.entries).toHaveLength(120);
      expect(maintenance.valorTotal).toBe(1200);
    });

    it("sem permissão financeira (includeRentals=false): nem locações nem manutenções são buscadas", async () => {
      mocks.tableResults.set("financials", {
        data: [{ id: "f1", event_id: "e1", cache: 1000, events: { name: "Show", date: "2026-07-10" } }],
        error: null,
      });

      await executeReportExport({
        empresaId,
        reportType: "financeiro",
        exportFormat: "pdf",
        filters: periodoJulho,
        includeRentals: false,
      });

      expect(mocks.listReceivables).not.toHaveBeenCalled();
      expect(mocks.listMaintenanceExpenses).not.toHaveBeenCalled();
      const [, , , , , rentals, maintenance] = mocks.financialPdf.mock.calls[0];
      expect(rentals).toBeUndefined();
      expect(maintenance).toBeUndefined();
    });
  });

  it("fails before querying when filters are invalid", async () => {
    await expect(
      executeReportExport({
        empresaId,
        reportType: "agenda",
        exportFormat: "pdf",
        filters: { mode: "periodo" },
      }),
    ).rejects.toThrow(/data inicial/i);

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.agendaPdf).not.toHaveBeenCalled();
  });

  it("reports an empty result instead of generating a blank agenda export", async () => {
    mocks.tableResults.set("events", { data: [], error: null });

    await expect(
      executeReportExport({
        empresaId,
        reportType: "agenda",
        exportFormat: "pdf",
        filters: { mode: "mensal", month: 6, year: 2026 },
      }),
    ).rejects.toThrow(/nenhum evento/i);

    expect(mocks.agendaPdf).not.toHaveBeenCalled();
  });

  it("builds a real dashboard summary from events, financials and (when permitted) rentals - not an event list", async () => {
    mocks.tableResults.set("events", {
      data: [
        { id: "e1", name: "A", date: "2026-07-05", status: "confirmado" },
        { id: "e2", name: "B", date: "2026-07-20", status: "pendente" },
        { id: "e3", name: "C", date: "2026-08-01", status: "confirmado" },
      ],
      error: null,
    });
    mocks.tableResults.set("financials", {
      data: [
        {
          id: "f1",
          event_id: "e1",
          cache: 1000,
          transport: 100,
          events: { name: "A", date: "2026-07-05" },
        },
        {
          id: "f2",
          event_id: "e3",
          cache: 500,
          transport: 0,
          events: { name: "C", date: "2026-08-01" },
        },
      ],
      error: null,
    });
    const summary = {
      valorContratado: 10,
      valorRecebido: 5,
      valorAReceber: 5,
      valorVencido: 0,
      valorPendenteRegularizacao: 0,
    };
    mocks.getRentalsFinancialSummary.mockResolvedValue(summary);

    await executeReportExport({
      empresaId,
      reportType: "dashboard",
      exportFormat: "pdf",
      filters: {
        mode: "periodo",
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2026, 6, 31),
      },
      includeRentals: true,
    });

    expect(mocks.agendaPdf).not.toHaveBeenCalled();
    expect(mocks.dashboardPdf).toHaveBeenCalledTimes(1);
    const [data] = mocks.dashboardPdf.mock.calls[0];
    // Only the July events/financials are in scope for the period, but the
    // trend table (allFinancials) always sees every financial record.
    expect(data.events.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"]);
    expect(data.financials.map((f: { id: string }) => f.id)).toEqual(["f1"]);
    expect(data.allFinancials.map((f: { id: string }) => f.id)).toEqual(["f1", "f2"]);
    expect(data.rentals).toEqual(summary);
  });

  it("does not throw a dashboard report for a period with no activity - renders zeros instead", async () => {
    mocks.tableResults.set("events", { data: [], error: null });
    mocks.tableResults.set("financials", { data: [], error: null });

    await expect(
      executeReportExport({
        empresaId,
        reportType: "dashboard",
        exportFormat: "pdf",
        filters: { mode: "mensal", month: 0, year: 2026 },
      }),
    ).resolves.toBeUndefined();

    expect(mocks.dashboardPdf).toHaveBeenCalledTimes(1);
    const [data] = mocks.dashboardPdf.mock.calls[0];
    expect(data.events).toEqual([]);
    expect(data.rentals).toBeUndefined();
  });

  it("aggregates the team report by funcionário: event frequency and cachê from financials in the period", async () => {
    mocks.tableResults.set("funcionarios", {
      data: [
        { id: "f1", nome: "Ana", funcao: "Técnica de Som", tipo: "equipe" },
        { id: "f2", nome: "Bruno", funcao: "Roadie", tipo: "freelancer" },
      ],
      error: null,
    });
    mocks.tableResults.set("event_funcionarios", {
      data: [
        { funcionario_id: "f1", events: { date: "2026-07-10" } },
        { funcionario_id: "f1", events: { date: "2026-08-01" } }, // outside period
        { funcionario_id: "f2", events: { date: "2026-07-15" } },
      ],
      error: null,
    });
    mocks.tableResults.set("financials", {
      data: [
        {
          id: "fin1",
          event_id: "e1",
          funcionarios_cache: [{ employeeId: "f1", name: "Ana", funcao: "Técnica de Som", cache: 500, food: 50 }],
          events: { name: "Show", date: "2026-07-10" },
        },
      ],
      error: null,
    });

    await executeReportExport({
      empresaId,
      reportType: "equipe",
      exportFormat: "pdf",
      filters: {
        mode: "periodo",
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2026, 6, 31),
      },
    });

    expect(mocks.teamPdf).toHaveBeenCalledTimes(1);
    const [rows] = mocks.teamPdf.mock.calls[0];
    expect(rows).toEqual([
      { funcionarioId: "f1", nome: "Ana", funcao: "Técnica de Som", tipo: "equipe", eventos: 1, cacheAcumulado: 500, alimentacaoAcumulada: 50 },
      { funcionarioId: "f2", nome: "Bruno", funcao: "Roadie", tipo: "freelancer", eventos: 1, cacheAcumulado: 0, alimentacaoAcumulada: 0 },
    ]);
  });

  it("aggregates the operational report the same way PainelOperacional.tsx does: team count and checklist progress per event", async () => {
    mocks.tableResults.set("events", {
      data: [
        { id: "e1", name: "Show A", date: "2026-07-10", status: "confirmado", city: "Recife", venue: "Arena" },
      ],
      error: null,
    });
    mocks.tableResults.set("event_funcionarios", {
      data: [{ event_id: "e1" }, { event_id: "e1" }],
      error: null,
    });
    mocks.tableResults.set("event_checklist_items", {
      data: [
        { event_id: "e1", concluido: true },
        { event_id: "e1", concluido: false },
      ],
      error: null,
    });

    await executeReportExport({
      empresaId,
      reportType: "operacional",
      exportFormat: "pdf",
      filters: {
        mode: "periodo",
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2026, 6, 31),
      },
    });

    expect(mocks.operationalPdf).toHaveBeenCalledTimes(1);
    const [data] = mocks.operationalPdf.mock.calls[0];
    expect(data.events).toEqual([
      { id: "e1", name: "Show A", date: "2026-07-10", status: "confirmado", city: "Recife", venue: "Arena", teamCount: 2, checklistTotal: 2, checklistDone: 1 },
    ]);
  });

  it("exports a single event report by reusing exportEventPDF, not the agenda list export", async () => {
    mocks.tableResults.set("events", {
      data: { id: "e1", name: "Festival X", date: "2026-07-20", city: "Recife" },
      error: null,
    });
    mocks.tableResults.set("event_days", {
      data: [{ id: "d1", event_id: "e1", day_number: 1 }],
      error: null,
    });
    mocks.tableResults.set("event_funcionarios", {
      data: [{ funcionario_id: "f1", funcionarios: { nome: "Ana", funcao: "Técnica" } }],
      error: null,
    });

    await executeReportExport({
      empresaId,
      reportType: "evento",
      exportFormat: "pdf",
      filters: { mode: "evento", eventId: "e1" },
    });

    expect(mocks.agendaPdf).not.toHaveBeenCalled();
    expect(mocks.eventPdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e1", name: "Festival X" }),
      [expect.objectContaining({ id: "d1" })],
      undefined,
      [{ nome: "Ana", funcao: "Técnica" }],
      "pdf",
    );
  });
});
