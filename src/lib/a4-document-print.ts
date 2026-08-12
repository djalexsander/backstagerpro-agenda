export interface A4Metric {
  label: string;
  value: string | number;
}

export interface A4TableSection {
  title?: string;
  columns: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "—").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

/** Shared A4 document shell. Callers provide semantic data, never a screen
 * snapshot, while the canonical printer service owns delivery/pagination. */
export function buildA4DocumentHtml({
  companyName,
  title,
  subtitle,
  metrics = [],
  sections = [],
  notes = [],
}: {
  companyName: string;
  title: string;
  subtitle?: string;
  metrics?: A4Metric[];
  sections?: A4TableSection[];
  notes?: string[];
}): string {
  const metricsHtml = metrics.length
    ? `<div class="metrics">${metrics.map((metric) => `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join("")}</div>`
    : "";
  const sectionsHtml = sections.map((section) => `
    <section>
      ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
      <table>
        <thead><tr>${section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
        <tbody>${section.rows.length
          ? section.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
          : `<tr><td colspan="${section.columns.length}" class="empty">Nenhum registro encontrado.</td></tr>`}
        </tbody>
      </table>
    </section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { width: 210mm; font-family: Arial, sans-serif; font-size: 10pt; }
    .print-document { width: 100%; padding: 12mm; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 10pt; }
    header { border-bottom: 1px solid #222; padding-bottom: 4mm; margin-bottom: 5mm; }
    header .company { font-size: 10pt; font-weight: 700; }
    h1 { margin: 1.5mm 0 0; font-size: 18pt; }
    .meta { margin-top: 1.5mm; color: #555; font-size: 8.5pt; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 5mm; }
    .metrics div { border: 1px solid #ccc; border-radius: 2mm; padding: 3mm; }
    .metrics span { display: block; color: #666; font-size: 8pt; }
    .metrics strong { display: block; margin-top: 1mm; font-size: 12pt; }
    section { margin-top: 5mm; }
    h2 { margin: 0 0 2mm; font-size: 12pt; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border-bottom: 1px solid #ddd; padding: 2mm 1.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f1f1f1; font-size: 8pt; }
    td { font-size: 8.5pt; }
    .empty { text-align: center; color: #666; padding: 8mm; }
    .notes { margin-top: 6mm; font-size: 8.5pt; color: #444; }
    @media screen { body { margin: 10px auto; box-shadow: 0 1px 8px #999; } }
    @media print { body { width: auto; } .print-document { padding: 0; } }
  </style></head><body><main class="print-document">
    <header>
      <div class="company">${escapeHtml(companyName || "Backstage Pro")}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${subtitle ? `${escapeHtml(subtitle)} · ` : ""}Emitido em ${escapeHtml(new Date().toLocaleString("pt-BR"))}</div>
    </header>
    ${metricsHtml}${sectionsHtml}
    ${notes.length ? `<div class="notes">${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div>` : ""}
  </main></body></html>`;
}
