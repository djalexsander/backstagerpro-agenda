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
import { buildA4DocumentHtml, type A4Metric, type A4TableSection } from "@/lib/a4-document-print";

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

interface PrintExecutionParams extends Omit<ExportExecutionParams, "exportFormat" | "branding"> {
  companyName: string;
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

// ─── Safe, unbounded pagination for direct table queries ──────────────────
//
// P1-12: every fetcher below used to run a single ".limit(1000)" query with
// no period filter, then filter by date in JS - once a company passed ~1000
// total rows, a report for an older period could come back incomplete or
// silently empty, because the rows that matched the period were never in
// the single page fetched (typically the 1000 *most recent* rows, since the
// query was ordered by date desc). The fix has two independent parts: (1)
// the date range the user actually chose is now a real filter in the query
// itself (.gte/.lte, or an embedded-resource filter through an events!inner
// join for tables with no date column of their own - see fetchFinancialsForExport),
// applied BEFORE any page is fetched; (2) whatever still matches - which can
// legitimately be more than 1000 rows for a wide/all-time query - is walked
// page by page instead of being capped, so a large-but-correct result is
// never silently truncated either (section 5/6 of the request this fixes:
// no arbitrary cap, safe pagination instead).
const PAGE_SIZE = 1000;
// Defensive circuit breaker against a genuinely infinite loop (e.g. a
// misbehaving sort that keeps returning the same page), not a new business
// limit: 50 pages * 1000 rows/page is 50,000 rows, far beyond any
// realistic per-company report size today.
const MAX_PAGES = 50;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    // A short page is the only reliable "that was the last one" signal -
    // return what was collected as the real, complete result.
    if (batch.length < PAGE_SIZE) return rows;
  }
  // Every one of MAX_PAGES pages came back full: there is no way to tell
  // from here whether that's genuinely the whole result or more rows exist
  // past this point without fetching yet another page past the safety
  // ceiling. Silently returning `rows` here would present a dataset capped
  // at MAX_PAGES * PAGE_SIZE as if it were complete - the exact bug this
  // pagination exists to prevent, just at a higher threshold - so this
  // throws instead of ever letting a report be generated from a partial
  // dataset the caller can't tell is partial.
  throw new Error(
    `O relatório excedeu o limite técnico de segurança de ${MAX_PAGES * PAGE_SIZE} registros e não pôde ser gerado com segurança. Reduza o período selecionado e tente novamente.`,
  );
}

const EVENT_SELECT = "id, artist, city, created_at, created_by, date, empresa_id, id, logistics_departure, material_list, name, num_days, observations, show_time, status, updated_at, venue";

async function fetchEventsForExport(empresaId: string, filters: ExportFilters): Promise<EventRow[]> {
  if (filters.mode === "evento") {
    let query = supabase
      .from("events")
      .select(EVENT_SELECT)
      .eq("empresa_id", empresaId)
      .order("date", { ascending: false });
    if (filters.eventId) query = query.eq("id", filters.eventId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as EventRow[];
  }

  // period/mensal: the date range the user chose is applied here, in the
  // query itself, before any pagination - never fetched broadly and
  // filtered afterward in JS.
  const { start, end } = getReportDateRange(filters);
  return fetchAllPages<EventRow>((from, to) => {
    let query = supabase
      .from("events")
      .select(EVENT_SELECT)
      .eq("empresa_id", empresaId)
      .order("date", { ascending: false })
      .order("id", { ascending: true }) // stable tiebreaker: same-date rows would otherwise have no guaranteed relative order across separate page requests
      .range(from, to);
    if (start) query = query.gte("date", start);
    if (end) query = query.lte("date", end);
    return query;
  });
}

/** Genuinely all of the company's financials, every period - used only by
 * the dashboard's monthly trend section, which needs the full history
 * regardless of the report's selected period. Still paginated so a company
 * with more than 1000 financial records never gets a silently-truncated
 * trend. */
async function fetchAllFinancialsWithEvents(empresaId: string): Promise<FinancialRow[]> {
  return fetchAllPages<FinancialRow>((from, to) =>
    supabase
      .from("financials")
      .select("*, events!inner(name, artist, date, venue, city, status)")
      .eq("empresa_id", empresaId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

// financials has no date column of its own - "period" here has always meant
// "the linked event's date" (events!inner already required for that join).
// Filtering events.date directly in the query (PostgREST's embedded-resource
// filter, valid because of the !inner hint) avoids a second round trip to
// fetch events first just to get an id list, and keeps evento-mode as the
// simple direct match it always was.
async function fetchFinancialsForExport(empresaId: string, filters: ExportFilters): Promise<FinancialRow[]> {
  if (filters.mode === "evento") {
    if (!filters.eventId) return [];
    return fetchAllPages<FinancialRow>((from, to) =>
      supabase
        .from("financials")
        .select("*, events!inner(name, artist, date, venue, city, status)")
        .eq("empresa_id", empresaId)
        .eq("event_id", filters.eventId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  }

  const { start, end } = getReportDateRange(filters);
  return fetchAllPages<FinancialRow>((from, to) => {
    let query = supabase
      .from("financials")
      .select("*, events!inner(name, artist, date, venue, city, status)")
      .eq("empresa_id", empresaId)
      .order("id", { ascending: true })
      .range(from, to);
    if (start) query = query.gte("events.date", start);
    if (end) query = query.lte("events.date", end);
    return query;
  });
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
// set to filter/aggregate themselves. Unlike the events/financials fetches
// above, this one was never capped at a single page (no ".limit()" was ever
// applied to it), so it doesn't exhibit P1-12's silent-truncation bug -
// still less efficient than a server-side date filter would be, but out of
// scope for this fix (see fetchAllMaintenanceExpenses below for the same
// reasoning).
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

  // Same reasoning as fetchFinancialsForExport: event_funcionarios has no
  // date of its own, so the period is applied to the joined event's date
  // directly in the query (events!inner + embedded-resource filter),
  // instead of fetching every assignment for the whole company and
  // filtering afterward in JS.
  const { start, end } = getReportDateRange(filters);
  const assignments = await fetchAllPages<{ funcionario_id: string }>((from, to) => {
    let query = supabase
      .from("event_funcionarios")
      .select("funcionario_id, events!inner(date)")
      .eq("empresa_id", empresaId)
      .order("id", { ascending: true })
      .range(from, to);
    if (start) query = query.gte("events.date", start);
    if (end) query = query.lte("events.date", end);
    return query;
  });

  const eventCountByFuncionario = new Map<string, number>();
  for (const row of assignments) {
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

  // Already scoped to this period's own event ids (fetchEventsForExport is
  // the one place the date range gets applied) - paginated too, in case one
  // period covers more assignments/checklist items than a single page.
  const assignments = await fetchAllPages<{ event_id: string }>((from, to) =>
    supabase
      .from("event_funcionarios")
      .select("event_id")
      .eq("empresa_id", empresaId)
      .in("event_id", eventIds)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const checklist = await fetchAllPages<{ event_id: string; concluido: boolean }>((from, to) =>
    supabase
      .from("event_checklist_items")
      .select("event_id, concluido")
      .eq("empresa_id", empresaId)
      .in("event_id", eventIds)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const teamCountByEvent = new Map<string, number>();
  for (const row of assignments) {
    teamCountByEvent.set(row.event_id, (teamCountByEvent.get(row.event_id) ?? 0) + 1);
  }

  const checklistByEvent = new Map<string, { total: number; done: number }>();
  for (const item of checklist) {
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

const printMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function printDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

async function sendA4Report({
  empresaId,
  companyName,
  title,
  subtitle,
  metrics,
  sections,
}: {
  empresaId: string;
  companyName: string;
  title: string;
  subtitle?: string;
  metrics?: A4Metric[];
  sections: A4TableSection[];
}) {
  const { printHtmlDocument } = await import("@/lib/printer-service");
  await printHtmlDocument({
    companyId: empresaId,
    purpose: "documento",
    documentName: title,
    widthMm: 210,
    heightMm: 297,
    html: buildA4DocumentHtml({ companyName, title, subtitle, metrics, sections }),
  });
}

/** A4 counterpart to executeReportExport. It reuses the same tenant-scoped
 * fetchers and filters but generates semantic HTML for the canonical print
 * transport instead of saving a PDF/PNG file. */
export async function executeReportPrint({
  empresaId,
  companyName,
  reportType,
  filters,
  includeRentals,
}: PrintExecutionParams): Promise<void> {
  const validationError = validateReportFilters(filters);
  if (validationError) throw new Error(validationError);
  const range = getReportDateRange(filters);

  if (reportType === "evento") {
    const { event, eventDays, teamMembers } = await fetchEventReportData(empresaId, filters.eventId!);
    await sendA4Report({
      empresaId,
      companyName,
      title: `Relatório do evento - ${event.name}`,
      subtitle: `${printDate(event.date)} · ${event.venue || "Local não informado"} · ${event.city || "Cidade não informada"}`,
      metrics: [
        { label: "Artista", value: event.artist || "—" },
        { label: "Status", value: event.status },
        { label: "Equipe", value: teamMembers.length },
      ],
      sections: [
        {
          title: "Programação",
          columns: ["Dia", "Data", "Artista", "Horário", "Observações"],
          rows: eventDays.map((day) => [day.day_number, printDate(day.date), day.artist, day.show_time, day.observations]),
        },
        {
          title: "Equipe",
          columns: ["Nome", "Função"],
          rows: teamMembers.map((member) => [member.nome, member.funcao]),
        },
      ],
    });
    return;
  }

  if (reportType === "equipe") {
    const rows = await fetchTeamReportRows(empresaId, filters);
    await sendA4Report({
      empresaId, companyName, title: REPORT_TITLES.equipe, subtitle: range.title,
      metrics: [{ label: "Profissionais", value: rows.length }],
      sections: [{
        columns: ["Nome", "Função", "Tipo", "Eventos", "Cachê", "Alimentação"],
        rows: rows.map((row) => [row.nome, row.funcao, row.tipo, row.eventos, printMoney.format(row.cacheAcumulado), printMoney.format(row.alimentacaoAcumulada)]),
      }],
    });
    return;
  }

  if (reportType === "operacional") {
    const rows = await fetchOperationalReportRows(empresaId, filters);
    await sendA4Report({
      empresaId, companyName, title: REPORT_TITLES.operacional, subtitle: range.title,
      metrics: [{ label: "Eventos", value: rows.length }],
      sections: [{
        columns: ["Evento", "Data", "Local", "Status", "Equipe", "Checklist"],
        rows: rows.map((row) => [row.name, printDate(row.date), `${row.venue || "—"} / ${row.city || "—"}`, row.status, row.teamCount, `${row.checklistDone}/${row.checklistTotal}`]),
      }],
    });
    return;
  }

  if (reportType === "financeiro") {
    const financials = await fetchFinancialsForExport(empresaId, filters);
    const rentals = includeRentals ? await fetchRentalsForFinancialReport(empresaId, filters) : null;
    const maintenance = includeRentals ? await fetchMaintenanceForFinancialReport(empresaId, filters) : null;
    if (!financials.length && !rentals?.entries.length && !maintenance?.entries.length) {
      throw new Error("Nenhum dado financeiro foi encontrado para os filtros selecionados.");
    }
    const eventExpenses = financials.reduce((sum, row) => sum + (row.cache ?? 0) + (row.food ?? 0) + (row.lodging ?? 0) + (row.transport ?? 0) + (row.other_costs ?? 0), 0);
    const sections: A4TableSection[] = [{
      title: "Eventos",
      columns: ["Evento", "Data", "Cachê", "Alimentação", "Hospedagem", "Transporte", "Outros"],
      rows: financials.map((row) => [row.events?.name, printDate(row.events?.date), printMoney.format(row.cache ?? 0), printMoney.format(row.food ?? 0), printMoney.format(row.lodging ?? 0), printMoney.format(row.transport ?? 0), printMoney.format(row.other_costs ?? 0)]),
    }];
    if (rentals) sections.push({
      title: "Locações",
      columns: ["Cliente", "Descrição", "Valor", "Recebido", "Status"],
      rows: rentals.entries.map((row) => [row.cliente_nome_fantasia || row.cliente_nome, row.descricao, printMoney.format(row.valor_original), printMoney.format(row.valor_recebido), row.status]),
    });
    if (maintenance) sections.push({
      title: "Manutenções",
      columns: ["Ordem", "Material", "Descrição", "Valor", "Conclusão"],
      rows: maintenance.entries.map((row) => [row.ordem_numero, row.material_nome, row.descricao, printMoney.format(row.valor_original), printDate(row.concluida_em)]),
    });
    await sendA4Report({
      empresaId, companyName, title: REPORT_TITLES.financeiro, subtitle: range.title,
      metrics: [
        { label: "Despesas de eventos", value: printMoney.format(eventExpenses) },
        { label: "A receber em locações", value: printMoney.format(rentals?.summary.valorAReceber ?? 0) },
        { label: "Manutenções", value: printMoney.format(maintenance?.valorTotal ?? 0) },
      ],
      sections,
    });
    return;
  }

  const events = await fetchEventsForExport(empresaId, filters);
  if (!events.length) throw new Error("Nenhum evento foi encontrado para os filtros selecionados.");
  const financials = reportType === "dashboard" ? await fetchFinancialsForExport(empresaId, filters) : [];
  const rentals = reportType === "dashboard" && includeRentals ? await getRentalsFinancialSummary(empresaId) : null;
  await sendA4Report({
    empresaId,
    companyName,
    title: REPORT_TITLES[reportType],
    subtitle: range.title,
    metrics: reportType === "dashboard" ? [
      { label: "Eventos", value: events.length },
      { label: "Registros financeiros", value: financials.length },
      { label: "Locações a receber", value: printMoney.format(rentals?.valorAReceber ?? 0) },
    ] : [{ label: "Eventos", value: events.length }],
    sections: [{
      columns: ["Evento", "Artista", "Data", "Local", "Cidade", "Status"],
      rows: events.map((event) => [event.name, event.artist, printDate(event.date), event.venue, event.city, event.status]),
    }],
  });
}
