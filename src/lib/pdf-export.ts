import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type Event = Tables<"events">;

export function exportAgendaPDF(events: Event[]) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text("Backstage Pro — Agenda", 14, 22);
  doc.setFontSize(10);
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 30);

  autoTable(doc, {
    startY: 36,
    head: [["Data", "Status", "Evento", "Artista", "Cidade", "Local"]],
    body: events.map((e) => [
      e.date ? format(parseISO(e.date), "dd/MM/yyyy") : "—",
      e.status.charAt(0).toUpperCase() + e.status.slice(1),
      e.name,
      e.artist,
      e.city,
      e.venue,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [225, 29, 72] },
  });

  doc.save("agenda-backstage-pro.pdf");
}

export function exportEventPDF(event: Event) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(event.name, 14, 22);
  doc.setFontSize(10);
  doc.text(`Backstage Pro — Detalhes do Evento`, 14, 30);

  const rows = [
    ["Artista", event.artist],
    ["Data", event.date ? format(parseISO(event.date), "dd/MM/yyyy") : "—"],
    ["Status", event.status],
    ["Cidade", event.city],
    ["Local", event.venue],
    ["Horário", event.show_time?.slice(0, 5) || "—"],
    ["Saída Logística", event.logistics_departure ? format(parseISO(event.logistics_departure), "dd/MM/yyyy HH:mm") : "—"],
    ["Observações", event.observations || "—"],
    ["Material", event.material_list || "—"],
  ];

  autoTable(doc, {
    startY: 36,
    body: rows,
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    styles: { fontSize: 10 },
  });

  doc.save(`evento-${event.name.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

const fmtBRL = (n: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export function exportFinancialPDF(financial: any) {
  const doc = new jsPDF();
  const eventName = financial.events?.name || "Evento";

  doc.setFontSize(18);
  doc.text(`Relatório Financeiro`, 14, 22);
  doc.setFontSize(12);
  doc.text(eventName, 14, 30);
  doc.setFontSize(10);
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);

  const costs = (financial.transport || 0) + (financial.food || 0) + (financial.lodging || 0) + (financial.other_costs || 0);
  const profit = (financial.cache || 0) - costs;

  const rows = [
    ["Cachê", fmtBRL(financial.cache)],
    ["Transporte", fmtBRL(financial.transport)],
    ["Alimentação", fmtBRL(financial.food)],
    ["Hospedagem", fmtBRL(financial.lodging)],
    ["Outros Custos", fmtBRL(financial.other_costs)],
    ["Total Custos", fmtBRL(costs)],
    ["Resultado (Lucro/Prejuízo)", fmtBRL(profit)],
  ];

  autoTable(doc, {
    startY: 44,
    body: rows,
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 70 } },
    styles: { fontSize: 10 },
  });

  doc.save(`financeiro-${eventName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

export function exportFinancialTotalPDF(financials: any[], periodTitle?: string) {
  const doc = new jsPDF("landscape");
  const subtitle = periodTitle ? `Período: ${periodTitle}` : "Consolidado";

  doc.setFontSize(18);
  doc.text(`Relatório Financeiro — ${subtitle}`, 14, 22);
  doc.setFontSize(10);
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 30);

  const body = financials.map((f) => {
    const costs = (f.transport || 0) + (f.food || 0) + (f.lodging || 0) + (f.other_costs || 0);
    const profit = (f.cache || 0) - costs;
    return [
      f.events?.name || "—",
      fmtBRL(f.cache),
      fmtBRL(f.transport),
      fmtBRL(f.food),
      fmtBRL(f.lodging),
      fmtBRL(f.other_costs),
      fmtBRL(profit),
    ];
  });

  const totalCache = financials.reduce((s, f) => s + (f.cache || 0), 0);
  const totalTransport = financials.reduce((s, f) => s + (f.transport || 0), 0);
  const totalFood = financials.reduce((s, f) => s + (f.food || 0), 0);
  const totalLodging = financials.reduce((s, f) => s + (f.lodging || 0), 0);
  const totalOther = financials.reduce((s, f) => s + (f.other_costs || 0), 0);
  const totalProfit = totalCache - totalTransport - totalFood - totalLodging - totalOther;

  body.push([
    "TOTAL",
    fmtBRL(totalCache),
    fmtBRL(totalTransport),
    fmtBRL(totalFood),
    fmtBRL(totalLodging),
    fmtBRL(totalOther),
    fmtBRL(totalProfit),
  ]);

  autoTable(doc, {
    startY: 36,
    head: [["Evento", "Cachê", "Transporte", "Alimentação", "Hospedagem", "Outros", "Lucro/Prejuízo"]],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [225, 29, 72] },
    didParseCell: (data: any) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save("financeiro-consolidado.pdf");
}
