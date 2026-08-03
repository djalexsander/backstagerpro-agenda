export type MaintenanceType = "corretiva" | "preventiva" | "inspecao";
export type MaintenanceStatus =
  | "aberta"
  | "aguardando_analise"
  | "em_manutencao"
  | "aguardando_peca"
  | "concluida"
  | "cancelada";
export type MaintenancePriority = "baixa" | "normal" | "alta" | "critica";
export type MaintenanceOrigin = "manual" | "checkin" | "inspecao" | "preventiva" | "defeito_operacional";
export type MaintenanceExecution = "interna" | "externa";

export interface MaintenanceMaterialOption {
  id: string;
  nome: string;
  codigo_interno: string;
  identificador_unico: string;
  codigo_barras: string | null;
  conteudo_qr_code: string | null;
  numero_serie: string | null;
  numero_patrimonio: string | null;
  tipo_controle: "individual" | "quantidade";
  unidade_medida: string;
  quantidade: number;
  quantidade_em_manutencao: number;
  status_operacional: string;
  foto_path: string | null;
}

export interface MaintenanceListItem {
  id: string;
  empresa_id: string;
  material_id: string;
  numero: string;
  tipo: MaintenanceType;
  status: MaintenanceStatus;
  prioridade: MaintenancePriority;
  origem: MaintenanceOrigin;
  quantidade_afetada: number;
  material_nome: string;
  material_codigo: string;
  identificador_unico: string | null;
  numero_serie: string | null;
  numero_patrimonio: string | null;
  responsavel_nome: string | null;
  aberta_em: string;
  previsao_conclusao_em: string | null;
  custo_total: number;
  atrasada: boolean;
}

export interface MaintenanceSupply {
  id: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  custo_unitario: number;
  custo_total: number;
  material_id: string | null;
  created_at: string;
}

export interface MaintenanceHistoryEvent {
  id: string;
  tipo: string;
  status_anterior: MaintenanceStatus | null;
  status_novo: MaintenanceStatus | null;
  descricao: string;
  dados: Record<string, unknown>;
  executor_nome: string;
  data_efetiva: string;
}

export interface MaintenanceDetail extends MaintenanceListItem {
  defeito_relatado: string;
  diagnostico: string | null;
  servico_executado: string | null;
  condicao_entrada: string | null;
  condicao_saida: string | null;
  observacoes: string | null;
  modalidade_execucao: MaintenanceExecution;
  responsavel_tipo: "usuario" | "funcionario" | null;
  responsavel_usuario_id: string | null;
  responsavel_funcionario_id: string | null;
  fornecedor_externo: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  cancelada_em: string | null;
  intervalo_preventivo_dias: number | null;
  proxima_preventiva_em: string | null;
  custo_mao_obra: number;
  custo_pecas: number;
  custo_outros: number;
  updated_at: string;
  material: MaintenanceMaterialOption;
  insumos: MaintenanceSupply[];
  historico: MaintenanceHistoryEvent[];
  checkin_origem: {
    id: string;
    custodia_id: string;
    condicao: string;
    ocorrencia: string | null;
    observacao: string | null;
    data_efetiva: string;
  } | null;
}

export interface MaintenanceFilters {
  search: string;
  status: MaintenanceStatus | "todos";
  type: MaintenanceType | "todos";
  priority: MaintenancePriority | "todos";
  responsible: string;
  materialId: string;
  dateFrom: string;
  dateTo: string;
}

export interface MaintenanceIndicators {
  abertas: number;
  em_manutencao: number;
  aguardando_peca: number;
  preventivas_proximas: number;
  atrasadas: number;
}

export interface CreateMaintenanceInput {
  materialId: string;
  type: MaintenanceType;
  priority: MaintenancePriority;
  origin: MaintenanceOrigin;
  defect: string;
  affectedQuantity: number;
  responsibleType?: "usuario" | "funcionario";
  responsibleId?: string;
  expectedCompletion?: string;
  entryCondition?: string;
  notes?: string;
  execution: MaintenanceExecution;
  externalSupplier?: string;
  preventiveIntervalDays?: number;
  custodyEventId?: string;
  clientUuid: string;
}

export interface CheckinMaintenanceSuggestion {
  evento_id: string;
  custodia_id: string;
  material_id: string;
  quantidade: number;
  condicao: string;
  defeito_relatado: string;
}
