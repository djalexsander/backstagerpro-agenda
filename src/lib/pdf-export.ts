import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData } from "jspdf-autotable";
import { format as formatDate, parseISO } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { addBrandingHeader, type PdfBranding } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, type SmartPDFNameOptions } from "./pdf-save";

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

function parseExtraCosts(raw: unknown): ExtraCost[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    return [{ name: asString(record.name), value: asNumber(record.value) }];
  });
}

function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}

function parseEmployeeExpenses(raw: unknown): EmployeeExpense[] {
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

function sumEmployeeExpenses(emps: EmployeeExpense[]): number {
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

function getCachePago(financial: FinancialExportRow): number {
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

function getCachePendente(financial: FinancialExportRow): number {
  return (financial.cache || 0) - getCachePago(financial);
}

const fmtBRL = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

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
      e.artist,
      e.city,
      e.venue,
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
    ["Cidade", event.city],
    ["Local", event.venue],
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

  const nameOpts: SmartPDFNameOptions = { tipo: "evento", evento: event.name, cidade: event.city, data: event.date };
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

export async function exportFinancialTotalPDF(financials: FinancialExportRow[], periodTitle?: string, branding?: PdfBranding, fmt: ExportFormat = "pdf", nameOverride?: SmartPDFNameOptions) {
  const doc = new jsPDF("landscape");
  const b = branding || {};
  const subtitle = periodTitle ? `Período: ${periodTitle}` : "Consolidado";
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text(`Relatório Financeiro — ${subtitle}`, 14, headerY);
  doc.setFontSize(10);
  doc.text(`Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

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
    startY: headerY + 14,
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

  const nameOpts2: SmartPDFNameOptions = nameOverride ?? { tipo: "financeiro-consolidado" };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts2);
  } else {
    await smartSavePDF(doc, nameOpts2);
  }
}
