import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { PdfBranding, addBrandingHeader } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, SmartPDFNameOptions } from "./pdf-save";
import type { ExportFormat } from "./pdf-export";

const fmtBRL = (n: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export async function exportMasterFinanceiroPDF(
  pagamentos: any[],
  empresas: any[],
  periodTitle: string,
  branding?: PdfBranding,
  fmt: ExportFormat = "pdf"
) {
  const doc = new jsPDF("landscape");
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Relatório Financeiro Master", 14, headerY);
  doc.setFontSize(12);
  doc.text(`Período: ${periodTitle}`, 14, headerY + 8);
  doc.setFontSize(10);
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, headerY + 16);

  const totalRecebido = pagamentos
    .filter((p) => p.status === "pago")
    .reduce((a, p) => a + Number(p.valor || 0), 0);
  const totalPendente = pagamentos
    .filter((p) => p.status === "pendente")
    .reduce((a, p) => a + Number(p.valor || 0), 0);

  doc.setFontSize(11);
  doc.text(`Total Recebido: ${fmtBRL(totalRecebido)}    |    Pendente: ${fmtBRL(totalPendente)}    |    Pagamentos: ${pagamentos.length}`, 14, headerY + 26);

  autoTable(doc, {
    startY: headerY + 32,
    head: [["Empresa", "Valor", "Método", "Status", "Data", "Descrição"]],
    body: pagamentos.map((p) => [
      p.empresas?.nome_empresa || "—",
      fmtBRL(Number(p.valor || 0)),
      (p.metodo || "—").charAt(0).toUpperCase() + (p.metodo || "—").slice(1),
      p.status.charAt(0).toUpperCase() + p.status.slice(1),
      format(new Date(p.created_at), "dd/MM/yyyy"),
      p.descricao || "—",
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  let startY = (doc as any).lastAutoTable?.finalY + 12 || 120;
  
  if (startY > 170) {
    doc.addPage();
    startY = 20;
  }

  doc.setFontSize(14);
  doc.text("Resumo por Empresa", 14, startY);
  startY += 6;

  const empresaRows = empresas
    .map((e) => {
      const pago = pagamentos
        .filter((p) => p.empresa_id === e.id && p.status === "pago")
        .reduce((a: number, p: any) => a + Number(p.valor || 0), 0);
      const pendente = pagamentos
        .filter((p) => p.empresa_id === e.id && p.status === "pendente")
        .reduce((a: number, p: any) => a + Number(p.valor || 0), 0);
      if (pago === 0 && pendente === 0) return null;
      return [e.nome_empresa, e.plano || "—", fmtBRL(pago), fmtBRL(pendente), fmtBRL(pago + pendente)];
    })
    .filter(Boolean) as string[][];

  if (empresaRows.length > 0) {
    empresaRows.push(["TOTAL", "", fmtBRL(totalRecebido), fmtBRL(totalPendente), fmtBRL(totalRecebido + totalPendente)]);

    autoTable(doc, {
      startY,
      head: [["Empresa", "Plano", "Recebido", "Pendente", "Total"]],
      body: empresaRows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
      didParseCell: (data: any) => {
        if (data.row.index === empresaRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
  }

  const nameOpts: SmartPDFNameOptions = { tipo: "financeiro-master", evento: periodTitle };
  if (fmt === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}
