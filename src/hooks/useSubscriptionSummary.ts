/**
 * ============================================================================
 * HOOK: useSubscriptionSummary
 * ============================================================================
 *
 * Resumo consolidado da assinatura da empresa: plano base + módulos ativos.
 * Calcula capacidades, valores e status de forma centralizada.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { computeConsolidatedCapabilities } from "@/lib/plan-helpers";
import type { SubscriptionSummary, PlanCapabilities } from "@/types/subscription";
import { useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";

export function useSubscriptionSummary(): SubscriptionSummary & { isLoading: boolean } {
  const { empresaId } = useAuth();
  const { activeModules, isLoading: loadingModules } = useCompanyModules();

  // Busca empresa
  const { data: empresa, isLoading: loadingEmpresa } = useQuery({
    queryKey: ["subscription-empresa", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data, error } = await supabase
        .from("empresas")
        .select("plano_id, plano, plano_bloqueado, status, status_pagamento, vencimento, trial_expires_at, precisa_escolher_plano")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });

  // Busca plano base
  const { data: planoBase = null, isLoading: loadingPlano } = useQuery({
    queryKey: ["subscription-plano-base", empresa?.plano_id],
    queryFn: async () => {
      if (!empresa?.plano_id) return null;
      const { data, error } = await supabase
        .from("planos")
        .select("*")
        .eq("id", empresa.plano_id)
        .single();
      if (error) throw error;
      return data as Tables<"planos">;
    },
    enabled: !!empresa?.plano_id,
  });

  const summary: SubscriptionSummary = useMemo(() => {
    const now = new Date();
    const hasPlano = !!empresa?.plano_id;
    const isOnTrial = !hasPlano && !!empresa?.trial_expires_at;
    const isExpired = hasPlano
      ? !!empresa?.vencimento && new Date(empresa.vencimento) < now
      : !!empresa?.trial_expires_at && new Date(empresa.trial_expires_at) < now;
    const isReadOnly =
      !!empresa?.plano_bloqueado || isExpired || empresa?.status === "inativo";

    // Capacidades consolidadas
    const capabilities = computeConsolidatedCapabilities(planoBase, activeModules);

    // Valores
    const valorBase = planoBase ? Number(planoBase.valor) : 0;
    const valorModulos = activeModules.reduce(
      (sum, m) => sum + Number(m.valor_cobrado || 0),
      0,
    );

    return {
      planoBase,
      planoLabel: empresa?.plano ?? null,
      activeModules,
      valorBase,
      valorModulos,
      valorTotal: valorBase + valorModulos,
      capabilities,
      vencimento: empresa?.vencimento ?? null,
      isOnTrial,
      isExpired,
      isReadOnly,
      needsPlanSelection: !!empresa?.precisa_escolher_plano,
    };
  }, [empresa, planoBase, activeModules]);

  return {
    ...summary,
    isLoading: loadingEmpresa || loadingPlano || loadingModules,
  };
}
