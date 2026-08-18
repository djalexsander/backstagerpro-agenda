import type { Database } from "@/integrations/supabase/types";
import type { MaterialControlType, MaterialOperationalStatus } from "./material-types";

export type CustodyCondition =
  Database["public"]["Enums"]["material_custody_condition"];
export type CustodyPurpose =
  Database["public"]["Enums"]["material_custody_purpose"];
export type CustodyResponsibleType =
  Database["public"]["Enums"]["material_custody_responsible_type"];
export type CustodyStatus =
  Database["public"]["Enums"]["material_custody_status"];

export interface CustodyBalanceOption {
  localizacao_id: string;
  localizacao_codigo: string;
  localizacao_nome: string;
  localizacao_ativa: boolean;
  quantidade: number;
}

export interface OpenCustodySummary {
  id: string;
  quantidade_retirada: number;
  quantidade_devolvida: number;
  quantidade_baixada: number;
  quantidade_pendente: number;
  responsavel_nome: string;
  retirada_em: string;
  previsao_retorno: string | null;
  status: "aberta" | "parcial";
}

export interface CustodyMaterialSearchResult {
  id: string;
  nome: string;
  codigo_interno: string;
  identificador_unico: string | null;
  codigo_barras: string | null;
  conteudo_qr_code: string | null;
  numero_patrimonio: string | null;
  numero_serie: string | null;
  tipo_controle: MaterialControlType;
  status_operacional: MaterialOperationalStatus;
  ativo: boolean;
  unidade_medida: string;
  foto_path: string | null;
  saldos: CustodyBalanceOption[];
  custodias_abertas: OpenCustodySummary[];
}

export interface CustodyOperationView {
  id: string;
  empresa_id: string;
  material_id: string;
  material_nome: string;
  material_codigo: string;
  material_identificador: string | null;
  foto_path: string | null;
  tipo_controle: MaterialControlType;
  quantidade_retirada: number;
  quantidade_devolvida: number;
  quantidade_baixada: number;
  quantidade_pendente: number;
  localizacao_origem_id: string;
  localizacao_origem_nome: string;
  retirada_em: string;
  previsao_retorno: string | null;
  executado_por: string;
  executor_nome: string;
  responsavel_tipo: CustodyResponsibleType;
  responsavel_usuario_id: string | null;
  responsavel_funcionario_id: string | null;
  responsavel_nome: string;
  finalidade: CustodyPurpose;
  referencia_tipo: string | null;
  referencia_id: string | null;
  observacao_saida: string | null;
  condicao_saida: CustodyCondition;
  status: CustodyStatus;
  movimento_saida_id: string;
  encerrada_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustodyOperationPage {
  items: CustodyOperationView[];
  total: number;
}

export interface CustodyEventView {
  id: string;
  tipo: "checkout" | "checkin" | "cancelamento" | "correcao";
  quantidade: number;
  localizacao_origem_nome: string | null;
  localizacao_destino_nome: string | null;
  condicao: CustodyCondition | null;
  ocorrencia: string | null;
  observacao: string | null;
  justificativa: string | null;
  status_operacional_resultante: MaterialOperationalStatus | null;
  data_efetiva: string;
  executado_por: string;
  executor_nome: string;
  movimento_estoque_id: string | null;
  created_at: string;
}

export interface CustodyIndicators {
  itens_fora: number;
  previstos_hoje: number;
  atrasados: number;
  ocorrencias: number;
}

export interface CustodyResponsibleOption {
  tipo: CustodyResponsibleType;
  id: string;
  nome: string;
  detalhe: string;
}

export interface CustodyFilters {
  search: string;
  status: "todos" | CustodyStatus;
  purpose: "todos" | CustodyPurpose;
  responsible: string;
  executorId: string;
  locationId: string;
  dateFrom: string;
  dateTo: string;
}

export interface CheckoutInput {
  materialId: string;
  quantity: number;
  originLocationId: string;
  responsibleType: CustodyResponsibleType;
  responsibleId: string;
  purpose: CustodyPurpose;
  condition: CustodyCondition;
  expectedReturn?: string | null;
  note?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  effectiveAt?: string | null;
  clientUuid: string;
}

export interface CheckinInput {
  custodyId: string;
  quantity: number;
  destinationLocationId: string;
  returnCondition: CustodyCondition;
  note?: string;
  occurrence?: string;
  effectiveAt?: string | null;
  clientUuid: string;
}

export interface CancelCheckoutInput {
  custodyId: string;
  justification: string;
  effectiveAt?: string | null;
  clientUuid: string;
}

export type CustodyWriteOffClassification = Extract<
  MaterialOperationalStatus,
  "extraviado" | "avariado" | "baixado"
>;

export interface CustodyWriteOffInput {
  custodyId: string;
  quantity: number;
  classification: CustodyWriteOffClassification;
  justification: string;
  note?: string;
  effectiveAt?: string | null;
  clientUuid: string;
}
