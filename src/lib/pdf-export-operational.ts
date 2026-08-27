import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate, parseISO } from "date-fns";
import { addBrandingHeader, type PdfBranding } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, type SmartPDFNameOptions } from "./pdf-save";
import type { ExportFormat } from "./pdf-export";

const STATUS_LABELS: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  cancelado: "Cancelado",
  em_negociacao: "Em Negociação",
  finalizado: "Finalizado",
};

export interface OperationalEventRow {
  id: string;
  name: string;
  date: string;
  status: string;
  city: string | null;
  venue: string | null;
  teamCount: number;
  checklistTotal: number;
  checklistDone: number;
}

export interface OperationalReportData {
  events: OperationalEventRow[];
}

// Mirrors the aggregates already shown on-screen in PainelOperacional.tsx
// (eventos ativos / pendências / escalações / checklist geral) over the same
// event set the caller fetched, so the PDF numbers match that screen exactly.
export async function exportOperationalReportPDF(
  data: OperationalReportData,
  periodTitle: string,
  branding?: PdfBranding,
  fmt: ExportFormat = "pdf",
  nameOverride?: SmartPDFNameOptions,
) {
  const { events } = data;
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Relatório Operacional", 14, headerY);
  doc.setFontSize(10);
  doc.text(`Período: ${periodTitle} — Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

  const pendencias = events.filter((e) => e.status === "pendente" || e.status === "em_negociacao").length;
  const escalacoes = events.reduce((s, e) => s + e.teamCount, 0);
  const checklistTotal = events.reduce((s, e) => s + e.checklistTotal, 0);
  const checklistDone = events.reduce((s, e) => s + e.checklistDone, 0);
  const checklistPct = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;

  autoTable(doc, {
    startY: headerY + 16,
    head: [["Eventos", "Pendências", "Escalações", "Checklist geral"]],
    body: [[String(events.length), String(pendencias), String(escalacoes), `${checklistPct}%`]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  const summaryFinalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
  const tableY = summaryFinalY ? summaryFinalY + 12 : headerY + 30;

  doc.setFontSize(12);
  doc.text("Eventos no período", 14, tableY);

  autoTable(doc, {
    startY: tableY + 4,
    head: [["Evento", "Data", "Status", "Local", "Equipe", "Checklist"]],
    body: events.map((e) => [
      e.name,
      e.date ? formatDate(parseISO(e.date), "dd/MM/yyyy") : "—",
      STATUS_LABELS[e.status] || e.status,
      [e.city, e.venue].filter(Boolean).join(" – ") || "A definir",
      String(e.teamCount),
      e.checklistTotal > 0 ? `${Math.round((e.checklistDone / e.checklistTotal) * 100)}% (${e.checklistDone}/${e.checklistTotal})` : "—",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  const nameOpts: SmartPDFNameOptions = nameOverride ?? { tipo: "operacional" };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}
