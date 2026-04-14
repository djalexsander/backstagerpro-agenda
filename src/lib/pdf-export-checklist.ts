import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate } from "date-fns";
import { PdfBranding, addBrandingHeader } from "./pdf-branding";
import { smartSavePDF, smartSavePNG, SmartPDFNameOptions } from "./pdf-save";
import type { ExportFormat } from "./pdf-export";
import type { ChecklistItem } from "@/hooks/useEventChecklist";
import { CHECKLIST_CATEGORIES } from "@/hooks/useEventChecklist";
import { buildExportFileName, type ExportFilters } from "@/lib/report-export-service";

interface ChecklistExportOptions {
  items: ChecklistItem[];
  eventName: string;
  format: ExportFormat;
  branding?: PdfBranding;
  filter?: {
    mode: "completo" | "por_categoria" | "pendentes" | "concluidos";
    categoria?: string;
  };
}

export async function exportChecklistPDF(opts: ChecklistExportOptions) {
  const { items, eventName, format, branding, filter } = opts;
  const doc = new jsPDF();
  const b = branding || {};
  const headerY = await addBrandingHeader(doc, b, "Backstage Pro");

  doc.setFontSize(14);
  doc.text("Checklist Técnico", 14, headerY);
  doc.setFontSize(12);
  doc.text(eventName, 14, headerY + 8);

  let subtitle = "";
  if (filter?.mode === "pendentes") subtitle = "Somente pendentes";
  else if (filter?.mode === "concluidos") subtitle = "Somente concluídos";
  else if (filter?.mode === "por_categoria") {
    const cat = CHECKLIST_CATEGORIES.find(c => c.value === filter.categoria);
    subtitle = `Categoria: ${cat?.label || filter.categoria}`;
  }

  doc.setFontSize(10);
  const line3 = subtitle
    ? `${subtitle} — Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`
    : `Gerado em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`;
  doc.text(line3, 14, headerY + 16);

  // Filter items
  let filtered = [...items];
  if (filter?.mode === "pendentes") filtered = filtered.filter(i => !i.concluido);
  else if (filter?.mode === "concluidos") filtered = filtered.filter(i => i.concluido);
  else if (filter?.mode === "por_categoria" && filter.categoria) filtered = filtered.filter(i => i.categoria === filter.categoria);

  // Progress stats
  const total = filtered.length;
  const done = filtered.filter(i => i.concluido).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  doc.text(`Progresso: ${done}/${total} (${pct}%)`, 14, headerY + 22);

  // Group by category
  const grouped = CHECKLIST_CATEGORIES
    .map(cat => ({
      label: cat.label,
      items: filtered.filter(i => i.categoria === cat.value),
    }))
    .filter(g => g.items.length > 0);

  let startY = headerY + 28;

  for (const group of grouped) {
    const body = group.items.map(item => [
      item.concluido ? "✓" : "○",
      item.descricao,
      item.observacao || "",
    ]);

    autoTable(doc, {
      startY,
      head: [[group.label, "Descrição", "Observação"]],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
      columnStyles: {
        0: { cellWidth: 15, halign: "center" },
        2: { cellWidth: 50, fontStyle: "italic" },
      },
    });

    startY = (doc as any).lastAutoTable?.finalY + 6 || startY + 20;
  }

  // Build smart file name
  const suffixMap: Record<string, string | undefined> = {
    completo: undefined,
    pendentes: "pendentes",
    concluidos: "concluidos",
    por_categoria: filter?.categoria ?? undefined,
  };
  const filterMode = filter?.mode ?? "completo";
  // Use "evento" mode with a dummy filter for naming purposes
  const dummyFilters: ExportFilters = { mode: "evento", eventId: "x" };
  const customName = buildExportFileName({
    reportType: "checklist",
    filters: dummyFilters,
    eventName,
    suffix: suffixMap[filterMode],
  });
  const nameOpts: SmartPDFNameOptions = { tipo: "", customName };
  if (format === "png") {
    await smartSavePNG(doc, nameOpts);
  } else {
    await smartSavePDF(doc, nameOpts);
  }
}
