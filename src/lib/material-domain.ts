import type {
  Material,
  MaterialFormValues,
  MaterialOperationalStatus,
} from "./material-types";
import { validateMaterialBarcode } from "./material-identification";

export type MaterialFormErrors = Partial<
  Record<keyof MaterialFormValues, string>
>;

const manualJustificationStatuses = new Set<MaterialOperationalStatus>([
  "em_manutencao",
  "avariado",
  "extraviado",
  "baixado",
]);

export function parseBrazilianDecimal(value: string): string | null {
  const compact = value.replace(/\s/g, "").replace(/^R\$/i, "");
  if (!compact) return null;

  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Valor monetário inválido");
  }

  const [wholeRaw, fractionRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.padEnd(2, "0");
  return `${whole}.${fraction}`;
}

export function formatBrazilianCurrency(
  value: number | string | null | undefined,
): string {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

export function validateMaterialForm(
  values: MaterialFormValues,
  previous?: Pick<Material, "status_operacional"> | null,
): MaterialFormErrors {
  const errors: MaterialFormErrors = {};

  if (!values.codigo_interno.trim()) {
    errors.codigo_interno = "Informe o código interno.";
  }
  if (!values.nome.trim()) {
    errors.nome = "Informe o nome do material.";
  }
  if (!values.categoria_id) {
    errors.categoria_id = "Selecione uma categoria ativa.";
  }
  if (!values.unidade_medida.trim()) {
    errors.unidade_medida = "Informe a unidade de medida.";
  }

  try {
    validateMaterialBarcode(values.codigo_barras);
  } catch (error) {
    errors.codigo_barras =
      error instanceof Error
        ? error.message
        : "Código de barras inválido.";
  }
  if (
    (values.tipo_identificacao === "codigo_barras" ||
      values.tipo_identificacao === "ambos") &&
    !values.codigo_barras.trim()
  ) {
    errors.codigo_barras =
      "Informe o código de barras ou gere um código antes de salvar.";
  }

  const minimumStock = Number(values.estoque_minimo);
  if (!Number.isInteger(minimumStock) || minimumStock < 0) {
    errors.estoque_minimo =
      "O estoque mínimo deve ser um número inteiro não negativo.";
  }

  for (const field of [
    "valor_aquisicao",
    "valor_reposicao",
    "valor_locacao_padrao",
  ] as const) {
    try {
      parseBrazilianDecimal(values[field]);
    } catch {
      errors[field] = "Informe um valor monetário válido e não negativo.";
    }
  }

  if (
    previous &&
    previous.status_operacional !== values.status_operacional &&
    manualJustificationStatuses.has(values.status_operacional) &&
    !values.justificativa_status.trim()
  ) {
    errors.justificativa_status =
      "Registre a justificativa para a alteração manual de status.";
  }

  return errors;
}

export function materialFormToPayload(values: MaterialFormValues) {
  return {
    categoria_id: values.categoria_id,
    codigo_interno: values.codigo_interno.trim(),
    nome: values.nome.trim(),
    descricao: values.descricao.trim() || null,
    marca: values.marca.trim() || null,
    modelo: values.modelo.trim() || null,
    numero_serie: values.numero_serie.trim() || null,
    numero_patrimonio: values.numero_patrimonio.trim() || null,
    codigo_barras: validateMaterialBarcode(values.codigo_barras),
    tipo_identificacao: values.tipo_identificacao,
    tipo_controle: values.tipo_controle,
    estoque_minimo: Number(values.estoque_minimo),
    unidade_medida: values.unidade_medida.trim(),
    valor_aquisicao: parseBrazilianDecimal(values.valor_aquisicao),
    valor_reposicao: parseBrazilianDecimal(values.valor_reposicao),
    valor_locacao_padrao: parseBrazilianDecimal(
      values.valor_locacao_padrao,
    ),
    data_aquisicao: values.data_aquisicao || null,
    fornecedor: values.fornecedor.trim() || null,
    observacoes: values.observacoes.trim() || null,
    status_operacional: values.status_operacional,
    justificativa_status: values.justificativa_status.trim() || null,
    ativo: values.ativo,
  };
}

export function materialToForm(material: Material): MaterialFormValues {
  const money = (value: number | null) =>
    value == null ? "" : Number(value).toFixed(2).replace(".", ",");

  return {
    codigo_interno: material.codigo_interno,
    nome: material.nome,
    descricao: material.descricao ?? "",
    categoria_id: material.categoria_id,
    marca: material.marca ?? "",
    modelo: material.modelo ?? "",
    numero_serie: material.numero_serie ?? "",
    numero_patrimonio: material.numero_patrimonio ?? "",
    codigo_barras: material.codigo_barras ?? "",
    tipo_identificacao: material.tipo_identificacao,
    tipo_controle: material.tipo_controle,
    estoque_minimo: String(material.estoque_minimo),
    unidade_medida: material.unidade_medida,
    valor_aquisicao: money(material.valor_aquisicao),
    valor_reposicao: money(material.valor_reposicao),
    valor_locacao_padrao: money(material.valor_locacao_padrao),
    data_aquisicao: material.data_aquisicao ?? "",
    fornecedor: material.fornecedor ?? "",
    observacoes: material.observacoes ?? "",
    status_operacional: material.status_operacional,
    justificativa_status: material.justificativa_status ?? "",
    ativo: material.ativo,
  };
}
