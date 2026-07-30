import type { Tables } from "@/integrations/supabase/types";

export type MaterialCategory = Tables<"categorias_materiais">;
export type Material = Tables<"materiais">;
export type MaterialPhoto = Tables<"materiais_fotos">;

export type MaterialControlType = Material["tipo_controle"];
export type MaterialOperationalStatus = Material["status_operacional"];
export type MaterialIdentificationType = Material["tipo_identificacao"];
export type MaterialIdentificationStatus = Material["status_identificacao"];

export interface MaterialPhotoWithUrl extends MaterialPhoto {
  signedUrl?: string;
}

export interface MaterialWithRelations extends Material {
  categoria: MaterialCategory | null;
  fotos: MaterialPhotoWithUrl[];
}

export interface MaterialFormValues {
  codigo_interno: string;
  nome: string;
  descricao: string;
  categoria_id: string;
  marca: string;
  modelo: string;
  numero_serie: string;
  numero_patrimonio: string;
  codigo_barras: string;
  tipo_identificacao: MaterialIdentificationType;
  tipo_controle: MaterialControlType;
  estoque_minimo: string;
  unidade_medida: string;
  valor_aquisicao: string;
  valor_reposicao: string;
  valor_locacao_padrao: string;
  data_aquisicao: string;
  fornecedor: string;
  observacoes: string;
  status_operacional: MaterialOperationalStatus;
  justificativa_status: string;
  ativo: boolean;
}

export const EMPTY_MATERIAL_FORM: MaterialFormValues = {
  codigo_interno: "",
  nome: "",
  descricao: "",
  categoria_id: "",
  marca: "",
  modelo: "",
  numero_serie: "",
  numero_patrimonio: "",
  codigo_barras: "",
  tipo_identificacao: "qr_code",
  tipo_controle: "individual",
  estoque_minimo: "0",
  unidade_medida: "unidade",
  valor_aquisicao: "",
  valor_reposicao: "",
  valor_locacao_padrao: "",
  data_aquisicao: "",
  fornecedor: "",
  observacoes: "",
  status_operacional: "disponivel",
  justificativa_status: "",
  ativo: true,
};

export const MATERIAL_STATUS_LABELS: Record<
  MaterialOperationalStatus,
  string
> = {
  disponivel: "Disponível",
  em_manutencao: "Em manutenção",
  avariado: "Avariado",
  extraviado: "Extraviado",
  baixado: "Baixado",
};

export const MANUAL_MATERIAL_STATUSES: MaterialOperationalStatus[] = [
  "disponivel",
  "em_manutencao",
  "avariado",
  "extraviado",
  "baixado",
];

export const MATERIAL_UNITS = [
  "unidade",
  "peça",
  "kit",
  "metro",
  "rolo",
  "caixa",
] as const;

export const MATERIAL_IDENTIFICATION_TYPE_LABELS: Record<
  MaterialIdentificationType,
  string
> = {
  qr_code: "QR Code",
  codigo_barras: "Código de barras",
  ambos: "QR Code e código de barras",
};

export const MATERIAL_IDENTIFICATION_STATUS_LABELS: Record<
  MaterialIdentificationStatus,
  string
> = {
  nao_gerada: "Não gerada",
  ativa: "Ativa",
  inativa: "Inativa",
};
