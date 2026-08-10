import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate, startOfMonth, endOfMonth, subMonths, startOfToday } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import { addBrandingHeader, type PdfBranding } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, type SmartPDFNameOptions } from "./pdf-save";
import type { ExportFormat, FinancialExportRow } from "./pdf-export";
import {
  fmtBRL,
  getCachePago,
  parseEmployeeExpenses,
  parseExtraCosts,
  sumEmployeeExpenses,
  sumExtraCosts,
} from "./pdf-export";
import type { RentalsFinancialSummary } from "./financial-ledger-types";

type EventRow = Tables<"events">;

type AutoTableDocument = jsPDF & {
  lastAutoTable?: { finalY: number };
};

// Same abbreviated labels as the Dashboard screen's own MONTH_NAMES
// (src/pages/Dashboard.tsx) so the trend table reads identically to the chart.
const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function eventCosts(f: FinancialExportRow): number {
  const emps = sumEmployeeExpenses(parseEmployeeExpenses(f.funcionarios_cache));
  const extras = sumExtraCosts(parseExtraCosts(f.extra_costs));
  return (f.transport || 0) + (f.lodging || 0) + emps + extras;
}

// Mirrors Dashboard.tsx's own monthlyData useMemo: a fixed trailing 6-month
// window ending today, over ALL financials regardless of the report's period
// filter - the live screen has no period selector for this chart, so
// reproducing it faithfully means ignoring the filter here too.
function buildMonthlyTrend(allFinancials: FinancialExportRow[]) {
  const today = startOfToday();
  const months: { mes: string; receita: number; despesas: number; lucro: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const monthDate = subMonths(today, i);
    const mStart = startOfMonth(monthDate);
    const mEnd = endOfMonth(monthDate);

    let receita = 0;
    let despesas = 0;
    for (const f of allFinancials) {
      const eventDate = f.events?.date;
      if (!eventDate) continue;
      const d = new Date(`${eventDate}T00:00:00`);
      if (d >= mStart && d <= mEnd) {
        receita += getCachePago(f);
        despesas += eventCosts(f);
      }
    }
    months.push({ mes: MONTH_NAMES[monthDate.getMonth()] ?? "", receita, despesas, lucro: receita - despesas });
  }
  return months;
}

export interface DashboardReportData {
  events: EventRow[];
  financials: FinancialExportRow[];
  allFinancials: FinancialExportRow[];
  rentals?: RentalsFinancialSummary;
}

export async function exportDashboardSummaryPDF(
  data: DashboardReportData,
  periodTitle: string,
  branding?: PdfBranding,
  fmt: ExportFormat = "pdf",
  nameOverride?: SmartPDFNameOptions,
) {
  const { events, financials, allFinancials, rentals } = data;
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Relatório do Dashboard", 14, headerY);
  doc.setFontSize(10);
  doc.text(`Período: ${periodTitle} — Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

  const confirmados = events.filter((e) => e.status === "confirmado").length;
  const pendentes = events.filter((e) => e.status === "pendente").length;
  const cancelados = events.filter((e) => e.status === "cancelado").length;

  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const recebido = financials.reduce((s, f) => s + getCachePago(f), 0);
  const pendenteFin = totalCache - recebido;
  const despesas = financials.reduce((s, f) => s + eventCosts(f), 0);
  const lucro = recebido - despesas;

  let y = headerY + 20;
  doc.setFontSize(12);
  doc.text("Eventos no período", 14, y);
  autoTable(doc, {
    startY: y + 4,
    head: [["Total", "Confirmados", "Pendentes", "Cancelados"]],
    body: [[String(events.length), String(confirmados), String(pendentes), String(cancelados)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  y = ((doc as AutoTableDocument).lastAutoTable?.finalY ?? y + 10) + 10;
  doc.setFontSize(12);
  doc.text("Financeiro no período", 14, y);
  autoTable(doc, {
    startY: y + 4,
    head: [["Recebido", "Pendente", "Despesas", "Lucro líquido"]],
    body: [[fmtBRL(recebido), fmtBRL(pendenteFin), fmtBRL(despesas), fmtBRL(lucro)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  y = ((doc as AutoTableDocument).lastAutoTable?.finalY ?? y + 10) + 10;

  if (rentals) {
    doc.setFontSize(12);
    doc.text("Locações (posição atual)", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Contratado", "Recebido", "A receber", "Vencido", "Pendente de regularização"]],
      body: [[
        fmtBRL(rentals.valorContratado),
        fmtBRL(rentals.valorRecebido),
        fmtBRL(rentals.valorAReceber),
        fmtBRL(rentals.valorVencido),
        fmtBRL(rentals.valorPendenteRegularizacao),
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
    });
    y = ((doc as AutoTableDocument).lastAutoTable?.finalY ?? y + 10) + 10;
  }

  if (y > 240) {
    doc.addPage();
    y = 20;
  }

  doc.setFontSize(12);
  doc.text("Tendência mensal (últimos 6 meses)", 14, y);
  const monthly = buildMonthlyTrend(allFinancials);
  autoTable(doc, {
    startY: y + 4,
    head: [["Mês", "Receita", "Despesas", "Lucro"]],
    body: monthly.map((m) => [m.mes, fmtBRL(m.receita), fmtBRL(m.despesas), fmtBRL(m.lucro)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  const nameOpts: SmartPDFNameOptions = nameOverride ?? { tipo: "dashboard" };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}
