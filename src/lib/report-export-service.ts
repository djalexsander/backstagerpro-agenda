import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import type { PdfBranding } from "@/lib/pdf-branding";
import {
  exportAgendaPDF,
  exportEventPDF,
  exportFinancialTotalPDF,
  parseEmployeeExpenses,
  type ExportFormat,
} from "@/lib/pdf-export";
import type { SmartPDFNameOptions } from "@/lib/pdf-save";
import { exportDashboardSummaryPDF } from "@/lib/pdf-export-dashboard";
import { exportTeamReportPDF, type TeamReportRow } from "@/lib/pdf-export-team";
import { exportOperationalReportPDF, type OperationalEventRow } from "@/lib/pdf-export-operational";
import { getRentalsFinancialSummary, listMaintenanceExpenses, listReceivables } from "@/lib/financial-ledger-service";
import type { FinancialMaintenanceSection, FinancialRentalsSection } from "@/lib/pdf-export";
import type { FinancialLedgerStatus, MaintenanceExpenseEntry, ReceivableEntry } from "@/lib/financial-ledger-types";
import { toDatetimeLocalValue } from "@/lib/datetime";

type EventRow = Tables<"events">;
type EventDayRow = Tables<"event_days">;
type FinancialRow = Tables<"financials"> & {
  events: Pick<EventRow, "name" | "artist" | "date" | "venue" | "city" | "status"> | null;
};

export type ReportType = "dashboard" | "financeiro" | "agenda" | "equipe" | "operacional" | "evento";
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
  equipe: "Relatório de Equipe",
  operacional: "Relatório Operacional",
  evento: "Relatório por Evento",
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
  equipe: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
  ],
  operacional: [
    { value: "periodo", label: "Por período" },
    { value: "mensal", label: "Mensal" },
  ],
  evento: [
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
  /**
   * Whether the requesting user can see Locações AND Manutenções financial
   * data - both live in financeiro_lancamentos behind the exact same gate
   * (mirrors getFinancialLedgerPermissions().visualizar on-screen: role +
   * módulo financeiro_avancado). The caller computes this - this service
   * never re-derives permissions - and only "financeiro"/"dashboard" reports
   * use it; other report types ignore the flag.
   */
  includeRentals?: boolean;
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
        const d = /^\d{4}-\d{2}-\d{2}$/.test(ctx.eventDate)
          ? parseISO(ctx.eventDate)
          : new Date(ctx.eventDate);
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

async function fetchAllFinancialsWithEvents(empresaId: string): Promise<FinancialRow[]> {
  const { data, error } = await supabase
    .from("financials")
    .select("*, events!inner(name, artist, date, venue, city, status)")
    .eq("empresa_id", empresaId)
    .limit(1000);

  if (error) throw error;

  return (data ?? []) as FinancialRow[];
}

async function fetchFinancialsForExport(empresaId: string, filters: ExportFilters) {
  const financials = await fetchAllFinancialsWithEvents(empresaId);

  if (filters.mode === "evento") {
    return financials.filter((financial) => financial.event_id === filters.eventId);
  }

  const { start, end } = getReportDateRange(filters);
  return financials.filter((financial) => isWithinSelectedRange(financial.events?.date, start, end));
}

// ─── Locações (Relatório Financeiro) ───────────────────────────────────

// Same 5 aggregates obter_resumo_financeiro_locacoes computes server-side
// (see 20260806090000_material_rental_financial_integration.sql) - applied
// here to a period-filtered subset of listar_contas_receber's rows instead
// of the whole company, since that RPC has no date-range parameter and is
// the shared source LocacoesReceivablesPanel/Dashboard already trust for
// the *global* position. Re-deriving the same sums from the same statuses
// keeps this in sync with that RPC instead of inventing a second formula.
const RENTAL_STATUSES_EXCLUDED_FROM_CONTRATADO = new Set<FinancialLedgerStatus>([
  "cancelado",
  "cancelado_pendente_regularizacao",
  "estornado",
]);

// listar_contas_receber paginates (100/page max) with no date-range filter -
// every page is walked here so callers get the company's full receivables
// set to filter/aggregate themselves, same reasoning as the events/financials
// ".limit(1000)" fetches above.
export async function fetchAllReceivableEntries(empresaId: string): Promise<ReceivableEntry[]> {
  const allEntries: ReceivableEntry[] = [];
  let page = 1;
  const pageSize = 100;
  // Guards against an infinite loop if total_count is ever inconsistent.
  for (let guard = 0; guard < 50; guard += 1) {
    const { items, total } = await listReceivables(empresaId, page, pageSize);
    allEntries.push(...items);
    if (items.length === 0 || allEntries.length >= total) break;
    page += 1;
  }
  return allEntries;
}

// Filtering by `vencimento` was the first thing tried here, but
// sync_material_rental_financial_entry (same migration) only ever sets
// vencimento on the lançamento for forma_cobranca='avista' - a parcelado
// lançamento's own vencimento is always NULL (each parcela carries its own
// instead, not exposed by listar_contas_receber), so a vencimento-based
// filter would silently drop every installment-billed locação from every
// period report. created_at is used instead: it's always present on both
// avista and parcelado titles. created_at is a timestamptz (UTC) - converted
// to the reporter's local calendar date the same way toDatetimeLocalValue
// already does elsewhere in this codebase, so a locação created just after
// midnight UTC in Brazil (UTC-3) doesn't get miscounted into the next day.
export async function fetchRentalsForFinancialReport(
  empresaId: string,
  filters: ExportFilters,
): Promise<FinancialRentalsSection | null> {
  // Locações aren't linked to a specific evento - the section doesn't apply
  // to a single-event report.
  if (filters.mode === "evento") return null;

  const allEntries = await fetchAllReceivableEntries(empresaId);

  const { start, end } = getReportDateRange(filters);
  const entries = allEntries.filter((entry) =>
    isWithinSelectedRange(toDatetimeLocalValue(new Date(entry.created_at)).slice(0, 10), start, end),
  );

  let valorContratado = 0;
  let valorRecebido = 0;
  let valorAReceber = 0;
  let valorVencido = 0;
  let valorPendenteRegularizacao = 0;

  for (const entry of entries) {
    if (!RENTAL_STATUSES_EXCLUDED_FROM_CONTRATADO.has(entry.status)) {
      valorContratado += entry.valor_original;
      valorRecebido += entry.valor_recebido;
    }
    if (entry.status === "pendente" || entry.status === "parcial") {
      valorAReceber += entry.valor_original - entry.valor_recebido;
    }
    // entry.vencido itself only ever fires for forma_cobranca='avista' (same
    // migration's listar_contas_receber SQL - a parcelado título's overdue
    // state lives per-parcela, not on this row), so an overdue installment
    // inside a parcelado título isn't counted here either - the same gap
    // obter_resumo_financeiro_locacoes closes with a separate query against
    // financeiro_parcelas that listar_contas_receber doesn't expose per-row.
    if (entry.vencido) {
      valorVencido += entry.valor_original - entry.valor_recebido;
    }
    if (entry.status === "cancelado_pendente_regularizacao") {
      valorPendenteRegularizacao += entry.valor_recebido;
    }
  }

  return {
    summary: { valorContratado, valorRecebido, valorAReceber, valorVencido, valorPendenteRegularizacao },
    entries,
  };
}

// ─── Manutenções (Relatório Financeiro) ────────────────────────────────

// listar_despesas_manutencao paginates the same way listar_contas_receber
// does - same "walk every page" reasoning as fetchAllReceivableEntries above.
async function fetchAllMaintenanceExpenses(empresaId: string): Promise<MaintenanceExpenseEntry[]> {
  const allEntries: MaintenanceExpenseEntry[] = [];
  let page = 1;
  const pageSize = 100;
  for (let guard = 0; guard < 50; guard += 1) {
    const { items, total } = await listMaintenanceExpenses(empresaId, page, pageSize);
    allEntries.push(...items);
    if (items.length === 0 || allEntries.length >= total) break;
    page += 1;
  }
  return allEntries;
}

// Every entry here is already a settled expense (financeiro_lancamentos.status
// is always 'recebido' for origem_tipo='manutencao_equipamento' - see
// sync_equipment_maintenance_financial_entry), so - unlike Locações - there
// is no separate "vencido"/"a receber" breakdown to compute: valorTotal is
// simply the sum of what's in the period. Filtered by concluida_em (the
// date manutenção actually completed and the cost was locked in), the same
// way Locações is filtered by created_at, and through the same local-date
// conversion to avoid an off-by-one-day near UTC midnight.
export async function fetchMaintenanceForFinancialReport(
  empresaId: string,
  filters: ExportFilters,
): Promise<FinancialMaintenanceSection | null> {
  // Manutenções aren't linked to a specific evento either - same reasoning
  // as fetchRentalsForFinancialReport above.
  if (filters.mode === "evento") return null;

  const allEntries = await fetchAllMaintenanceExpenses(empresaId);

  const { start, end } = getReportDateRange(filters);
  const entries = allEntries.filter((entry) =>
    isWithinSelectedRange(toDatetimeLocalValue(new Date(entry.concluida_em)).slice(0, 10), start, end),
  );

  const valorTotal = entries.reduce((sum, entry) => sum + entry.valor_original, 0);

  return { valorTotal, entries };
}

// ─── Equipe ─────────────────────────────────────────────────────────────

async function fetchTeamReportRows(empresaId: string, filters: ExportFilters): Promise<TeamReportRow[]> {
  const { data: funcionarios, error: funcError } = await supabase
    .from("funcionarios")
    .select("id, nome, funcao, tipo")
    .eq("empresa_id", empresaId)
    .order("nome");
  if (funcError) throw funcError;

  const { data: assignments, error: assignError } = await supabase
    .from("event_funcionarios")
    .select("funcionario_id, events(date)")
    .eq("empresa_id", empresaId);
  if (assignError) throw assignError;

  const { start, end } = getReportDateRange(filters);

  const eventCountByFuncionario = new Map<string, number>();
  for (const row of (assignments ?? []) as Array<{ funcionario_id: string; events: { date: string } | null }>) {
    if (!isWithinSelectedRange(row.events?.date, start, end)) continue;
    eventCountByFuncionario.set(row.funcionario_id, (eventCountByFuncionario.get(row.funcionario_id) ?? 0) + 1);
  }

  const financials = await fetchFinancialsForExport(empresaId, filters);
  const cacheByFuncionario = new Map<string, { cache: number; food: number }>();
  for (const financial of financials) {
    for (const emp of parseEmployeeExpenses(financial.funcionarios_cache)) {
      if (!emp.employeeId) continue;
      const current = cacheByFuncionario.get(emp.employeeId) ?? { cache: 0, food: 0 };
      current.cache += emp.cache || 0;
      current.food += emp.food || 0;
      cacheByFuncionario.set(emp.employeeId, current);
    }
  }

  return (funcionarios ?? []).map((f) => ({
    funcionarioId: f.id,
    nome: f.nome,
    funcao: f.funcao,
    tipo: f.tipo,
    eventos: eventCountByFuncionario.get(f.id) ?? 0,
    cacheAcumulado: cacheByFuncionario.get(f.id)?.cache ?? 0,
    alimentacaoAcumulada: cacheByFuncionario.get(f.id)?.food ?? 0,
  }));
}

// ─── Operacional ────────────────────────────────────────────────────────

async function fetchOperationalReportRows(empresaId: string, filters: ExportFilters): Promise<OperationalEventRow[]> {
  const events = await fetchEventsForExport(empresaId, filters);
  const eventIds = events.map((e) => e.id);

  if (eventIds.length === 0) return [];

  const { data: assignments, error: assignError } = await supabase
    .from("event_funcionarios")
    .select("event_id")
    .eq("empresa_id", empresaId)
    .in("event_id", eventIds);
  if (assignError) throw assignError;

  const { data: checklist, error: checklistError } = await supabase
    .from("event_checklist_items")
    .select("event_id, concluido")
    .eq("empresa_id", empresaId)
    .in("event_id", eventIds);
  if (checklistError) throw checklistError;

  const teamCountByEvent = new Map<string, number>();
  for (const row of assignments ?? []) {
    teamCountByEvent.set(row.event_id, (teamCountByEvent.get(row.event_id) ?? 0) + 1);
  }

  const checklistByEvent = new Map<string, { total: number; done: number }>();
  for (const item of checklist ?? []) {
    const current = checklistByEvent.get(item.event_id) ?? { total: 0, done: 0 };
    current.total += 1;
    if (item.concluido) current.done += 1;
    checklistByEvent.set(item.event_id, current);
  }

  return events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    status: e.status,
    city: e.city,
    venue: e.venue,
    teamCount: teamCountByEvent.get(e.id) ?? 0,
    checklistTotal: checklistByEvent.get(e.id)?.total ?? 0,
    checklistDone: checklistByEvent.get(e.id)?.done ?? 0,
  }));
}

// ─── Evento ─────────────────────────────────────────────────────────────

async function fetchEventReportData(empresaId: string, eventId: string) {
  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("empresa_id", empresaId)
    .single();
  if (error) throw error;

  const { data: eventDays, error: daysError } = await supabase
    .from("event_days")
    .select("*")
    .eq("event_id", eventId)
    .order("day_number", { ascending: true });
  if (daysError) throw daysError;

  const { data: teamRows, error: teamError } = await supabase
    .from("event_funcionarios")
    .select("funcionario_id, funcionarios(nome, funcao)")
    .eq("event_id", eventId);
  if (teamError) throw teamError;

  const teamMembers = ((teamRows ?? []) as Array<{ funcionarios: { nome: string; funcao: string } | null }>).map((tm) => ({
    nome: tm.funcionarios?.nome || "",
    funcao: tm.funcionarios?.funcao || "",
  }));

  return { event: event as EventRow, eventDays: (eventDays ?? []) as EventDayRow[], teamMembers };
}

// ─── Orchestration ──────────────────────────────────────────────────────

export async function executeReportExport({
  empresaId,
  reportType,
  exportFormat,
  filters,
  branding,
  includeRentals,
}: ExportExecutionParams) {
  const validationError = validateReportFilters(filters);

  if (validationError) {
    throw new Error(validationError);
  }

  const range = getReportDateRange(filters);

  if (reportType === "evento") {
    const { event, eventDays, teamMembers } = await fetchEventReportData(empresaId, filters.eventId!);
    await exportEventPDF(event, eventDays, branding, teamMembers, exportFormat);
    return;
  }

  if (reportType === "dashboard") {
    const events = await fetchEventsForExport(empresaId, filters);
    const financials = await fetchFinancialsForExport(empresaId, filters);
    const allFinancials = await fetchAllFinancialsWithEvents(empresaId);
    const rentals = includeRentals ? await getRentalsFinancialSummary(empresaId) : undefined;

    const fileName = buildExportFileName({ reportType: "dashboard", filters });
    await exportDashboardSummaryPDF(
      { events, financials, allFinancials, rentals },
      range.title,
      branding,
      exportFormat,
      buildNameOpts(fileName),
    );
    return;
  }

  if (reportType === "equipe") {
    const rows = await fetchTeamReportRows(empresaId, filters);
    const fileName = buildExportFileName({ reportType: "equipe", filters });
    await exportTeamReportPDF(rows, range.title, branding, exportFormat, buildNameOpts(fileName));
    return;
  }

  if (reportType === "operacional") {
    const rows = await fetchOperationalReportRows(empresaId, filters);
    const fileName = buildExportFileName({ reportType: "operacional", filters });
    await exportOperationalReportPDF({ events: rows }, range.title, branding, exportFormat, buildNameOpts(fileName));
    return;
  }

  if (reportType === "financeiro") {
    const financials = await fetchFinancialsForExport(empresaId, filters);
    const rentals = includeRentals ? await fetchRentalsForFinancialReport(empresaId, filters) : null;
    const maintenance = includeRentals ? await fetchMaintenanceForFinancialReport(empresaId, filters) : null;
    const hasRentalsData = Boolean(rentals && rentals.entries.length > 0);
    const hasMaintenanceData = Boolean(maintenance && maintenance.entries.length > 0);

    // Any one source is enough to generate the report - only block when
    // eventos, locações and manutenções are all empty for the selected period.
    if (financials.length === 0 && !hasRentalsData && !hasMaintenanceData) {
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

    await exportFinancialTotalPDF(financials, periodTitle, branding, exportFormat, buildNameOpts(fileName), rentals ?? undefined, maintenance ?? undefined);
    return;
  }

  const events = await fetchEventsForExport(empresaId, filters);

  const firstEvent = events[0];
  if (!firstEvent) {
    throw new Error("Nenhum evento foi encontrado para os filtros selecionados.");
  }

  const fileName = buildExportFileName({
    reportType: "agenda",
    filters,
    eventName: filters.mode === "evento" ? firstEvent.name : undefined,
    eventDate: filters.mode === "evento" ? firstEvent.date : undefined,
  });
  await exportAgendaPDF(events, branding, exportFormat, buildNameOpts(fileName));
}
