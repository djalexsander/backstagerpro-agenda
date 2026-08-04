import type { LabelBatchSelection, LabelField, LabelIdentificationType, LabelMaterial, LabelMaterialSnapshot, LabelModel, LabelModelSnapshot, LabelPrintBatch } from "./material-label-types";

export const LABEL_FIELD_LABELS: Record<LabelField, string> = {
  nome: "Nome",
  codigo_interno: "Código interno",
  categoria: "Categoria",
  marca_modelo: "Marca / modelo",
  numero_serie: "Número de série",
  numero_patrimonio: "Patrimônio",
  localizacao: "Localização",
  empresa: "Empresa",
};

export const LABEL_IDENTIFICATION_LABELS: Record<LabelIdentificationType, string> = {
  qr_code: "QR Code",
  codigo_barras: "Código de barras (Code 128)",
  ambos: "QR Code e código de barras",
};

export const LABEL_SIZE_PRESETS = [
  { name: "Compacta 50 × 30 mm", width: 50, height: 30 },
  { name: "Patrimônio 60 × 40 mm", width: 60, height: 40 },
  { name: "Logística 100 × 50 mm", width: 100, height: 50 },
] as const;

export const DEFAULT_LABEL_FIELDS: LabelField[] = ["nome", "codigo_interno", "numero_patrimonio"];

export function canPrintMaterialWithModel(material: LabelMaterial, model: Pick<LabelModel, "tipo_identificacao">) {
  if (model.tipo_identificacao === "qr_code") return Boolean(material.conteudo_qr_code);
  if (model.tipo_identificacao === "codigo_barras") return Boolean(material.codigo_barras);
  return Boolean(material.conteudo_qr_code && material.codigo_barras);
}

export function labelReadinessMessage(material: LabelMaterial, model: Pick<LabelModel, "tipo_identificacao">) {
  if (canPrintMaterialWithModel(material, model)) return null;
  if (model.tipo_identificacao === "qr_code") return "Gere o QR Code no cadastro do material.";
  if (model.tipo_identificacao === "codigo_barras") return "Gere o código de barras no cadastro do material.";
  return "Gere o QR Code e o código de barras no cadastro do material.";
}

export function validateLabelModel(input: {
  name: string; widthMm: number; heightMm: number; fontSize: number; fields: LabelField[]; innerMarginMm?: number; innerGapMm?: number;
}) {
  if (!input.name.trim() || input.name.trim().length > 80) return "Informe um nome com até 80 caracteres.";
  if (input.widthMm < 20 || input.widthMm > 210) return "A largura deve ficar entre 20 e 210 mm.";
  if (input.heightMm < 10 || input.heightMm > 297) return "A altura deve ficar entre 10 e 297 mm.";
  if (input.fontSize < 6 || input.fontSize > 24) return "A fonte deve ficar entre 6 e 24 pt.";
  if ((input.innerMarginMm ?? 1.5) < 0 || (input.innerMarginMm ?? 1.5) > 10) return "A margem interna deve ficar entre 0 e 10 mm.";
  if ((input.innerGapMm ?? 1.5) < 0 || (input.innerGapMm ?? 1.5) > 10) return "O espaçamento interno deve ficar entre 0 e 10 mm.";
  if (input.fields.length < 1 || input.fields.length > 8 || new Set(input.fields).size !== input.fields.length) {
    return "Selecione entre 1 e 8 campos sem repetições.";
  }
  return null;
}

export function labelModelToSnapshot(model: LabelModel): LabelModelSnapshot {
  return {
    id: model.id, nome: model.nome, largura_mm: model.largura_mm, altura_mm: model.altura_mm,
    tipo_identificacao: model.tipo_identificacao, campos: model.campos,
    tamanho_fonte: model.tamanho_fonte, mostrar_borda: model.mostrar_borda,
    margem_interna_mm: Number(model.margem_interna_mm ?? 1.5),
    espacamento_interno_mm: Number(model.espacamento_interno_mm ?? 1.5), versao: model.versao,
  };
}

export function materialToLabelSnapshot(material: LabelMaterial, companyName: string): LabelMaterialSnapshot {
  return { id: material.id, nome: material.nome, codigo_interno: material.codigo_interno, categoria: material.categoria,
    marca: material.marca, modelo: material.modelo, numero_serie: material.numero_serie,
    numero_patrimonio: material.numero_patrimonio, localizacao: material.localizacao, empresa: companyName,
    identificador_unico: material.identificador_unico, conteudo_qr_code: material.conteudo_qr_code,
    codigo_barras: material.codigo_barras };
}

export function addLabelBatchMaterial(current: LabelBatchSelection[], material: LabelMaterial) {
  return current.some((item) => item.material.id === material.id) ? current : [...current, { material, quantity: 1 }];
}
export function updateLabelBatchQuantity(current: LabelBatchSelection[], materialId: string, quantity: number) {
  return current.map((item) => item.material.id === materialId ? { ...item, quantity } : item);
}
export function removeLabelBatchMaterial(current: LabelBatchSelection[], materialId: string) {
  return current.filter((item) => item.material.id !== materialId);
}
export function labelBatchTotal(current: LabelBatchSelection[]) { return current.reduce((total, item) => total + item.quantity, 0); }
export function labelBatchToRpcItems(current: LabelBatchSelection[]) {
  return current.map((item) => ({ material_id: item.material.id, quantidade: item.quantity, expected_updated_at: item.material.updated_at }));
}
export function expandLabelBatch(batch: Pick<LabelPrintBatch, "itens">) {
  return [...batch.itens].sort((a, b) => a.ordem - b.ordem).flatMap((item) => Array.from({ length: item.quantidade }, () => item.material_snapshot));
}

export function labelHistoryPagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { totalPages, canGoPrevious: page > 1, canGoNext: page < totalPages };
}
