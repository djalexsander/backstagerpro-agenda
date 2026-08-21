import type { MaterialControlType, MaterialOperationalStatus } from "./material-types";
import type { CustodyPurpose } from "./checkin-checkout-types";
import type { RfidTagStatus } from "./rfid-types";

// ============================================================================
// RASTREABILIDADE DE MATERIAIS — TIPOS CENTRAIS
// ============================================================================
//
// buscar_rastreabilidade_materiais/obter_rastreabilidade_material ainda não
// estão nos tipos gerados do Supabase (mesmo padrão não tipado já usado por
// rfid-service.ts/rfid-types.ts - sem instância local de Postgres/Supabase
// CLI, os formatos de linha são declarados aqui à mão e ficam defasados até
// a migration ser aplicada e os tipos regenerados).

export type TraceabilityRentalSummary = {
  locacao_id: string;
  locacao_numero: string;
  cliente_id: string;
  cliente_nome: string;
} | null;

export type TraceabilityEventSummary = {
  evento_id: string;
  evento_nome: string;
  evento_data: string;
} | null;

/**
 * Espelha o retorno de resumo_situacao_material (SQL) - discriminado por
 * `situacao`. 'locado' = custódia com finalidade 'locacao' (vinculada a uma
 * locação); 'emprestado' = qualquer outra finalidade de custódia aberta
 * (uso_interno/funcionario/evento/transferencia_operacional/outro). Não há
 * estado "em trânsito": não é modelado em nenhuma tabela deste domínio.
 */
export type TraceabilitySituacao =
  | {
      situacao: "em_manutencao";
      manutencao_numero: string;
      manutencao_status: string;
      manutencao_aberta_em: string;
      manutencao_previsao_conclusao_em: string | null;
      manutencao_responsavel_nome: string | null;
    }
  | {
      situacao: "locado" | "emprestado";
      custodia_id: string;
      custodia_status: "aberta" | "parcial";
      finalidade: CustodyPurpose;
      retirada_em: string;
      previsao_retorno: string | null;
      atrasado: boolean;
      retirado_por: string;
      liberado_por: string;
      locacao: TraceabilityRentalSummary;
      evento: TraceabilityEventSummary;
    }
  | {
      situacao: Exclude<MaterialOperationalStatus, "disponivel" | "em_manutencao">;
      justificativa_status: string | null;
    }
  | {
      situacao: "disponivel";
      localizacoes: { localizacao_id: string; localizacao_codigo: string; localizacao_nome: string }[];
      ultimo_retorno_em: string | null;
      ultimo_retorno_recebido_por: string | null;
    };

export interface TraceabilitySearchResult {
  id: string;
  nome: string;
  codigo_interno: string;
  numero_patrimonio: string | null;
  numero_serie: string | null;
  codigo_barras: string | null;
  identificador_unico: string;
  status_operacional: MaterialOperationalStatus;
  ativo: boolean;
  foto_path: string | null;
  resumo: TraceabilitySituacao;
}

export interface MaterialTraceabilitySearchPage {
  items: TraceabilitySearchResult[];
  total: number;
}

export type TraceabilityTimelineEntryType =
  | "checkout"
  | "checkin"
  | "cancelamento"
  | "correcao"
  | "manutencao_aberta"
  | "manutencao_concluida"
  | "manutencao_cancelada"
  | "movimentacao_estoque"
  | "rfid_tag_vinculada"
  | "rfid_tag_desativada";

/** Campos variam por `tipo` - todos opcionais de propósito, ver a migration para o mapeamento exato. */
export interface TraceabilityTimelineDetails {
  custodia_id?: string;
  quantidade?: number;
  condicao?: string | null;
  ocorrencia?: string | null;
  observacao?: string | null;
  justificativa?: string | null;
  executor_nome?: string;
  localizacao_origem_nome?: string | null;
  localizacao_destino_nome?: string | null;
  responsavel_nome?: string;
  finalidade?: CustodyPurpose;
  locacao_numero?: string | null;
  cliente_nome?: string | null;
  evento_nome?: string | null;
  evento_data?: string | null;
  numero?: string;
  tipo?: string;
  defeito_relatado?: string;
  servico_executado?: string | null;
  custo_total?: number;
  tipo_movimentacao?: string;
  motivo?: string | null;
  origem_modulo?: string;
  epc?: string;
  status?: string;
  motivo_desativacao?: string | null;
}

export interface TraceabilityTimelineEntry {
  data: string;
  tipo: TraceabilityTimelineEntryType;
  detalhes: TraceabilityTimelineDetails;
}

export interface TraceabilityMaterialCore {
  id: string;
  nome: string;
  codigo_interno: string;
  numero_patrimonio: string | null;
  numero_serie: string | null;
  codigo_barras: string | null;
  identificador_unico: string;
  conteudo_qr_code: string | null;
  categoria_nome: string | null;
  marca: string | null;
  modelo: string | null;
  unidade_medida: string;
  tipo_controle: MaterialControlType;
  status_operacional: MaterialOperationalStatus;
  ativo: boolean;
  foto_path: string | null;
}

export interface TraceabilityRfidTag {
  id: string;
  epc: string;
  status: RfidTagStatus;
  vinculada_em: string;
  desativada_em: string | null;
  motivo_desativacao: string | null;
}

export interface TraceabilityPermissoes {
  estoque: boolean;
  custodia: boolean;
  locacao: boolean;
  manutencao: boolean;
  rfid: boolean;
}

export interface MaterialTraceabilityDetail {
  material: TraceabilityMaterialCore;
  resumo: TraceabilitySituacao;
  /** null quando a empresa não tem o módulo RFID ativo (ou o usuário não tem grant de visualizar) - nunca um array vazio nesse caso. */
  rfid_tags: TraceabilityRfidTag[] | null;
  timeline: TraceabilityTimelineEntry[];
  permissoes: TraceabilityPermissoes;
}
