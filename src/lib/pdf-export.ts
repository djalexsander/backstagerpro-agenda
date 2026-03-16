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
      format(parseISO(e.date), "dd/MM/yyyy"),
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
    ["Data", format(parseISO(event.date), "dd/MM/yyyy")],
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
