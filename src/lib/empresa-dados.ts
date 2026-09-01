// Dados cadastrais da empresa atual — fonte única compartilhada entre a tela
// "Configurações → Empresa" (src/pages/ConfiguracoesEmpresa.tsx), o hook
// useEmpresaDados e a resolução de placeholders de Documentos
// (src/lib/document-placeholders.ts).
//
// Módulo puro: zero imports (nem React, nem supabase). Toda a normalização
// leve dos campos vive aqui e é testada em src/lib/empresa-dados.test.ts.

/** Colunas lidas de `public.empresas`. Uma única string para o hook e a tela
 *  nunca divergirem. */
export const EMPRESA_DADOS_SELECT =
  "id, nome_empresa, razao_social, cpf_cnpj, email, telefone, whatsapp, cep, endereco, numero, complemento, bairro, cidade, estado, logo_url";

/** Forma dos dados cadastrais depois de lidos do banco (nomes = colunas). */
export interface EmpresaDados {
  id: string;
  nome_empresa: string;
  razao_social: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  logo_url: string | null;
}

/** Campos editáveis na tela (todos como string — inputs controlados). */
export const EMPRESA_FORM_FIELDS = [
  "nome_empresa",
  "razao_social",
  "cpf_cnpj",
  "email",
  "telefone",
  "whatsapp",
  "cep",
  "endereco",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
] as const;

export type EmpresaFormField = (typeof EMPRESA_FORM_FIELDS)[number];
export type EmpresaFormValues = Record<EmpresaFormField, string>;

/** Payload pronto para `supabase.from("empresas").update(...)` — só colunas
 *  cadastrais. `nome_empresa` nunca vira null (casa com o NOT NULL). */
export type EmpresaDadosUpdate = {
  nome_empresa: string;
  razao_social: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
};

/** UFs brasileiras para o <Select> de estado. */
export const BR_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE",
  "TO",
] as const;

export function emptyEmpresaForm(): EmpresaFormValues {
  return EMPRESA_FORM_FIELDS.reduce((acc, field) => {
    acc[field] = "";
    return acc;
  }, {} as EmpresaFormValues);
}

/** Popula o formulário a partir dos dados carregados (null → ""). */
export function empresaFormFromDados(
  dados: EmpresaDados | null | undefined,
): EmpresaFormValues {
  const form = emptyEmpresaForm();
  if (!dados) return form;
  for (const field of EMPRESA_FORM_FIELDS) {
    form[field] = dados[field] ?? "";
  }
  return form;
}

const NON_DIGITS = /\D+/g;

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function digitsOrNull(value: string): string | null {
  const digits = value.replace(NON_DIGITS, "");
  return digits === "" ? null : digits;
}

/** Trim em tudo, dígitos-only em cpf_cnpj/cep, UF em maiúsculo, "" → null
 *  (menos nome_empresa, que fica só com trim). */
export function normalizeEmpresaForm(form: EmpresaFormValues): EmpresaDadosUpdate {
  return {
    nome_empresa: form.nome_empresa.trim(),
    razao_social: trimOrNull(form.razao_social),
    cpf_cnpj: digitsOrNull(form.cpf_cnpj),
    email: trimOrNull(form.email),
    telefone: trimOrNull(form.telefone),
    whatsapp: trimOrNull(form.whatsapp),
    cep: digitsOrNull(form.cep),
    endereco: trimOrNull(form.endereco),
    numero: trimOrNull(form.numero),
    complemento: trimOrNull(form.complemento),
    bairro: trimOrNull(form.bairro),
    cidade: trimOrNull(form.cidade),
    estado: trimOrNull(form.estado)?.toUpperCase().slice(0, 2) ?? null,
  };
}

/** `public.empresas.cpf_cnpj` tem CHECK de 11 (CPF) ou 14 (CNPJ) dígitos.
 *  null é válido (campo opcional). */
export function isValidEmpresaDocumento(digits: string | null): boolean {
  if (digits === null) return true;
  return digits.length === 11 || digits.length === 14;
}

export function isCompleteEmpresaCep(digits: string | null): boolean {
  return digits === null || digits.length === 8;
}

type EmpresaEnderecoLike = {
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
};

/** "12.345.678/0001-90" / "123.456.789-09" — devolve o valor cru se não tiver
 *  11 nem 14 dígitos. */
export function formatEmpresaDocumento(digits: string | null | undefined): string {
  if (!digits) return "";
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return digits;
}

/** "12345-678" — devolve o valor cru se não tiver 8 dígitos. */
export function formatEmpresaCep(digits: string | null | undefined): string {
  if (!digits) return "";
  if (digits.length === 8) return digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return digits;
}

/** "Cidade/UF" — tolerante a partes ausentes. */
export function formatEmpresaCidadeUf(dados: EmpresaEnderecoLike): string {
  const cidade = dados.cidade?.trim() || "";
  const estado = dados.estado?.trim() || "";
  if (cidade && estado) return `${cidade}/${estado}`;
  return cidade || estado;
}

/** "Logradouro, 123, Sala 4 — Bairro" — só logradouro/número/complemento/bairro,
 *  tolerante a partes ausentes (string vazia quando não há nada). */
export function formatEmpresaEndereco(dados: EmpresaEnderecoLike): string {
  const ruaNumComp = [dados.endereco, dados.numero, dados.complemento]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const bairro = dados.bairro?.trim() || "";
  if (ruaNumComp && bairro) return `${ruaNumComp} — ${bairro}`;
  return ruaNumComp || bairro;
}

/** Endereço completo em uma linha, incluindo cidade/UF e CEP. Usado pelo
 *  placeholder {{empresa_endereco}} dos documentos. */
export function formatEmpresaEnderecoCompleto(dados: EmpresaEnderecoLike): string {
  const segmentos: string[] = [];
  const ruaNumComp = [dados.endereco, dados.numero, dados.complemento]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  if (ruaNumComp) segmentos.push(ruaNumComp);
  if (dados.bairro?.trim()) segmentos.push(dados.bairro.trim());
  const cidadeUf = formatEmpresaCidadeUf(dados);
  if (cidadeUf) segmentos.push(cidadeUf);
  const cep = formatEmpresaCep(dados.cep ?? null);
  if (cep) segmentos.push(`CEP ${cep}`);
  return segmentos.join(" — ");
}
