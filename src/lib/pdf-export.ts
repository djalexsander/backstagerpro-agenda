import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type Event = Tables<"events">;

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

function parseExtraCosts(raw: any): ExtraCost[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function sumExtraCosts(extras: ExtraCost[]): number {
  return extras.reduce((s, e) => s + (e.value || 0), 0);
}

function parseEmployeeExpenses(raw: any): EmployeeExpense[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length > 0 && 'nome' in raw[0] && !('employeeId' in raw[0])) {
      return raw.map((f: any) => ({
        employeeId: '', name: f.nome, funcao: '', cache: f.valor || 0, food: 0,
      }));
    }
    return raw;
  }
  try { return JSON.parse(raw); } catch { return []; }
}

function sumEmployeeExpenses(emps: EmployeeExpense[]): number {
  return emps.reduce((s, e) => s + (e.cache || 0) + (e.food || 0), 0);
}

function getCachePago(f: any): number {
  const detail = f.cache_detail as CacheDetail | null;
  if (!detail) return f.cache || 0;
  let paid = 0;
  if (detail.entrada > 0 && detail.entradaPaga) paid += detail.entrada;
  if (detail.parcelado) {
    paid += (detail.parcelas || []).filter((p: CacheParcela) => p.pago).reduce((s: number, p: CacheParcela) => s + p.valor, 0);
  } else {
    if (detail.recebimentoPago) paid += (detail.valorTotal - (detail.entrada || 0));
  }
  return paid;
}

function getCachePendente(f: any): number {
  return (f.cache || 0) - getCachePago(f);
}

const fmtBRL = (n: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

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

export function exportEventPDF(event: Event, eventDays?: any[]) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(event.name, 14, 22);
  doc.setFontSize(10);
  doc.text(`Backstage Pro — Detalhes do Evento`, 14, 30);

  const rows = [
    ["Status", event.status.charAt(0).toUpperCase() + event.status.slice(1)],
    ["Cidade", event.city],
    ["Local", event.venue],
    ["Dias", String(event.num_days || 1)],
    ["Saída Logística", event.logistics_departure ? format(new Date(event.logistics_departure.replace(' ', 'T').replace(/([+-]\d{2}:\d{2}|Z)$/, '')), "dd/MM/yyyy HH:mm") : "—"],
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

  if (eventDays && eventDays.length > 0) {
    let startY = (doc as any).lastAutoTable?.finalY + 10 || 100;
    doc.setFontSize(14);
    doc.text("Dias do Evento", 14, startY);
    startY += 6;

    autoTable(doc, {
      startY,
      head: [["Dia", "Data", "Artista", "Horário", "Obs. Técnicas"]],
      body: eventDays.map((day) => [
        `Dia ${day.day_number}`,
        day.date ? format(parseISO(day.date), "dd/MM/yyyy") : "—",
        day.artist || "—",
        day.show_time ? (day.show_time as string).slice(0, 5) : "—",
        day.observations || "—",
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 29, 72] },
    });
  }

  doc.save(`evento-${event.name.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

export function exportFinancialPDF(financial: any) {
  const doc = new jsPDF();
  const eventName = financial.events?.name || "Evento";

  doc.setFontSize(18);
  doc.text(`Relatório Financeiro`, 14, 22);
  doc.setFontSize(12);
  doc.text(eventName, 14, 30);
  doc.setFontSize(10);
  doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);

  const extras = parseExtraCosts(financial.extra_costs);
  const extrasTotal = sumExtraCosts(extras);
  const employees = parseEmployeeExpenses(financial.funcionarios_cache);
  const employeesTotal = sumEmployeeExpenses(employees);
  const cachePago = getCachePago(financial);
  const cachePendente = getCachePendente(financial);
  const costs = (financial.transport || 0) + (financial.food || 0) + (financial.lodging || 0) + employeesTotal + extrasTotal;
  const profit = cachePago - costs;

  // === RECEITAS (Cachê) ===
  const rows: string[][] = [];
  rows.push(["RECEITAS", ""]);
  rows.push(["Cachê Total", fmtBRL(financial.cache)]);
  
  const detail = financial.cache_detail as CacheDetail | null;
  if (detail) {
    if (detail.entrada > 0) {
      rows.push(["  Entrada", `${fmtBRL(detail.entrada)} — ${detail.entradaPaga ? "Pago" : "Pendente"}`]);
    }
    if (detail.parcelado && detail.parcelas?.length > 0) {
      detail.parcelas.forEach((p) => {
        const venc = p.vencimento ? format(new Date(p.vencimento), "dd/MM/yyyy") : "—";
        rows.push([`  Parcela ${p.numero}`, `${fmtBRL(p.valor)} — Venc: ${venc} — ${p.pago ? "Pago" : "Pendente"}`]);
      });
    } else {
      const restante = detail.valorTotal - (detail.entrada || 0);
      if (restante > 0) {
        const tipo = detail.recebimentoEvento ? "No evento" : (detail.dataRecebimento ? format(new Date(detail.dataRecebimento), "dd/MM/yyyy") : "—");
        rows.push(["  Restante", `${fmtBRL(restante)} — ${tipo} — ${detail.recebimentoPago ? "Pago" : "Pendente"}`]);
      }
    }
    rows.push(["Cachê Recebido", fmtBRL(cachePago)]);
    rows.push(["Cachê Pendente", fmtBRL(cachePendente)]);
  }

  // === CUSTOS ===
  rows.push(["", ""]);
  rows.push(["CUSTOS", ""]);

  // Transporte detalhado
  rows.push(["Transporte", fmtBRL(financial.transport)]);

  // Alimentação
  rows.push(["Alimentação", fmtBRL(financial.food)]);

  // Hospedagem
  rows.push(["Hospedagem", fmtBRL(financial.lodging)]);

  // Funcionários detalhado
  if (employees.length > 0) {
    rows.push(["Equipe Técnica", fmtBRL(employeesTotal)]);
    employees.forEach((emp) => {
      const parts = [];
      if (emp.cache > 0) parts.push(`Cachê: ${fmtBRL(emp.cache)}`);
      if (emp.food > 0) parts.push(`Alim: ${fmtBRL(emp.food)}`);
      rows.push([`  ${emp.name}${emp.funcao ? ` (${emp.funcao})` : ""}`, parts.join(" | ") || "—"]);
    });
  } else {
    rows.push(["Equipe Técnica", fmtBRL(financial.other_costs)]);
  }

  // Extras
  if (extras.length > 0) {
    extras.forEach((e) => {
      rows.push([`  ${e.name}`, fmtBRL(e.value)]);
    });
  }

  // Totais
  rows.push(["", ""]);
  rows.push(["Total Custos", fmtBRL(costs)]);
  rows.push(["Resultado (Lucro/Prejuízo)", fmtBRL(profit)]);

  autoTable(doc, {
    startY: 44,
    body: rows,
    theme: "grid",
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 80 } },
    styles: { fontSize: 10 },
    didParseCell: (data: any) => {
      const val = data.row.raw?.[0] || "";
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
    startY: 36,
    head: [["Evento", "Cachê Total", "Recebido", "Pendente", "Transporte", "Alimentação", "Hospedagem", "Equipe", "Extras", "Total Custos", "Resultado"]],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [225, 29, 72] },
    didParseCell: (data: any) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save("financeiro-consolidado.pdf");
}
