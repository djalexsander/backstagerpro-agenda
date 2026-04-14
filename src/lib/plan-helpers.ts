/**
 * ============================================================================
 * BACKSTAGE PRO — HELPERS PREPARATÓRIOS PARA MODULARIZAÇÃO DE PLANOS
 * ============================================================================
 *
 * Utilitários isolados que abstraem a lógica de planos atual, sem alterar
 * nenhum comportamento existente. Servem como camada de indireção para
 * facilitar a futura migração para plano base + módulos.
 *
 * REGRA: este arquivo NÃO é importado por nenhum componente existente ainda.
 * Será conectado apenas na etapa de migração real.
 */

// ---------------------------------------------------------------------------
// Tipos do modelo atual (espelho do que existe em types.ts / DB)
// ---------------------------------------------------------------------------

export interface PlanoAtual {
  id: string;
  nome: string;
  valor: number;
  periodicidade: "mensal" | "anual" | "vitalicio";
  max_usuarios: number | null;
  max_eventos: number | null;
  storage_limit: number | null;
  trial_days: number;
  ativo: boolean;
  descricao: string | null;
}

export interface EmpresaPlanoInfo {
  plano_id: string | null;
  plano: string | null; // label textual (legado)
  plano_bloqueado: boolean;
  status: string | null;
  status_pagamento: string | null;
  vencimento: string | null;
  trial_expires_at: string | null;
  precisa_escolher_plano: boolean;
}

// ---------------------------------------------------------------------------
// Tipos preparatórios para o modelo futuro (NÃO usados ainda)
// ---------------------------------------------------------------------------

/** Representa um módulo adicional que pode ser contratado além do plano base */
export interface ModuloAdicional {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  /** Tipo de recurso que este módulo expande (ex: "eventos", "usuarios", "storage") */
  tipo_limite: "eventos" | "usuarios" | "storage" | "funcionalidade";
  /** Quanto este módulo adiciona ao limite base (null = funcionalidade on/off) */
  limite_valor: number | null;
  ativo: boolean;
}

/** Módulo contratado por uma empresa */
export interface EmpresaModulo {
  empresa_id: string;
  modulo_id: string;
  ativo: boolean;
  vencimento: string | null;
}

/** Capacidades consolidadas de uma empresa (plano base + módulos) */
export interface PlanCapabilities {
  maxUsuarios: number | null;
  maxEventos: number | null;
  storageLimit: number | null;
  /** Módulos de funcionalidade ativos (ex: "relatorios_avancados") */
  features: string[];
}

// ---------------------------------------------------------------------------
// Helpers puros (sem side effects, sem chamadas ao Supabase)
// ---------------------------------------------------------------------------

/**
 * Calcula as capacidades consolidadas a partir do plano base e módulos.
 * Hoje retorna apenas os limites do plano base (sem módulos).
 * FUTURO: somará limites de módulos contratados.
 */
export function computeCapabilities(
  planoBase: PlanoAtual | null,
  _modulos: ModuloAdicional[] = [],
  _empresaModulos: EmpresaModulo[] = [],
): PlanCapabilities {
  if (!planoBase) {
    return { maxUsuarios: null, maxEventos: null, storageLimit: null, features: [] };
  }

  // Modelo atual: retorna limites do plano sem modificação
  let maxUsuarios = planoBase.max_usuarios;
  let maxEventos = planoBase.max_eventos;
  let storageLimit = planoBase.storage_limit;
  const features: string[] = [];

  // FUTURO: iterar _empresaModulos ativos e somar limites dos _modulos correspondentes
  // for (const em of _empresaModulos.filter(m => m.ativo)) {
  //   const mod = _modulos.find(m => m.id === em.modulo_id);
  //   if (!mod || !mod.ativo) continue;
  //   if (mod.tipo_limite === "eventos" && mod.limite_valor != null) {
  //     maxEventos = (maxEventos ?? 0) + mod.limite_valor;
  //   } else if (mod.tipo_limite === "usuarios" && mod.limite_valor != null) {
  //     maxUsuarios = (maxUsuarios ?? 0) + mod.limite_valor;
  //   } else if (mod.tipo_limite === "storage" && mod.limite_valor != null) {
  //     storageLimit = (storageLimit ?? 0) + mod.limite_valor;
  //   } else if (mod.tipo_limite === "funcionalidade") {
  //     features.push(mod.nome);
  //   }
  // }

  return { maxUsuarios, maxEventos, storageLimit, features };
}

/**
 * Verifica se uma empresa está em período de trial.
 */
export function isOnTrial(empresa: EmpresaPlanoInfo): boolean {
  return !empresa.plano_id && !!empresa.trial_expires_at;
}

/**
 * Verifica se o acesso da empresa está expirado (trial ou plano).
 */
export function isAccessExpired(empresa: EmpresaPlanoInfo): boolean {
  const now = new Date();
  const hasPlano = !!empresa.plano_id;
  if (hasPlano) {
    return !!empresa.vencimento && new Date(empresa.vencimento) < now;
  }
  return !!empresa.trial_expires_at && new Date(empresa.trial_expires_at) < now;
}

/**
 * Determina se a empresa deve estar em modo read-only.
 */
export function isReadOnly(empresa: EmpresaPlanoInfo): boolean {
  return empresa.plano_bloqueado || isAccessExpired(empresa) || empresa.status === "inativo";
}

/**
 * Retorna sufixo de preço baseado na periodicidade.
 */
export function getPeriodicidadeSuffix(periodicidade: string): string {
  if (periodicidade === "vitalicio") return "";
  if (periodicidade === "anual") return "/ano";
  return "/mês";
}

/**
 * Retorna label legível da periodicidade.
 */
export function getPeriodicidadeLabel(periodicidade: string): string {
  const labels: Record<string, string> = {
    mensal: "Mensal",
    anual: "Anual",
    vitalicio: "Vitalício",
  };
  return labels[periodicidade] || "Mensal";
}

// ---------------------------------------------------------------------------
// Função consolidada para o novo modelo (plano base + módulos do banco)
// ---------------------------------------------------------------------------

import type { Tables } from "@/integrations/supabase/types";
import type { EnrichedEmpresaModule, PlanCapabilities as NewPlanCapabilities } from "@/types/subscription";

/**
 * Calcula capacidades consolidadas usando dados reais do banco:
 * plano base (tabela planos) + módulos ativos (empresa_modules + module_catalog).
 *
 * Compatível com o modelo atual (sem módulos retorna apenas limites do plano).
 */
export function computeConsolidatedCapabilities(
  planoBase: Tables<"planos"> | null,
  activeModules: EnrichedEmpresaModule[] = [],
): NewPlanCapabilities {
  let maxUsuarios: number | null = planoBase?.max_usuarios ?? null;
  let maxEventos: number | null = planoBase?.max_eventos ?? null;
  let storageLimitGb: number | null = planoBase?.storage_limit ?? null;
  const activeFeatures: string[] = [];

  for (const em of activeModules) {
    const cat = em.catalog;
    if (!cat) continue;

    if (cat.is_capacity_module) {
      if (cat.capacidade_extra_usuarios > 0) {
        maxUsuarios = (maxUsuarios ?? 0) + cat.capacidade_extra_usuarios;
      }
      if (cat.capacidade_extra_eventos > 0) {
        maxEventos = (maxEventos ?? 0) + cat.capacidade_extra_eventos;
      }
      if (cat.capacidade_extra_storage > 0) {
        storageLimitGb = (storageLimitGb ?? 0) + Number(cat.capacidade_extra_storage);
      }
    }

    // Sempre registra a feature_key como ativa
    if (cat.feature_key) {
      activeFeatures.push(cat.feature_key);
    }
  }

  return { maxUsuarios, maxEventos, storageLimitGb, activeFeatures };
}
