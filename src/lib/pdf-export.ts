import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData } from "jspdf-autotable";
import { format as formatDate, parseISO } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { addBrandingHeader, type PdfBranding } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, type SmartPDFNameOptions } from "./pdf-save";
import type { FinancialLedgerStatus, MaintenanceExpenseEntry, ReceivableEntry, RentalsFinancialSummary } from "./financial-ledger-types";

type Event = Tables<"events">;
type EventDay = Tables<"event_days">;
type FinancialEvent = Pick<Event, "name" | "artist" | "date"> &
  Partial<Pick<Event, "venue" | "city" | "status">>;
export type FinancialExportRow = Tables<"financials"> & {
  events?: FinancialEvent | null;
};

type ExtraCost = { name: string; value: number };
type CacheParcela = { numero: number; valor: number; vencimento: string; pago: boolean };
type CacheDetail = {
  valorTotal: number;
  entrada: number;
  entradaPaga: boolean;
  parcelado: boolean;
  parcelas: CacheParcela[];
  recebimentoEvento: boolean;
  dataRecebimento: string;
  recebimentoPago: boolean;
};
type EmployeeExpense = {
  employeeId: string;
  name: string;
  funcao: string;
  cache: number;
  food: number;
};

type AutoTableDocument = jsPDF & {
  lastAutoTable?: { finalY: number };
};

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseExtraCosts(raw: unknown): ExtraCost[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    return [{ name: asString(record.name), value: asNumber(record.value) }];
  });
}

export function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}

export function parseEmployeeExpenses(raw: unknown): EmployeeExpense[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];

    if ("nome" in record && !("employeeId" in record)) {
      return [{
        employeeId: "",
        name: asString(record.nome),
        funcao: "",
        cache: asNumber(record.valor),
        food: 0,
      }];
    }

    return [{
      employeeId: asString(record.employeeId),
      name: asString(record.name),
      funcao: asString(record.funcao),
      cache: asNumber(record.cache),
      food: asNumber(record.food),
    }];
  });
}

export function sumEmployeeExpenses(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.cache || 0) + (e.food || 0), 0);
}

function parseCacheDetail(raw: unknown): CacheDetail | null {
  const record = asRecord(parseJsonValue(raw));
  if (!record) return null;

  const parcelas = Array.isArray(record.parcelas)
    ? record.parcelas.flatMap((item) => {
        const parcela = asRecord(item);
        if (!parcela) return [];
        return [{
          numero: asNumber(parcela.numero),
          valor: asNumber(parcela.valor),
          vencimento: asString(parcela.vencimento),
          pago: parcela.pago === true,
        }];
      })
    : [];

  return {
    valorTotal: asNumber(record.valorTotal),
    entrada: asNumber(record.entrada),
    entradaPaga: record.entradaPaga === true,
    parcelado: record.parcelado === true,
    parcelas,
    recebimentoEvento: record.recebimentoEvento === true,
    dataRecebimento: asString(record.dataRecebimento),
    recebimentoPago: record.recebimentoPago === true,
  };
}

export function getCachePago(financial: FinancialExportRow): number {
  const detail = parseCacheDetail(financial.cache_detail);
  if (!detail) return financial.cache || 0;
  let paid = 0;
  if (detail.entrada > 0 && detail.entradaPaga) paid += detail.entrada;
  if (detail.parcelado) {
    paid += (detail.parcelas || []).filter((p: CacheParcela) => p.pago).reduce((s: number, p: CacheParcela) => s + p.valor, 0);
  } else {
    if (detail.recebimentoPago) paid += (detail.valorTotal - (detail.entrada || 0));
  }
  return paid;
}

export function getCachePendente(financial: FinancialExportRow): number {
  return (financial.cache || 0) - getCachePago(financial);
}

export const fmtBRL = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

// Same labels LocacoesReceivablesPanel's "Contas a receber" tab uses.
const RENTAL_STATUS_LABELS: Record<FinancialLedgerStatus, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  recebido: "Recebido",
  cancelado: "Cancelado",
  cancelado_pendente_regularizacao: "Cancelado · a regularizar",
  estornado: "Estornado",
};

export type ExportFormat = "pdf" | "png";

export async function exportAgendaPDF(events: Event[], branding?: PdfBranding, format: ExportFormat = "pdf", nameOverride?: SmartPDFNameOptions) {
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Agenda", 14, headerY);
  doc.setFontSize(10);
  doc.text(`Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

  autoTable(doc, {
    startY: headerY + 14,
    head: [["Data", "Status", "Evento", "Artista", "Cidade", "Local"]],
    body: events.map((e) => [
      e.date ? formatDate(parseISO(e.date), "dd/MM/yyyy") : "—",
      e.status.charAt(0).toUpperCase() + e.status.slice(1),
      e.name,
      e.artist || "A definir",
      e.city || "A definir",
      e.venue || "A definir",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  const nameOpts: SmartPDFNameOptions = nameOverride ?? { tipo: "agenda" };
  if (format === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}

export async function exportEventPDF(event: Event, eventDays?: EventDay[], branding?: PdfBranding, teamMembers?: { nome: string; funcao: string }[], fmt: ExportFormat = "pdf") {
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(16);
  doc.text(event.name, 14, headerY);
  doc.setFontSize(10);
  doc.text("Detalhes do Evento", 14, headerY + 8);

  const rows = [
    ["Status", event.status.charAt(0).toUpperCase() + event.status.slice(1)],
    ["Cidade", event.city || "A definir"],
    ["Local", event.venue || "A definir"],
    ["Dias", String(event.num_days || 1)],
    ["Saída Logística", event.logistics_departure ? formatDate(new Date(event.logistics_departure.replace(' ', 'T').replace(/([+-]\d{2}:\d{2}|Z)$/, '')), "dd/MM/yyyy HH:mm") : "—"],
    ["Observações", event.observations || "—"],
    ["Material", event.material_list || "—"],
  ];

  autoTable(doc, {
    startY: headerY + 14,
    body: rows,
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    styles: { fontSize: 10 },
  });

  const eventTableFinalY = (doc as AutoTableDocument).lastAutoTable?.finalY;
  let lastY = eventTableFinalY === undefined ? 100 : eventTableFinalY + 10;

  // Equipe Escalada
  if (teamMembers && teamMembers.length > 0) {
    doc.setFontSize(14);
    doc.text("Equipe Escalada", 14, lastY);
    lastY += 6;

    autoTable(doc, {
      startY: lastY,
      head: [["Nome", "Função"]],
      body: teamMembers.map((m) => [m.nome, m.funcao || "—"]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
    });

    const tableFinalY = (doc as AutoTableDocument).lastAutoTable?.finalY;
    lastY = tableFinalY ? tableFinalY + 10 : lastY + 20;
  }

  if (eventDays && eventDays.length > 0) {
    doc.setFontSize(14);
    doc.text("Dias do Evento", 14, lastY);
    lastY += 6;

    autoTable(doc, {
      startY: lastY,
      head: [["Dia", "Data", "Artista", "Horário", "Obs. Técnicas"]],
      body: eventDays.map((day) => [
        `Dia ${day.day_number}`,
        day.date ? formatDate(parseISO(day.date), "dd/MM/yyyy") : "—",
        day.artist || "—",
        day.show_time ? (day.show_time as string).slice(0, 5) : "—",
        day.observations || "—",
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
    });
  }

  const nameOpts: SmartPDFNameOptions = { tipo: "evento", evento: event.name, cidade: event.city || undefined, data: event.date };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}

export async function exportFinancialPDF(financial: FinancialExportRow, branding?: PdfBranding, fmt: ExportFormat = "pdf") {
  const doc = new jsPDF();
  const b = branding || {};
  const eventName = financial.events?.name || "Evento";
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Relatório Financeiro", 14, headerY);
  doc.setFontSize(12);
  doc.text(eventName, 14, headerY + 8);
  doc.setFontSize(10);
  doc.text(`Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 16);

  const extras = parseExtraCosts(financial.extra_costs);
  const extrasTotal = sumExtraCosts(extras);
  const employees = parseEmployeeExpenses(financial.funcionarios_cache);
  const employeesTotal = sumEmployeeExpenses(employees);
  const cachePago = getCachePago(financial);
  const cachePendente = getCachePendente(financial);
  const costs = (financial.transport || 0) + (financial.food || 0) + (financial.lodging || 0) + employeesTotal + extrasTotal;
  const profit = cachePago - costs;

  const rows: string[][] = [];
  rows.push(["RECEITAS", ""]);
  rows.push(["Cachê Total", fmtBRL(financial.cache)]);
  
  const detail = parseCacheDetail(financial.cache_detail);
  if (detail) {
    if (detail.entrada > 0) {
      rows.push(["  Entrada", `${fmtBRL(detail.entrada)} — ${detail.entradaPaga ? "Pago" : "Pendente"}`]);
    }
    if (detail.parcelado && detail.parcelas?.length > 0) {
      detail.parcelas.forEach((p) => {
        const venc = p.vencimento ? formatDate(new Date(p.vencimento), "dd/MM/yyyy") : "—";
        rows.push([`  Parcela ${p.numero}`, `${fmtBRL(p.valor)} — Venc: ${venc} — ${p.pago ? "Pago" : "Pendente"}`]);
      });
    } else {
      const restante = detail.valorTotal - (detail.entrada || 0);
      if (restante > 0) {
        const tipo = detail.recebimentoEvento ? "No evento" : (detail.dataRecebimento ? formatDate(new Date(detail.dataRecebimento), "dd/MM/yyyy") : "—");
        rows.push(["  Restante", `${fmtBRL(restante)} — ${tipo} — ${detail.recebimentoPago ? "Pago" : "Pendente"}`]);
      }
    }
    rows.push(["Cachê Recebido", fmtBRL(cachePago)]);
    rows.push(["Cachê Pendente", fmtBRL(cachePendente)]);
  }

  rows.push(["", ""]);
  rows.push(["CUSTOS", ""]);
  rows.push(["Transporte", fmtBRL(financial.transport)]);
  rows.push(["Alimentação", fmtBRL(financial.food)]);
  rows.push(["Hospedagem", fmtBRL(financial.lodging)]);

  if (employees.length > 0) {
    rows.push(["Equipe Técnica", fmtBRL(employeesTotal)]);
    employees.forEach((emp) => {
      const parts: string[] = [];
      if (emp.cache > 0) parts.push(`Cachê: ${fmtBRL(emp.cache)}`);
      if (emp.food > 0) parts.push(`Alim: ${fmtBRL(emp.food)}`);
      rows.push([`  ${emp.name}${emp.funcao ? ` (${emp.funcao})` : ""}`, parts.join(" | ") || "—"]);
    });
  } else {
    rows.push(["Equipe Técnica", fmtBRL(financial.other_costs)]);
  }

  if (extras.length > 0) {
    extras.forEach((e) => {
      rows.push([`  ${e.name}`, fmtBRL(e.value)]);
    });
  }

  rows.push(["", ""]);
  rows.push(["Total Custos", fmtBRL(costs)]);
  rows.push(["Resultado (Lucro/Prejuízo)", fmtBRL(profit)]);

  autoTable(doc, {
    startY: headerY + 22,
    body: rows,
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 80 } },
    styles: { fontSize: 10 },
    didParseCell: (data: CellHookData) => {
      const firstCell = Array.isArray(data.row.raw) ? data.row.raw[0] : undefined;
      const val = typeof firstCell === "string" ? firstCell : "";
      if (val === "RECEITAS" || val === "CUSTOS") {
        data.cell.styles.fillColor = [240, 240, 240];
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 11;
      }
      if (val === "Total Custos" || val === "Resultado (Lucro/Prejuízo)" || val === "Cachê Recebido" || val === "Cachê Pendente") {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const nameOpts: SmartPDFNameOptions = { tipo: "financeiro", evento: eventName };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}

export interface FinancialRentalsSection {
  summary: RentalsFinancialSummary;
  /** Already period-filtered by the caller - rendered as-is, no re-filtering here. */
  entries: ReceivableEntry[];
}

export interface FinancialMaintenanceSection {
  /** Sum of valor_original across `entries` - the same figure the on-screen
   * ManutencaoDespesasPanel shows, just scoped to this report's period. */
  valorTotal: number;
  /** Already period-filtered by the caller (by concluida_em) - rendered as-is. */
  entries: MaintenanceExpenseEntry[];
}

// Pulled out of exportFinancialTotalPDF so the arithmetic - and specifically
// that each source is added exactly once - can be unit tested without
// mocking jsPDF. Locações only ever contributes valor_recebido from
// financeiro_lancamentos rows where tipo='receita'; manutenções only ever
// contributes valorTotal from rows where tipo='despesa' (see
// listar_despesas_manutencao/20260808120000) - the same lançamento can never
// be both, so there is no double counting between the two.
export function computeConsolidatedFinancialResult(
  eventsTotalPago: number,
  eventsTotalCosts: number,
  rentals?: FinancialRentalsSection,
  maintenance?: FinancialMaintenanceSection,
): { receita: number; despesa: number; resultado: number } {
  const receita = eventsTotalPago + (rentals?.summary.valorRecebido ?? 0);
  const despesa = eventsTotalCosts + (maintenance?.valorTotal ?? 0);
  return { receita, despesa, resultado: receita - despesa };
}

export async function exportFinancialTotalPDF(financials: FinancialExportRow[], periodTitle?: string, branding?: PdfBranding, fmt: ExportFormat = "pdf", nameOverride?: SmartPDFNameOptions, rentals?: FinancialRentalsSection, maintenance?: FinancialMaintenanceSection) {
  const doc = new jsPDF("landscape");
  const b = branding || {};
  const subtitle = periodTitle ? `Período: ${periodTitle}` : "Consolidado";
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text(`Relatório Financeiro — ${subtitle}`, 14, headerY);
  doc.setFontSize(10);
  doc.text(`Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

  doc.setFontSize(12);
  doc.text("Eventos", 14, headerY + 14);

  let eventsSectionFinalY: number;
  // Hoisted so the consolidated result section at the end of the report can
  // read them - stay 0 when there are no event financials in the period.
  let eventsTotalPago = 0;
  let eventsTotalCosts = 0;

  if (financials.length === 0) {
    doc.setFontSize(10);
    doc.text("Nenhum movimento de eventos no período.", 14, headerY + 22);
    eventsSectionFinalY = headerY + 22;
  } else {
    const body = financials.map((f) => {
      const extras = parseExtraCosts(f.extra_costs);
      const extrasTotal = sumExtraCosts(extras);
      const emps = parseEmployeeExpenses(f.funcionarios_cache);
      const empsTotal = sumEmployeeExpenses(emps);
      const pago = getCachePago(f);
      const pendente = getCachePendente(f);
      const costs = (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + empsTotal + extrasTotal;
      const profit = pago - costs;
      return [
        f.events?.name || "—",
        fmtBRL(f.cache),
        fmtBRL(pago),
        fmtBRL(pendente),
        fmtBRL(f.transport),
        fmtBRL(f.food),
        fmtBRL(f.lodging),
        fmtBRL(empsTotal),
        fmtBRL(extrasTotal),
        fmtBRL(costs),
        fmtBRL(profit),
      ];
    });

    const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
    const totalPago = financials.reduce((s, f) => s + getCachePago(f), 0);
    const totalPendente = financials.reduce((s, f) => s + getCachePendente(f), 0);
    const totalTransport = financials.reduce((s, f) => s + (f.transport || 0), 0);
    const totalFood = financials.reduce((s, f) => s + (f.food || 0), 0);
    const totalLodging = financials.reduce((s, f) => s + (f.lodging || 0), 0);
    const totalEmps = financials.reduce((s, f) => s + sumEmployeeExpenses(parseEmployeeExpenses(f.funcionarios_cache)), 0);
    const totalExtras = financials.reduce((s, f) => s + sumExtraCosts(parseExtraCosts(f.extra_costs)), 0);
    const totalCosts = totalTransport + totalFood + totalLodging + totalEmps + totalExtras;
    const totalProfit = totalPago - totalCosts;
    eventsTotalPago = totalPago;
    eventsTotalCosts = totalCosts;

    body.push([
      "TOTAL",
      fmtBRL(totalCache),
      fmtBRL(totalPago),
      fmtBRL(totalPendente),
      fmtBRL(totalTransport),
      fmtBRL(totalFood),
      fmtBRL(totalLodging),
      fmtBRL(totalEmps),
      fmtBRL(totalExtras),
      fmtBRL(totalCosts),
      fmtBRL(totalProfit),
    ]);

    autoTable(doc, {
      startY: headerY + 20,
      head: [["Evento", "Cachê Total", "Recebido", "Pendente", "Transporte", "Alimentação", "Hospedagem", "Equipe", "Extras", "Total Custos", "Resultado"]],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [225, 29, 72] },
      didParseCell: (data: CellHookData) => {
        if (data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    eventsSectionFinalY = (doc as AutoTableDocument).lastAutoTable?.finalY ?? headerY + 20;
  }

  // Tracks where the next section should start, updated after each optional
  // block below (Locações, Manutenções) so the final Resultado Consolidado
  // section always lands right after whatever actually got rendered.
  let sectionEndY = eventsSectionFinalY;

  // Locações is a financial source separate from event financials (own RPCs,
  // own permission gate) - rendered as its own section using the exact
  // figures already shown on-screen in LocacoesReceivablesPanel, never
  // merged into the event totals above so the two origins stay traceable.
  if (rentals) {
    let rentalsY = eventsSectionFinalY + 14;

    if (rentalsY > 170) {
      doc.addPage();
      rentalsY = 20;
    }

    doc.setFontSize(14);
    doc.text("Locações", 14, rentalsY);
    rentalsY += 8;

    autoTable(doc, {
      startY: rentalsY,
      head: [["Contratado", "Recebido líquido", "A receber", "Vencido", "Pendente de regularização"]],
      body: [[
        fmtBRL(rentals.summary.valorContratado),
        fmtBRL(rentals.summary.valorRecebido),
        fmtBRL(rentals.summary.valorAReceber),
        fmtBRL(rentals.summary.valorVencido),
        fmtBRL(rentals.summary.valorPendenteRegularizacao),
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
    });

    const summaryFinalY = (doc as AutoTableDocument).lastAutoTable?.finalY ?? rentalsY + 10;
    const titlesY = summaryFinalY + 10;

    doc.setFontSize(12);
    doc.text("Títulos de locação no período", 14, titlesY);

    if (rentals.entries.length === 0) {
      doc.setFontSize(10);
      doc.text("Nenhuma movimentação de locação no período.", 14, titlesY + 8);
    } else {
      autoTable(doc, {
        startY: titlesY + 4,
        head: [["Cliente", "Descrição", "Valor", "Recebido", "A receber", "Vencimento", "Status"]],
        body: rentals.entries.map((entry) => [
          entry.cliente_nome_fantasia || entry.cliente_nome || "—",
          entry.descricao || "—",
          fmtBRL(entry.valor_original),
          fmtBRL(entry.valor_recebido),
          fmtBRL(entry.valor_original - entry.valor_recebido),
          entry.vencimento ? formatDate(parseISO(entry.vencimento), "dd/MM/yyyy") : "—",
          entry.vencido ? "Vencido" : RENTAL_STATUS_LABELS[entry.status],
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [225, 29, 72] },
      });
    }

    sectionEndY = rentals.entries.length === 0
      ? titlesY + 8
      : (doc as AutoTableDocument).lastAutoTable?.finalY ?? titlesY + 8;
  }

  // Manutenções: same idea as Locações above - own RPC (listar_despesas_manutencao,
  // 20260808120000_equipment_maintenance_financial_integration.sql), own
  // section, never merged into the events table. Every row here is a
  // financeiro_lancamentos entry with tipo='despesa' (an already-settled
  // internal cost), while Locações above only ever shows tipo='receita' rows -
  // the same lançamento can never appear in both sections.
  if (maintenance) {
    let maintenanceY = sectionEndY + 14;

    if (maintenanceY > 170) {
      doc.addPage();
      maintenanceY = 20;
    }

    doc.setFontSize(14);
    doc.text("Manutenções", 14, maintenanceY);
    maintenanceY += 8;

    if (maintenance.entries.length === 0) {
      doc.setFontSize(10);
      doc.text("Nenhuma manutenção concluída com custo no período.", 14, maintenanceY);
      sectionEndY = maintenanceY;
    } else {
      autoTable(doc, {
        startY: maintenanceY,
        head: [["Ordem", "Equipamento/Material", "Concluída em", "Custo"]],
        body: [
          ...maintenance.entries.map((entry) => [
            entry.ordem_numero,
            entry.material_nome,
            entry.concluida_em ? formatDate(parseISO(entry.concluida_em), "dd/MM/yyyy") : "—",
            fmtBRL(entry.valor_original),
          ]),
          ["Total de despesas com manutenção", "", "", fmtBRL(maintenance.valorTotal)],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [225, 29, 72] },
        didParseCell: (data: CellHookData) => {
          if (data.row.index === maintenance.entries.length) {
            data.cell.styles.fontStyle = "bold";
          }
        },
      });
      sectionEndY = (doc as AutoTableDocument).lastAutoTable?.finalY ?? maintenanceY + 10;
    }
  }

  // Resultado consolidado do período: sempre renderizado, mesmo sem Locações
  // ou Manutenções (nesse caso reflete só os eventos). Cada fonte entra uma
  // única vez - ver computeConsolidatedFinancialResult acima para a garantia
  // de que não há dupla contagem entre Locações (receita) e Manutenções (despesa).
  let resultY = sectionEndY + 14;
  if (resultY > 170) {
    doc.addPage();
    resultY = 20;
  }
  const { receita, despesa, resultado } = computeConsolidatedFinancialResult(
    eventsTotalPago, eventsTotalCosts, rentals, maintenance,
  );

  doc.setFontSize(14);
  doc.text("Resultado Financeiro Consolidado do Período", 14, resultY);
  resultY += 8;
  autoTable(doc, {
    startY: resultY,
    body: [
      ["Receita (cachê recebido + locações recebidas)", fmtBRL(receita)],
      ["Despesa (custos de eventos + manutenções)", fmtBRL(despesa)],
      ["Resultado do período", fmtBRL(resultado)],
    ],
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 110 } },
    styles: { fontSize: 10 },
    didParseCell: (data: CellHookData) => {
      if (data.row.index === 2) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const nameOpts2: SmartPDFNameOptions = nameOverride ?? { tipo: "financeiro-consolidado" };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts2);
  } else {
    await smartSavePDF(doc, nameOpts2);
  }
}
