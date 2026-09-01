import { format, parseISO } from "date-fns";
import {
  formatEmpresaCep,
  formatEmpresaCidadeUf,
  formatEmpresaDocumento,
  formatEmpresaEnderecoCompleto,
} from "./empresa-dados";

export const FINANCIAL_DOCUMENT_PLACEHOLDERS = [
  "{{cache}}",
  "{{transporte}}",
  "{{alimentacao}}",
  "{{hospedagem}}",
] as const;

export const COMPANY_DOCUMENT_PLACEHOLDERS = [
  "{{empresa_nome}}",
  "{{empresa_razao_social}}",
  "{{empresa_cnpj}}",
  "{{empresa_documento}}",
  "{{empresa_telefone}}",
  "{{empresa_whatsapp}}",
  "{{empresa_email}}",
  "{{empresa_cep}}",
  "{{empresa_endereco}}",
  "{{empresa_bairro}}",
  "{{empresa_cidade}}",
  "{{empresa_estado}}",
  "{{empresa_cidade_uf}}",
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

/** Dados cadastrais da empresa atual (subconjunto de EmpresaDados). Todos os
 *  campos são opcionais: quando ausentes, os placeholders {{empresa_*}} viram
 *  string vazia — nunca deixam `{{...}}` no documento. */
export interface DocumentCompanyData {
  nome_empresa?: string | null;
  razao_social?: string | null;
  cpf_cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
}

interface DocumentPlaceholderSources {
  event: DocumentEventData;
  companyName: string;
  company?: DocumentCompanyData | null;
  financial: DocumentFinancialData | null;
  currentDate?: Date;
}

interface ResolveDocumentTemplateOptions {
  templateContent: string;
  event: DocumentEventData;
  companyName: string;
  company?: DocumentCompanyData | null;
  loadFinancial: () => Promise<DocumentFinancialData | null>;
  currentDate?: Date;
}

function formatCurrency(value: number | null): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value ?? 0);
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function buildDocumentPlaceholderContext({
  event,
  companyName,
  company,
  financial,
  currentDate = new Date(),
}: DocumentPlaceholderSources): Record<string, string> {
  const empresa = company ?? {};
  return {
    "{{evento_nome}}": event.name || "",
    "{{evento_data}}": event.date ? format(parseISO(event.date), "dd/MM/yyyy") : "",
    "{{evento_cidade}}": event.city || "",
    "{{evento_local}}": event.venue || "",
    "{{artista}}": event.artist || "",
    "{{horario_show}}": event.show_time || "",
    "{{data_atual}}": format(currentDate, "dd/MM/yyyy"),
    "{{observacoes}}": event.observations || "",
    "{{cache}}": financial ? formatCurrency(financial.cache) : "",
    "{{transporte}}": financial ? formatCurrency(financial.transport) : "",
    "{{alimentacao}}": financial ? formatCurrency(financial.food) : "",
    "{{hospedagem}}": financial ? formatCurrency(financial.lodging) : "",
    "{{empresa_nome}}": text(empresa.nome_empresa) || companyName || "",
    "{{empresa_razao_social}}": text(empresa.razao_social),
    "{{empresa_cnpj}}": formatEmpresaDocumento(empresa.cpf_cnpj),
    "{{empresa_documento}}": formatEmpresaDocumento(empresa.cpf_cnpj),
    "{{empresa_telefone}}": text(empresa.telefone),
    "{{empresa_whatsapp}}": text(empresa.whatsapp),
    "{{empresa_email}}": text(empresa.email),
    "{{empresa_cep}}": formatEmpresaCep(empresa.cep ?? null),
    "{{empresa_endereco}}": formatEmpresaEnderecoCompleto(empresa),
    "{{empresa_bairro}}": text(empresa.bairro),
    "{{empresa_cidade}}": text(empresa.cidade),
    "{{empresa_estado}}": text(empresa.estado),
    "{{empresa_cidade_uf}}": formatEmpresaCidadeUf(empresa),
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
  company,
  loadFinancial,
  currentDate,
}: ResolveDocumentTemplateOptions): Promise<string> {
  const financial = await loadFinancial();
  const context = buildDocumentPlaceholderContext({
    event,
    companyName,
    company,
    financial,
    currentDate,
  });

  return replaceDocumentPlaceholders(templateContent, context);
}
