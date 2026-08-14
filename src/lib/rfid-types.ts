// ============================================================================
// RFID UHF — TIPOS CENTRAIS
// ============================================================================
//
// rfid_tags/rfid_read_sessions ainda não existem nos tipos gerados do
// Supabase (o mesmo padrão já usado por user_module_permissions - ver
// user-module-permissions-service.ts): sem instância local de
// Postgres/Supabase CLI para regenerar src/integrations/supabase/types.ts,
// os formatos de linha são declarados aqui à mão e ficam defasados até a
// migration ser aplicada e os tipos regenerados.
//
// Tipos que espelham uma linha de tabela usam snake_case (igual ao banco,
// mesma convenção de CustodyMaterialSearchResult em checkin-checkout-types.ts).
// Tipos que são contratos de domínio/hardware (RfidReadEvent e derivados)
// usam camelCase, conforme o contrato pedido para RfidReadEvent.

export type RfidTagStatus = "ativa" | "inativa" | "danificada" | "perdida";

export const RFID_TAG_STATUS_LABELS: Record<RfidTagStatus, string> = {
  ativa: "Ativa",
  inativa: "Inativa",
  danificada: "Danificada",
  perdida: "Perdida",
};

/** Espelha public.rfid_tags. Uma linha por vínculo EPC<->material, nunca apagada. */
export interface RfidTag {
  id: string;
  empresa_id: string;
  material_id: string;
  epc: string;
  status: RfidTagStatus;
  vinculada_em: string;
  desativada_em: string | null;
  motivo_desativacao: string | null;
  substituida_por_tag_id: string | null;
  ultima_leitura_em: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/** Visão de material com o estado de RFID resolvido, para telas de cadastro/detalhe. */
export interface MaterialRfidSummary {
  materialId: string;
  tagAtiva: RfidTag | null;
  historico: RfidTag[];
}

export type RfidReadSessionType =
  | "inventario"
  | "conferencia_locacao"
  | "checkout"
  | "checkin"
  | "conferencia_case"
  | "conferencia_livre";

export const RFID_READ_SESSION_TYPE_LABELS: Record<RfidReadSessionType, string> = {
  inventario: "Inventário",
  conferencia_locacao: "Conferência de locação",
  checkout: "Check-out",
  checkin: "Check-in",
  conferencia_case: "Conferência de case",
  conferencia_livre: "Conferência livre",
};

export type RfidReadSessionStatus = "em_andamento" | "concluida" | "cancelada";

/**
 * Snapshot limitado (não é log de leituras brutas) gravado ao finalizar uma
 * sessão - ver rfid-domain.ts `buildSessionResultSnapshot`. Tamanho é
 * limitado pela quantidade de materiais/EPCs envolvidos na conferência, não
 * pelo volume de leituras de rádio.
 */
export interface RfidSessionResultSnapshot {
  found: string[]; // material_id[]
  missing: string[]; // material_id[]
  unexpected: { materialId: string; epc: string }[];
  unknown: string[]; // epc[]
  inactiveTag: { materialId: string | null; epc: string }[];
}

/** Espelha public.rfid_read_sessions. Uma linha por sessão de conferência (não por leitura). */
export interface RfidReadSession {
  id: string;
  empresa_id: string;
  tipo: RfidReadSessionType;
  /** Discriminador polimórfico opcional, mesmo padrão de material_custodias.referencia_tipo/id. */
  referencia_tipo: string | null;
  referencia_id: string | null;
  dispositivo_label: string | null;
  responsavel_user_id: string;
  status: RfidReadSessionStatus;
  started_at: string;
  finished_at: string | null;
  expected_count: number | null;
  found_count: number | null;
  missing_count: number | null;
  unexpected_count: number | null;
  unknown_count: number | null;
  resultado: RfidSessionResultSnapshot | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// EVENTO NORMALIZADO DE LEITURA (independente de hardware)
// ============================================================================

/**
 * Contrato único de entrada para qualquer origem de leitura (TCP/IP, USB,
 * serial, SDK, WebSocket, HTTP, middleware local, ou simulação manual da UI
 * de laboratório). Nenhuma camada de domínio deve importar nada específico
 * de fabricante/protocolo - só isto.
 */
export interface RfidReadEvent {
  epc: string;
  antenna?: number;
  rssi?: number;
  timestamp: string;
  readerId?: string;
}

/** Agregado de deduplicação de uma tag dentro de uma sessão - ver aggregateRfidReadEvents. */
export interface RfidTagObservation {
  epc: string;
  readCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** RSSI é negativo em dBm; "melhor" = mais próximo de 0 (sinal mais forte). */
  bestRssi: number | null;
  lastRssi: number | null;
  antennas: number[];
}

// ============================================================================
// RESOLUÇÃO EPC -> MATERIAL
// ============================================================================

/**
 * Resultado de resolver um único EPC. Pré-computado pelo chamador (RPC de
 * resolução em lote ou mapa local já carregado) para manter o motor de
 * conferência puro - ver reconcileRfidRead em rfid-domain.ts.
 */
export interface EpcResolution {
  epc: string;
  materialId: string | null;
  tagStatus: RfidTagStatus | null;
}

// ============================================================================
// MOTOR DE CONFERÊNCIA EM LOTE
// ============================================================================

export interface ReconciliationFoundItem {
  materialId: string;
  epc: string;
}

export interface ReconciliationMissingItem {
  materialId: string;
}

export interface ReconciliationUnexpectedItem {
  materialId: string;
  epc: string;
}

export interface ReconciliationUnknownItem {
  epc: string;
}

/** EPC cadastrado mas cuja tag não está ativa (trocada/danificada/perdida). */
export interface ReconciliationInactiveTagItem {
  materialId: string | null;
  epc: string;
  status: RfidTagStatus;
}

/** Inconsistência estrutural nos dados de entrada (não um estado normal de conferência). */
export interface ReconciliationConflictItem {
  epc: string | null;
  materialId: string | null;
  reason: string;
}

export interface ReconciliationCounts {
  expected: number;
  found: number;
  missing: number;
  unexpected: number;
  unknown: number;
  inactiveTag: number;
  conflicts: number;
}

export interface ReconciliationResult {
  found: ReconciliationFoundItem[];
  missing: ReconciliationMissingItem[];
  unexpected: ReconciliationUnexpectedItem[];
  unknown: ReconciliationUnknownItem[];
  inactiveTag: ReconciliationInactiveTagItem[];
  conflicts: ReconciliationConflictItem[];
  counts: ReconciliationCounts;
}

// ============================================================================
// ADAPTER DE HARDWARE (interface + status)
// ============================================================================

export type RfidReaderConnectionStatus =
  | "desconectado"
  | "conectando"
  | "conectado"
  | "lendo"
  | "erro";

export interface RfidReaderStatus {
  status: RfidReaderConnectionStatus;
  readerId: string | null;
  message: string | null;
}
