import type { Tables } from "@/integrations/supabase/types";
import type { Material } from "./material-types";

export type StockLocation = Tables<"estoque_localizacoes">;
export type StockBalance = Tables<"estoque_saldos">;
export type StockMovement = Tables<"estoque_movimentacoes">;
export type StockLocationType = StockLocation["tipo"];
export type StockMovementType = StockMovement["tipo_movimentacao"];

export interface StockBalanceWithLocation extends StockBalance {
  localizacao: StockLocation | null;
}

export interface StockMaterial extends Material {
  saldos: StockBalanceWithLocation[];
}

export interface StockMaterialPage {
  items: StockMaterial[];
  total: number;
}

export interface StockMovementView extends StockMovement {
  material_nome: string;
  material_codigo: string;
  localizacao_origem_nome: string | null;
  localizacao_destino_nome: string | null;
  usuario_nome: string;
}

export interface StockMovementPage {
  items: StockMovementView[];
  total: number;
}

export interface StockIndicators {
  materiais: number;
  unidades: number;
  abaixoMinimo: number;
  semSaldo: number;
  localizacoesAtivas: number;
  movimentacoesRecentes: number;
}

export interface StockFilters {
  search: string;
  categoryId: string;
  controlType: "todos" | Material["tipo_controle"];
  balance: "todos" | "com_saldo" | "sem_saldo" | "abaixo_minimo";
  locationId: string;
  active: "todos" | "ativos" | "inativos";
}

export interface StockMovementFilters {
  materialId?: string;
  locationId?: string;
  type?: "todos" | StockMovementType;
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  document?: string;
  sourceModule?: "todos" | StockMovement["origem_modulo"];
}

export interface StockMovementInput {
  materialId: string;
  type: "entrada" | "saida" | "transferencia" | "saldo_inicial";
  quantity: number;
  originLocationId?: string | null;
  destinationLocationId?: string | null;
  reason?: string;
  note?: string;
  referenceDocument?: string;
  effectiveAt?: string | null;
  clientUuid: string;
}

export interface StockAdjustmentInput {
  materialId: string;
  locationId: string;
  physicalQuantity: number;
  reason: string;
  justification: string;
  note?: string;
  effectiveAt?: string | null;
  clientUuid: string;
}

export interface StockReversalInput {
  movementId: string;
  justification: string;
  effectiveAt?: string | null;
  clientUuid: string;
}
