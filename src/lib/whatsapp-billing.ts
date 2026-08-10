import type { ClientReceivableSummary, ReceivableEntry } from "./financial-ledger-types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDate(iso: string): string {
  // "YYYY-MM-DD" parses as UTC midnight in JS; appending a bare time (no Z/
  // offset) makes it parse as local midnight instead, avoiding an off-by-
  // one-day shift for timezones behind UTC (e.g. Brazil).
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

/**
 * Manual WhatsApp billing is opened via a wa.me deep link (see
 * buildWhatsAppUrl) - not the paid WhatsApp Business API, no automation.
 * That endpoint expects digits only, with the country code prepended.
 * Brazilian numbers as stored in clientes.telefone are free-form
 * ("(11) 99999-8888", "11999998888", etc.) - this only ever adds the "55"
 * country code for what looks like a bare local number (10-11 digits);
 * anything already carrying a country code (12-13 digits) is left as-is.
 * Returns null for empty/unusably short input so the caller can show
 * "telefone inválido" instead of opening a broken link.
 */
export function normalizeWhatsAppPhone(rawPhone: string | null | undefined): string | null {
  const digits = (rawPhone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

/**
 * Builds a wa.me deep link with the message pre-filled - this only opens
 * WhatsApp/WhatsApp Web with the text ready to review; the person still has
 * to hit send themselves there (manual, not automated delivery).
 */
export function buildWhatsAppUrl(phoneE164Digits: string, message: string): string {
  return `https://wa.me/${phoneE164Digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Builds a whatsapp:// deep link - same phone/message as buildWhatsAppUrl,
 * just addressed to the WhatsApp Desktop app's own registered URI scheme
 * instead of the wa.me web redirect. Desktop (src/lib/whatsapp-launcher.ts)
 * tries this first so the app opens directly, with buildWhatsAppUrl's
 * wa.me link as the fallback; the web build never uses this.
 */
export function buildWhatsAppProtocolUrl(phoneE164Digits: string, message: string): string {
  return `whatsapp://send?phone=${phoneE164Digits}&text=${encodeURIComponent(message)}`;
}

/**
 * Every value here comes straight from listar_clientes_a_receber (the
 * ClientReceivableSummary) and listar_contas_receber (the ReceivableEntry
 * list, via listClientReceivableEntries) - the exact same RPCs the rest of
 * Contas a Receber already uses. No balance, status or due date is
 * recomputed here; this only formats already-authoritative numbers into
 * text.
 */
export function buildWhatsAppBillingMessage(params: {
  client: Pick<ClientReceivableSummary, "cliente_nome" | "cliente_nome_fantasia" | "total_devido" | "proximo_vencimento">;
  entries: ReceivableEntry[];
  companyName: string;
}): string {
  const { client, entries, companyName } = params;
  const displayName = client.cliente_nome_fantasia || client.cliente_nome;
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;

  const lines: string[] = [];
  const singleEntry = entries.length === 1 ? entries[0] : null;

  const intro = [
    `Olá, ${firstName}.`,
    `Consta um saldo pendente de ${money.format(client.total_devido)}`
      + (singleEntry ? ` referente à ${singleEntry.descricao}` : "")
      + (client.proximo_vencimento ? `, com vencimento em ${formatDate(client.proximo_vencimento)}` : "")
      + ".",
  ];
  lines.push(intro.join(" "));

  if (entries.length > 1) {
    lines.push("");
    lines.push("Resumo dos títulos em aberto:");
    for (const entry of entries) {
      const pending = entry.valor_original - entry.valor_recebido;
      const dueText = entry.forma_cobranca === "avista" && entry.vencimento
        ? ` (vence ${formatDate(entry.vencimento)})`
        : entry.forma_cobranca === "parcelado"
          ? " (parcelado)"
          : "";
      lines.push(`- ${entry.descricao}: ${money.format(pending)}${dueText}`);
    }
  }

  lines.push("");
  lines.push("Qualquer dúvida, estamos à disposição.");
  lines.push(companyName);

  return lines.join("\n");
}
