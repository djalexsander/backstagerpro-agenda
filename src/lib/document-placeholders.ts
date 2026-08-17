import { format, parseISO } from "date-fns";

export const FINANCIAL_DOCUMENT_PLACEHOLDERS = [
  "{{cache}}",
  "{{transporte}}",
  "{{alimentacao}}",
  "{{hospedagem}}",
] as const;

export interface DocumentEventData {
  name: string | null;
  date: string | null;
  city: string | null;
  venue: string | null;
  artist: string | null;
  show_time: string | null;
  observations: string | null;
}

export interface DocumentFinancialData {
  cache: number | null;
  transport: number | null;
  food: number | null;
  lodging: number | null;
}

interface DocumentPlaceholderSources {
  event: DocumentEventData;
  companyName: string;
  financial: DocumentFinancialData | null;
  currentDate?: Date;
}

interface ResolveDocumentTemplateOptions {
  templateContent: string;
  event: DocumentEventData;
  companyName: string;
  loadFinancial: () => Promise<DocumentFinancialData | null>;
  currentDate?: Date;
}

function formatCurrency(value: number | null): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value ?? 0);
}

export function buildDocumentPlaceholderContext({
  event,
  companyName,
  financial,
  currentDate = new Date(),
}: DocumentPlaceholderSources): Record<string, string> {
  return {
    "{{evento_nome}}": event.name || "",
    "{{evento_data}}": event.date ? format(parseISO(event.date), "dd/MM/yyyy") : "",
    "{{evento_cidade}}": event.city || "",
    "{{evento_local}}": event.venue || "",
    "{{artista}}": event.artist || "",
    "{{horario_show}}": event.show_time || "",
    "{{empresa_nome}}": companyName,
    "{{data_atual}}": format(currentDate, "dd/MM/yyyy"),
    "{{observacoes}}": event.observations || "",
    "{{cache}}": financial ? formatCurrency(financial.cache) : "",
    "{{transporte}}": financial ? formatCurrency(financial.transport) : "",
    "{{alimentacao}}": financial ? formatCurrency(financial.food) : "",
    "{{hospedagem}}": financial ? formatCurrency(financial.lodging) : "",
  };
}

export function replaceDocumentPlaceholders(
  templateContent: string,
  context: Record<string, string>,
): string {
  return Object.entries(context).reduce(
    (content, [placeholder, value]) => content.split(placeholder).join(value),
    templateContent,
  );
}

/**
 * Resolves every asynchronous source before creating the single placeholder
 * context used by the persisted document, preview and exports.
 */
export async function resolveDocumentTemplateContent({
  templateContent,
  event,
  companyName,
  loadFinancial,
  currentDate,
}: ResolveDocumentTemplateOptions): Promise<string> {
  const financial = await loadFinancial();
  const context = buildDocumentPlaceholderContext({
    event,
    companyName,
    financial,
    currentDate,
  });

  return replaceDocumentPlaceholders(templateContent, context);
}
