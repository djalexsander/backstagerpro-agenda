import type { CustomerOption, RentalListItem } from "./material-rental-types";
import type { ClientReceivableSummary } from "./financial-ledger-types";
import { RENTAL_STATUS_LABELS } from "./material-rental-domain";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

/**
 * Builds the A4 client report (printerPurpose = "documento"). Pulls only
 * from data the app already has canonically - no field is invented or
 * duplicated: locações from material_locacoes (via listMaterialRentals,
 * same source Locações itself reads), financial totals from the
 * receivables ledger (listClientsReceivable), when available.
 */
export function buildClientReportHtml(
  empresaNome: string,
  client: CustomerOption,
  rentals: RentalListItem[],
  receivable: ClientReceivableSummary | null,
): string {
  const activeRentals = rentals.filter((rental) => rental.status !== "cancelada");
  const totalLocado = activeRentals.reduce((sum, rental) => sum + rental.valor_total, 0);
  const aReceber = receivable?.total_devido ?? null;
  const recebido = aReceber != null ? Math.max(totalLocado - aReceber, 0) : null;

  const rentalRows = rentals
    .map(
      (rental) => `<tr>
        <td>${escapeHtml(rental.numero)}</td>
        <td>${new Date(rental.retirada_prevista_em).toLocaleDateString("pt-BR")}</td>
        <td>${new Date(rental.devolucao_prevista_em).toLocaleDateString("pt-BR")}</td>
        <td>${escapeHtml(RENTAL_STATUS_LABELS[rental.status])}</td>
        <td>${rental.quantidade_itens}</td>
        <td class="right">${money.format(rental.valor_total)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Relatório do cliente - ${escapeHtml(client.nome)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: 210mm; font-family: Arial, sans-serif; font-size: 12px; color: #111; }
    .print-document { width: 100%; padding: 12mm; background: #fff; font-family: Arial, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #999; padding-bottom: 2px; }
    .muted { color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { text-align: left; padding: 4px 6px; font-size: 11px; border-bottom: 1px solid #eee; }
    .right { text-align: right; }
    .summary { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 6px; }
    .summary div { min-width: 140px; }
    .summary .label { font-size: 10px; color: #555; }
    .summary .value { font-size: 14px; font-weight: bold; }
    @media screen { body { margin: 24px auto; box-shadow: 0 1px 8px #999; } }
    @media print { body { width: auto; } .print-document { padding: 0; } }
  </style></head>
  <body><main class="print-document">
    <h1>${escapeHtml(empresaNome)}</h1>
    <p class="muted">Relatório do cliente — gerado em ${new Date().toLocaleString("pt-BR")}</p>

    <h2>Cliente</h2>
    <div class="summary">
      <div><div class="label">Nome</div><div class="value">${escapeHtml(client.nome_fantasia || client.nome)}</div></div>
      ${client.cpf_cnpj ? `<div><div class="label">CPF/CNPJ</div><div class="value">${escapeHtml(client.cpf_cnpj)}</div></div>` : ""}
      ${client.telefone ? `<div><div class="label">Telefone</div><div class="value">${escapeHtml(client.telefone)}</div></div>` : ""}
      ${client.email ? `<div><div class="label">E-mail</div><div class="value">${escapeHtml(client.email)}</div></div>` : ""}
    </div>

    <h2>Resumo</h2>
    <div class="summary">
      <div><div class="label">Locações</div><div class="value">${activeRentals.length}</div></div>
      <div><div class="label">Valor total locado</div><div class="value">${money.format(totalLocado)}</div></div>
      ${recebido != null ? `<div><div class="label">Recebido</div><div class="value">${money.format(recebido)}</div></div>` : ""}
      ${aReceber != null ? `<div><div class="label">A receber</div><div class="value">${money.format(aReceber)}</div></div>` : `<div><div class="label">A receber</div><div class="value muted">Financeiro não integrado</div></div>`}
    </div>

    <h2>Histórico de locações</h2>
    <table>
      <thead><tr><th>Número</th><th>Retirada</th><th>Devolução</th><th>Status</th><th>Itens</th><th class="right">Valor</th></tr></thead>
      <tbody>${rentalRows || `<tr><td colspan="6" class="muted">Nenhuma locação encontrada.</td></tr>`}</tbody>
    </table>
  </main></body></html>`;
}
