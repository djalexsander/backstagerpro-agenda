import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agendaPdf: vi.fn(),
  financialPdf: vi.fn(),
  from: vi.fn(),
  tableResults: new Map<string, { data: unknown[]; error: Error | null }>(),
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
    then<
      TResult1 = { data: unknown[]; error: Error | null },
      TResult2 = never,
    >(
      onfulfilled?:
        | ((
            value: { data: unknown[]; error: Error | null },
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

vi.mock("@/lib/pdf-export", () => ({
  exportAgendaPDF: mocks.agendaPdf,
  exportFinancialTotalPDF: mocks.financialPdf,
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

  it("exports one event financial report with server-loaded values", async () => {
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
    );
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

  it("reports an empty result instead of generating a blank export", async () => {
    mocks.tableResults.set("events", { data: [], error: null });

    await expect(
      executeReportExport({
        empresaId,
        reportType: "dashboard",
        exportFormat: "pdf",
        filters: { mode: "mensal", month: 6, year: 2026 },
      }),
    ).rejects.toThrow(/nenhum evento/i);

    expect(mocks.agendaPdf).not.toHaveBeenCalled();
  });
});
