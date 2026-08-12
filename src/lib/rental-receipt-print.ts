import type { RentalFinancialSummary } from "./financial-ledger-types";
import { RENTAL_STATUS_LABELS } from "./material-rental-domain";
import type { RentalDetail } from "./material-rental-types";
import { printHtmlDocument } from "./printer-service";

export type RentalReceiptKind = "comprovante" | "retirada" | "devolucao";

const RECEIPT_TITLES: Record<RentalReceiptKind, string> = {
  comprovante: "Comprovante de locação",
  retirada: "Comprovante de retirada",
  devolucao: "Comprovante de devolução",
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]!,
  );
}

function formatReceiptDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const day = date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

/**
 * One parametrized generator for the three rental receipt buttons. The
 * title and highlighted quantities vary by kind, while the same compact
 * thermal layout feeds both the browser and rasterized desktop transports.
 */
export function buildRentalReceiptHtml(
  rental: RentalDetail,
  empresaNome: string,
  kind: RentalReceiptKind,
  financial?: RentalFinancialSummary | null,
  options: { widthMm?: number } = {},
): string {
  const widthMm = options.widthMm ?? 80;
  const compact = widthMm <= 60;
  const horizontalPaddingMm = compact ? 1.5 : 1.4;
  const detailsLabelWidthMm = compact ? 21 : 27;
  const codeColumnMm = compact ? 9 : 11;
  const quantityColumnMm = compact ? 9 : 11;
  const subtotalColumnMm = compact ? 17 : 21;
  const columnGapMm = compact ? 0.6 : 0.8;

  const itemsRows = rental.itens
    .map((item) => {
      const quantityColumn =
        kind === "retirada"
          ? `${item.quantidade_retirada} de ${item.quantidade_contratada}`
          : kind === "devolucao"
            ? `${item.quantidade_devolvida} de ${item.quantidade_retirada}`
            : `${item.quantidade_contratada}`;
      return `<div class="item-row" role="row">
        <span class="item-material" role="cell">${escapeHtml(item.material.nome)}</span>
        <span class="item-code" role="cell">${escapeHtml(item.material.codigo_interno)}</span>
        <span class="item-quantity" role="cell">${quantityColumn}</span>
        <span class="item-subtotal" role="cell">${money.format(item.subtotal)}</span>
      </div>`;
    })
    .join("");

  const financialBlock = financial
    ? `<div class="block">
        <div class="section-heading"><h3>Situação financeira</h3><div class="section-rule"></div></div>
        <div class="amount-row amount-primary"><span>Valor</span><strong>${money.format(financial.valor_original)}</strong></div>
        <div class="amount-row"><span>Recebido</span><span>${money.format(financial.valor_recebido)}</span></div>
        <div class="amount-row"><span>A receber</span><span>${money.format(financial.valor_original - financial.valor_recebido)}</span></div>
      </div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(RECEIPT_TITLES[kind])} - ${escapeHtml(rental.numero)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: ${widthMm}mm; margin: 0; padding: 0; background: #fff; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: ${compact ? 10.5 : 12.25}px; line-height: 1.25; color: #000; font-weight: 600; opacity: 1; }
    .sheet { width: 100%; padding: 1.5mm ${horizontalPaddingMm}mm 1.2mm; background: #fff; }
    .sheet, .sheet * { color: #000; opacity: 1; }
    .receipt-header { text-align: center; margin: 0 0 2.4mm; }
    .company-name { margin: 0; font-size: ${compact ? 14 : 16.5}px; line-height: 1.15; font-weight: 700; overflow-wrap: anywhere; }
    .receipt-title { margin: 1mm 0 0; color: #000; font-size: ${compact ? 10.25 : 11.5}px; line-height: 1.15; font-weight: 700; text-transform: uppercase; }
    .block { margin: 0 0 2.2mm; }
    .details { width: 100%; }
    .detail-row { display: grid; grid-template-columns: ${detailsLabelWidthMm}mm minmax(0, 1fr); column-gap: 1.4mm; align-items: start; padding: 0.45mm 0; }
    .detail-label { font-weight: 700; white-space: nowrap; }
    .detail-value { min-width: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
    .date-value { white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: -0.1px; }
    .section-heading { margin: 1.5mm 0 0.5mm; }
    h3 { margin: 0 0 1.2mm; font-size: ${compact ? 10.75 : 12}px; line-height: 1.2; font-weight: 700; }
    .section-rule { height: 0; border-top: 1px solid #000; }
    .items-grid, .item-row { display: grid; grid-template-columns: minmax(0, 1fr) ${codeColumnMm}mm ${quantityColumnMm}mm ${subtotalColumnMm}mm; column-gap: ${columnGapMm}mm; width: 100%; }
    .items-header { align-items: end; padding-bottom: 0.7mm; font-size: ${compact ? 9.25 : 10.75}px; line-height: 1.1; font-weight: 700; }
    .item-row { align-items: start; border-top: 1px dotted #777; padding: 0.8mm 0; font-size: ${compact ? 9.5 : 11.25}px; font-weight: 600; }
    .item-material { min-width: 0; white-space: normal; overflow-wrap: anywhere; font-weight: 600; }
    .item-code { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: ${compact ? 9.25 : 10.75}px; font-weight: 600; }
    .item-quantity { min-width: 0; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: ${compact ? 9.25 : 10.75}px; font-weight: 600; }
    .item-subtotal { min-width: 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; letter-spacing: -0.15px; font-size: ${compact ? 9.25 : 10.75}px; font-weight: 600; }
    .total-row, .amount-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 2mm; align-items: baseline; padding: 0.7mm 0 0; }
    .total-row { margin-top: 0.6mm; border-top: 1px solid #000; font-size: ${compact ? 10.75 : 12.25}px; font-weight: 700; }
    .total-row strong, .amount-row > :last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .amount-row { padding-top: 0.5mm; font-weight: 600; }
    .amount-primary { font-weight: 700; }
    .notes { margin: 0; color: #000; font-size: ${compact ? 10.25 : 11.75}px; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
    .signature { margin: 4mm auto 0; text-align: center; font-size: ${compact ? 10.25 : 11.75}px; font-weight: 600; color: #000; }
    .signature-line { width: 66%; margin: 0 auto 0.8mm; border-top: 1px solid #000; }
    @media screen { body { background: #ddd; } .sheet { margin: 12px auto; box-shadow: 0 1px 6px #777; } }
  </style></head>
  <body><div class="sheet">
    <header class="receipt-header">
      <h1 class="company-name">${escapeHtml(empresaNome)}</h1>
      <p class="receipt-title">${escapeHtml(RECEIPT_TITLES[kind].toLocaleUpperCase("pt-BR"))}</p>
    </header>

    <div class="block">
      <div class="details">
        <div class="detail-row"><span class="detail-label">Locação</span><span class="detail-value">${escapeHtml(rental.numero)}</span></div>
        <div class="detail-row"><span class="detail-label">Data de emissão</span><span class="detail-value date-value">${formatReceiptDateTime(new Date())}</span></div>
        <div class="detail-row"><span class="detail-label">Cliente</span><span class="detail-value">${escapeHtml(rental.cliente.nome_fantasia || rental.cliente.nome)}</span></div>
        <div class="detail-row"><span class="detail-label">Retirada prevista</span><span class="detail-value date-value">${formatReceiptDateTime(rental.retirada_prevista_em)}</span></div>
        <div class="detail-row"><span class="detail-label">Devolução prevista</span><span class="detail-value date-value">${formatReceiptDateTime(rental.devolucao_prevista_em)}</span></div>
        <div class="detail-row"><span class="detail-label">Responsável</span><span class="detail-value">${escapeHtml(rental.responsavel_nome)}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${escapeHtml(RENTAL_STATUS_LABELS[rental.status])}</span></div>
      </div>
    </div>

    <div class="block">
      <div class="section-heading"><h3>Materiais</h3><div class="section-rule"></div></div>
      <div class="items-grid items-header" role="row"><span>Material</span><span>Código</span><span class="item-quantity">Qtd.</span><span class="item-subtotal">Subtotal</span></div>
      <div role="table">${itemsRows}</div>
      <div class="total-row"><strong>Valor total</strong><strong>${money.format(rental.valor_total)}</strong></div>
    </div>

    ${financialBlock}

    ${rental.observacoes ? `<div class="block"><div class="section-heading"><h3>Observações</h3><div class="section-rule"></div></div><p class="notes">${escapeHtml(rental.observacoes)}</p></div>` : ""}

    <div class="signature"><div class="signature-line"></div>Assinatura do cliente</div>
  </div>
  </body></html>`;
}

/** Single entry point for all three rental receipt variants. The canonical
 * printer service resolves the cupom queue on desktop and uses the iframe
 * browser dialog on web. */
export async function printRentalReceipt({
  companyId,
  rental,
  empresaNome,
  kind,
  financial,
}: {
  companyId: string;
  rental: RentalDetail;
  empresaNome: string;
  kind: RentalReceiptKind;
  financial?: RentalFinancialSummary | null;
}): Promise<void> {
  await printHtmlDocument({
    companyId,
    purpose: "cupom",
    documentName: `${RECEIPT_TITLES[kind]} - ${rental.numero}`,
    dynamicHeight: true,
    html: ({ widthMm }) =>
      buildRentalReceiptHtml(rental, empresaNome, kind, financial, {
        widthMm,
      }),
    messages: {
      failed: "Não foi possível enviar o cupom para a impressora.",
    },
  });
}
