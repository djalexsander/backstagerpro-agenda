import { endOfMonth, format, startOfMonth } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import type { PdfBranding } from "@/lib/pdf-branding";
import { exportAgendaPDF, exportFinancialTotalPDF, type ExportFormat } from "@/lib/pdf-export";
import type { SmartPDFNameOptions } from "@/lib/pdf-save";

type EventRow = Tables<"events">;
type FinancialRow = Tables<"financials"> & {
  events: Pick<EventRow, "name" | "artist" | "date" | "venue" | "city" | "status"> | null;
};

export type ReportType = "dashboard" | "financeiro" | "agenda";
export type ExportMode = "periodo" | "mensal" | "evento";

export interface ExportFilters {
  mode: ExportMode;
  startDate?: Date;
  endDate?: Date;
  month?: number;
  year?: number;
  eventId?: string;
}

export const REPORT_TITLES: Record<ReportType, string> = {
  dashboard: "Relatório do Dashboard",
  financeiro: "Relatório Financeiro",
  agenda: "Relatório da Agenda",
};

export const MODES_BY_REPORT: Record<ReportType, { value: ExportMode; label: string }[]> = {
  dashboard: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
  ],
  financeiro: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
    { value: "evento", label: "Evento específico" },
  ],
  agenda: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
    { value: "evento", label: "Evento específico" },
  ],
};

export const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface ExportExecutionParams {
  empresaId: string;
  reportType: ReportType;
  exportFormat: ExportFormat;
  filters: ExportFilters;
  branding?: PdfBranding;
}

interface ReportDateRange {
  start?: string;
  end?: string;
  title: string;
}

export function getReportDateRange(filters: ExportFilters, currentYear = new Date().getFullYear()): ReportDateRange {
  if (filters.mode === "mensal") {
    const month = filters.month ?? 0;
    const year = filters.year ?? currentYear;
    const date = new Date(year, month, 1);

    return {
      start: format(startOfMonth(date), "yyyy-MM-dd"),
      end: format(endOfMonth(date), "yyyy-MM-dd"),
      title: `${MONTHS[month]} ${year}`,
    };
  }

  if (filters.mode === "periodo") {
    return {
      start: filters.startDate ? format(filters.startDate, "yyyy-MM-dd") : undefined,
      end: filters.endDate ? format(filters.endDate, "yyyy-MM-dd") : undefined,
      title:
        filters.startDate && filters.endDate
          ? `${format(filters.startDate, "dd/MM/yyyy")} a ${format(filters.endDate, "dd/MM/yyyy")}`
          : "Período personalizado",
    };
  }

  return { title: "Evento específico" };
}

export function validateReportFilters(filters: ExportFilters): string | null {
  if (filters.mode === "mensal") {
    if (filters.month === undefined || filters.year === undefined) {
      return "Selecione o mês e o ano para gerar o relatório.";
    }
  }

  if (filters.mode === "periodo") {
    if (!filters.startDate || !filters.endDate) {
      return "Selecione a data inicial e a data final para gerar o relatório.";
    }

    if (filters.startDate > filters.endDate) {
      return "A data inicial não pode ser maior que a data final.";
    }
  }

  if (filters.mode === "evento" && !filters.eventId) {
    return "Selecione um evento para gerar o relatório.";
  }

  return null;
}

// ─── File naming ────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface FileNameContext {
  reportType: string;           // e.g. "dashboard", "financeiro", "agenda", "checklist"
  filters: ExportFilters;
  eventName?: string;
  eventDate?: string;           // ISO date
  /** Extra suffix like category or filter label */
  suffix?: string;
}

export function buildExportFileName(ctx: FileNameContext): string {
  const parts: string[] = [];

  // prefix: "relatorio-<type>" or "checklist"
  if (ctx.reportType === "checklist") {
    parts.push("checklist");
  } else {
    parts.push("relatorio");
    parts.push(slugify(ctx.reportType));
  }

  // mode-specific segment
  if (ctx.filters.mode === "mensal") {
    const month = pad2((ctx.filters.month ?? 0) + 1);
    const year = ctx.filters.year ?? new Date().getFullYear();
    parts.push(`${month}-${year}`);
  } else if (ctx.filters.mode === "periodo") {
    if (ctx.filters.startDate && ctx.filters.endDate) {
      const s = format(ctx.filters.startDate, "yyyy-MM-dd");
      const e = format(ctx.filters.endDate, "yyyy-MM-dd");
      parts.push(`periodo-${s}-a-${e}`);
    } else {
      parts.push("periodo");
    }
  } else if (ctx.filters.mode === "evento") {
    if (ctx.eventName) parts.push(slugify(ctx.eventName));
    if (ctx.eventDate) {
      try {
        const d = new Date(ctx.eventDate);
        if (!isNaN(d.getTime())) {
          parts.push(`${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`);
        }
      } catch { /* ignore */ }
    }
  }

  // optional suffix (e.g. category or filter label for checklist)
  if (ctx.suffix) parts.push(slugify(ctx.suffix));

  return parts.join("-");
}

function buildNameOpts(customName: string): SmartPDFNameOptions {
  return { tipo: "", customName };
}

function isWithinSelectedRange(date: string | null | undefined, start?: string, end?: string) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

async function fetchEventsForExport(empresaId: string, filters: ExportFilters) {
  let query = supabase
    .from("events")
    .select("id, artist, city, created_at, created_by, date, empresa_id, id, logistics_departure, material_list, name, num_days, observations, show_time, status, updated_at, venue")
    .eq("empresa_id", empresaId)
    .order("date", { ascending: false })
    .limit(1000);

  if (filters.mode === "evento" && filters.eventId) {
    query = query.eq("id", filters.eventId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const events = (data ?? []) as EventRow[];

  if (filters.mode === "evento") return events;

  const { start, end } = getReportDateRange(filters);
  return events.filter((event) => isWithinSelectedRange(event.date, start, end));
}

async function fetchFinancialsForExport(empresaId: string, filters: ExportFilters) {
  const { data, error } = await supabase
    .from("financials")
    .select("*, events!inner(name, artist, date, venue, city, status)")
    .eq("empresa_id", empresaId)
    .limit(1000);

  if (error) throw error;

  const financials = (data ?? []) as FinancialRow[];

  if (filters.mode === "evento") {
    return financials.filter((financial) => financial.event_id === filters.eventId);
  }

  const { start, end } = getReportDateRange(filters);
  return financials.filter((financial) => isWithinSelectedRange(financial.events?.date, start, end));
}

export async function executeReportExport({
  empresaId,
  reportType,
  exportFormat,
  filters,
  branding,
}: ExportExecutionParams) {
  const validationError = validateReportFilters(filters);

  if (validationError) {
    throw new Error(validationError);
  }

  const range = getReportDateRange(filters);

  if (reportType === "financeiro") {
    const financials = await fetchFinancialsForExport(empresaId, filters);

    if (financials.length === 0) {
      throw new Error("Nenhum dado financeiro foi encontrado para os filtros selecionados.");
    }

    const periodTitle =
      filters.mode === "evento" && financials[0]?.events?.name
        ? `Evento: ${financials[0].events.name}`
        : range.title;

    const fileName = buildExportFileName({
      reportType: "financeiro",
      filters,
      eventName: filters.mode === "evento" ? financials[0]?.events?.name ?? undefined : undefined,
      eventDate: filters.mode === "evento" ? financials[0]?.events?.date ?? undefined : undefined,
    });
    await exportFinancialTotalPDF(financials, periodTitle, branding, exportFormat, buildNameOpts(fileName));
    return;
  }

  const events = await fetchEventsForExport(empresaId, filters);

  if (events.length === 0) {
    throw new Error("Nenhum evento foi encontrado para os filtros selecionados.");
  }

  const fileName = buildExportFileName({
    reportType: reportType === "dashboard" ? "dashboard" : "agenda",
    filters,
    eventName: filters.mode === "evento" && events.length > 0 ? events[0].name : undefined,
    eventDate: filters.mode === "evento" && events.length > 0 ? events[0].date : undefined,
  });
  await exportAgendaPDF(events, branding, exportFormat, buildNameOpts(fileName));
}