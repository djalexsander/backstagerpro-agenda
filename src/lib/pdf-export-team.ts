import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData } from "jspdf-autotable";
import { format as formatDate } from "date-fns";
import { addBrandingHeader, type PdfBranding } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, type SmartPDFNameOptions } from "./pdf-save";
import { fmtBRL, type ExportFormat } from "./pdf-export";

export interface TeamReportRow {
  funcionarioId: string;
  nome: string;
  funcao: string;
  tipo: string;
  eventos: number;
  cacheAcumulado: number;
  alimentacaoAcumulada: number;
}

export async function exportTeamReportPDF(
  rows: TeamReportRow[],
  periodTitle: string,
  branding?: PdfBranding,
  fmt: ExportFormat = "pdf",
  nameOverride?: SmartPDFNameOptions,
) {
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Relatório de Equipe", 14, headerY);
  doc.setFontSize(10);
  doc.text(`Período: ${periodTitle} — Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 8);

  const sorted = [...rows].sort((a, b2) => b2.eventos - a.eventos || a.nome.localeCompare(b2.nome));

  const body = sorted.map((r) => [
    r.nome,
    r.funcao || "—",
    r.tipo === "freelancer" ? "Freelancer" : "Equipe",
    String(r.eventos),
    fmtBRL(r.cacheAcumulado),
    fmtBRL(r.alimentacaoAcumulada),
    fmtBRL(r.cacheAcumulado + r.alimentacaoAcumulada),
  ]);

  const totalEventos = rows.reduce((s, r) => s + r.eventos, 0);
  const totalCache = rows.reduce((s, r) => s + r.cacheAcumulado, 0);
  const totalAlimentacao = rows.reduce((s, r) => s + r.alimentacaoAcumulada, 0);
  body.push(["TOTAL", "", "", String(totalEventos), fmtBRL(totalCache), fmtBRL(totalAlimentacao), fmtBRL(totalCache + totalAlimentacao)]);

  autoTable(doc, {
    startY: headerY + 16,
    head: [["Nome", "Função", "Tipo", "Eventos", "Cachê acumulado", "Alimentação", "Total"]],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
    didParseCell: (data: CellHookData) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const nameOpts: SmartPDFNameOptions = nameOverride ?? { tipo: "equipe" };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}
