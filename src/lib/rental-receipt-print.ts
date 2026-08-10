import type { RentalDetail } from "./material-rental-types";
import type { RentalFinancialSummary } from "./financial-ledger-types";
import { RENTAL_STATUS_LABELS } from "./material-rental-domain";

export type RentalReceiptKind = "comprovante" | "retirada" | "devolucao";

const RECEIPT_TITLES: Record<RentalReceiptKind, string> = {
  comprovante: "Comprovante de locação",
  retirada: "Comprovante de retirada",
  devolucao: "Comprovante de devolução",
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

/**
 * One parametrized generator for the three receipt buttons ("Imprimir
 * comprovante" / "Imprimir retirada" / "Imprimir devolução") instead of
 * three separate layouts - only the title and which item quantities are
 * highlighted change with `kind`. Reuses the same popup + @page CSS +
 * window.print() pattern already proven for labels
 * (src/lib/material-label-print.tsx) via printer-service.ts's
 * openPrintWindow, so this is not a second print mechanism.
 */
export function buildRentalReceiptHtml(
  rental: RentalDetail,
  empresaNome: string,
  kind: RentalReceiptKind,
  financial?: RentalFinancialSummary | null,
): string {
  const itemsRows = rental.itens
    .map((item) => {
      const quantityColumn =
        kind === "retirada"
          ? `${item.quantidade_retirada} de ${item.quantidade_contratada}`
          : kind === "devolucao"
            ? `${item.quantidade_devolvida} de ${item.quantidade_retirada}`
            : `${item.quantidade_contratada}`;
      return `<tr>
        <td>${escapeHtml(item.material.nome)}</td>
        <td>${escapeHtml(item.material.codigo_interno)}</td>
        <td class="right">${quantityColumn}</td>
        <td class="right">${money.format(item.subtotal)}</td>
      </tr>`;
    })
    .join("");

  const financialBlock = financial
    ? `<div class="block">
        <h3>Situação financeira</h3>
        <table class="kv">
          <tr><td>Valor</td><td class="right">${money.format(financial.valor_original)}</td></tr>
          <tr><td>Recebido</td><td class="right">${money.format(financial.valor_recebido)}</td></tr>
          <tr><td>A receber</td><td class="right">${money.format(financial.valor_original - financial.valor_recebido)}</td></tr>
        </table>
      </div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(RECEIPT_TITLES[kind])} - ${escapeHtml(rental.numero)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
    h1 { font-size: 14px; margin: 0 0 4px; }
    h3 { font-size: 11px; margin: 8px 0 2px; border-bottom: 1px solid #000; }
    .block { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    table.items th, table.items td { text-align: left; padding: 2px 0; font-size: 10px; }
    table.items th.right, table.items td.right, .right { text-align: right; }
    table.kv td { padding: 1px 0; }
    .muted { color: #444; font-size: 10px; }
    .signature { margin-top: 24px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; }
    @media screen { body { background: #ddd; } .sheet { max-width: 320px; margin: 12px auto; background: white; padding: 8px; box-shadow: 0 1px 6px #777; } }
  </style></head>
  <body><div class="sheet">
    <h1>${escapeHtml(empresaNome)}</h1>
    <p class="muted">${escapeHtml(RECEIPT_TITLES[kind])}</p>

    <div class="block">
      <table class="kv">
        <tr><td>Locação</td><td class="right">${escapeHtml(rental.numero)}</td></tr>
        <tr><td>Data de emissão</td><td class="right">${new Date().toLocaleDateString("pt-BR")}</td></tr>
        <tr><td>Cliente</td><td class="right">${escapeHtml(rental.cliente.nome_fantasia || rental.cliente.nome)}</td></tr>
        <tr><td>Retirada prevista</td><td class="right">${new Date(rental.retirada_prevista_em).toLocaleString("pt-BR")}</td></tr>
        <tr><td>Devolução prevista</td><td class="right">${new Date(rental.devolucao_prevista_em).toLocaleString("pt-BR")}</td></tr>
        <tr><td>Responsável</td><td class="right">${escapeHtml(rental.responsavel_nome)}</td></tr>
        <tr><td>Status</td><td class="right">${escapeHtml(RENTAL_STATUS_LABELS[rental.status])}</td></tr>
      </table>
    </div>

    <div class="block">
      <h3>Materiais</h3>
      <table class="items">
        <thead><tr><th>Material</th><th>Código</th><th class="right">Qtd.</th><th class="right">Subtotal</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <table class="kv"><tr><td><strong>Valor total</strong></td><td class="right"><strong>${money.format(rental.valor_total)}</strong></td></tr></table>
    </div>

    ${financialBlock}

    ${rental.observacoes ? `<div class="block"><h3>Observações</h3><p>${escapeHtml(rental.observacoes)}</p></div>` : ""}

    <div class="signature">Assinatura do cliente</div>
  </div>
  <script>window.addEventListener('load',function(){window.focus();window.print();});</script>
  </body></html>`;
}
