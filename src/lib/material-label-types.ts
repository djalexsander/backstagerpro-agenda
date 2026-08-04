export type LabelIdentificationType = "qr_code" | "codigo_barras" | "ambos";
export type LabelField =
  | "nome"
  | "codigo_interno"
  | "categoria"
  | "marca_modelo"
  | "numero_serie"
  | "numero_patrimonio"
  | "localizacao"
  | "empresa";

export interface LabelModel {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  largura_mm: number;
  altura_mm: number;
  tipo_identificacao: LabelIdentificationType;
  campos: LabelField[];
  tamanho_fonte: number;
  mostrar_borda: boolean;
  margem_interna_mm: number;
  espacamento_interno_mm: number;
  padrao: boolean;
  ativo: boolean;
  versao: number;
  created_at: string;
  updated_at: string;
}

export interface LabelMaterial {
  id: string;
  nome: string;
  codigo_interno: string;
  categoria: string;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  numero_patrimonio: string | null;
  localizacao: string | null;
  identificador_unico: string;
  tipo_identificacao: LabelIdentificationType;
  status_identificacao: "nao_gerada" | "ativa" | "inativa";
  conteudo_qr_code: string | null;
  codigo_barras: string | null;
  ativo: boolean;
  ultima_impressao_em: string | null;
  total_impresso: number;
  updated_at: string;
}

export type LabelModelSnapshot = Pick<LabelModel,
  "id" | "nome" | "largura_mm" | "altura_mm" | "tipo_identificacao" |
  "campos" | "tamanho_fonte" | "mostrar_borda" | "margem_interna_mm" |
  "espacamento_interno_mm" | "versao"
>;

export interface LabelMaterialSnapshot {
  id: string;
  nome: string;
  codigo_interno: string;
  categoria: string;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  numero_patrimonio: string | null;
  localizacao: string | null;
  empresa: string;
  identificador_unico: string;
  conteudo_qr_code: string | null;
  codigo_barras: string | null;
}

export interface LabelPrintRequest {
  id: string;
  modelo_id: string | null;
  material_id: string;
  quantidade: number;
  modelo_snapshot: LabelModelSnapshot;
  material_snapshot: LabelMaterialSnapshot;
  solicitada_em: string;
  solicitante_nome: string;
  reimpressao_de_id: string | null;
}

export interface LabelBatchSelection { material: LabelMaterial; quantity: number; }

export interface LabelPrintBatchItem {
  id: string; solicitacao_id: string; material_id: string; ordem: number; quantidade: number;
  material_snapshot: LabelMaterialSnapshot;
}

export interface LabelPrintBatch {
  id: string; modelo_id: string | null; modelo_snapshot: LabelModelSnapshot;
  quantidade_materiais: number; quantidade_etiquetas: number; solicitada_em: string;
  solicitante_nome: string; reimpressao_de_id: string | null; itens: LabelPrintBatchItem[];
}

export interface LabelIndicators {
  modelos_ativos: number;
  materiais_identificados: number;
  solicitacoes_hoje: number;
  etiquetas_hoje: number;
}

export interface SaveLabelModelInput {
  id?: string;
  expectedUpdatedAt?: string;
  name: string;
  description?: string;
  widthMm: number;
  heightMm: number;
  identificationType: LabelIdentificationType;
  fields: LabelField[];
  fontSize: number;
  showBorder: boolean;
  isDefault: boolean;
  innerMarginMm: number;
  innerGapMm: number;
}
