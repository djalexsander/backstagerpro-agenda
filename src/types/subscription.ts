/**
 * ============================================================================
 * BACKSTAGE PRO — TIPOS CENTRALIZADOS DO SISTEMA MODULAR DE ASSINATURA
 * ============================================================================
 *
 * Tipos compartilhados entre hooks, helpers e componentes do novo modelo
 * de plano base + módulos adicionais.
 */

import type { Tables } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Tipos derivados do banco (alias semânticos)
// ---------------------------------------------------------------------------

/** Registro do catálogo de módulos */
export type ModuleCatalogRow = Tables<"module_catalog">;

/** Registro de módulo contratado por empresa */
export type EmpresaModuleRow = Tables<"empresa_modules">;

/** Registro de solicitação de módulo */
export type ModuleRequestRow = Tables<"module_requests">;

/** Registro de pagamento de módulo */
export type ModulePaymentRow = Tables<"module_payments">;

// ---------------------------------------------------------------------------
// Status possíveis (espelham os CHECK constraints do banco)
// ---------------------------------------------------------------------------

export type EmpresaModuleStatus = "active" | "inactive" | "pending" | "cancelled" | "rejected";
export type ModuleRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ModulePaymentStatus = "pending" | "paid" | "approved" | "rejected" | "cancelled";

// ---------------------------------------------------------------------------
// Módulo enriquecido (empresa_modules + dados do catálogo)
// ---------------------------------------------------------------------------

export interface EnrichedEmpresaModule extends EmpresaModuleRow {
  catalog: ModuleCatalogRow | null;
}

// ---------------------------------------------------------------------------
// Capacidades consolidadas (plano base + módulos)
// ---------------------------------------------------------------------------

export interface PlanCapabilities {
  /** null = ilimitado */
  maxUsuarios: number | null;
  maxEventos: number | null;
  /** Em GB */
  storageLimitGb: number | null;
  /** feature_keys de módulos de funcionalidade ativos */
  activeFeatures: string[];
}

// ---------------------------------------------------------------------------
// Resumo financeiro de assinatura
// ---------------------------------------------------------------------------

export interface SubscriptionSummary {
  /** Plano base (da tabela planos via empresas.plano_id) */
  planoBase: Tables<"planos"> | null;
  /** Label textual legado (empresas.plano) */
  planoLabel: string | null;
  /** Módulos ativos com dados do catálogo */
  activeModules: EnrichedEmpresaModule[];
  /** Valor mensal do plano base */
  valorBase: number;
  /** Soma dos valores cobrados dos módulos ativos */
  valorModulos: number;
  /** Valor total consolidado (base + módulos) */
  valorTotal: number;
  /** Capacidades consolidadas */
  capabilities: PlanCapabilities;
  /** Vencimento do plano */
  vencimento: string | null;
  /** Se a empresa está em trial */
  isOnTrial: boolean;
  /** Se o acesso está expirado */
  isExpired: boolean;
  /** Se está em modo read-only */
  isReadOnly: boolean;
  /** Se precisa escolher plano */
  needsPlanSelection: boolean;
}
