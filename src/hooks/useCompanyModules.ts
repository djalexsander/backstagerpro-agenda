/**
 * ============================================================================
 * HOOK: useCompanyModules
 * ============================================================================
 *
 * Busca e expõe os módulos contratados pela empresa do usuário logado.
 * Inclui helper hasModule(featureKey) para verificação rápida.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  EnrichedEmpresaModule,
  ModuleCatalogRow,
  EmpresaModuleRow,
  EmpresaModuleStatus,
} from "@/types/subscription";
import { useCallback, useMemo } from "react";
import { isLifetimePlan } from "@/lib/subscription-license";
import { isCompanyModuleAccessible } from "@/lib/company-module-access";

interface UseCompanyModulesReturn {
  /** Todos os módulos da empresa (qualquer status) */
  allModules: EnrichedEmpresaModule[];
  /** Módulos com status 'active' */
  activeModules: EnrichedEmpresaModule[];
  /** Módulos com status 'pending' */
  pendingModules: EnrichedEmpresaModule[];
  /** Módulos com status 'inactive' */
  inactiveModules: EnrichedEmpresaModule[];
  /** Verifica se a empresa possui um módulo ativo pela feature_key */
  hasModule: (featureKey: string) => boolean;
  isLifetime: boolean;
  /** Catálogo completo de módulos disponíveis */
  catalog: ModuleCatalogRow[];
  /** Se está carregando */
  isLoading: boolean;
}

export function useCompanyModules(): UseCompanyModulesReturn {
  const { empresaId } = useAuth();

  const { data: isLifetime = false, isLoading: loadingLicense } = useQuery({
    queryKey: ["company-lifetime-license", empresaId],
    queryFn: async () => {
      if (!empresaId) return false;
      const { data, error } = await supabase
        .from("empresas")
        .select("planos!empresas_plano_id_fkey(periodicidade)")
        .eq("id", empresaId)
        .single();
      if (error) throw error;
      const planRelation = data.planos as
        | { periodicidade: string | null }
        | null;
      return isLifetimePlan(planRelation);
    },
    enabled: !!empresaId,
  });

  // Busca catálogo de módulos ativos
  const { data: catalog = [], isLoading: loadingCatalog } = useQuery({
    queryKey: ["module-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("module_catalog")
        .select("*")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data as ModuleCatalogRow[];
    },
  });

  // Busca módulos da empresa
  const { data: empresaModules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["empresa-modules", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from("empresa_modules")
        .select("*")
        .eq("empresa_id", empresaId);
      if (error) throw error;
      return data as EmpresaModuleRow[];
    },
    enabled: !!empresaId,
  });

  // Enriquece módulos da empresa com dados do catálogo
  const allModules: EnrichedEmpresaModule[] = useMemo(() => {
    const catalogMap = new Map(catalog.map((c) => [c.id, c]));
    return empresaModules.map((em) => ({
      ...em,
      catalog: catalogMap.get(em.module_id) ?? null,
    }));
  }, [empresaModules, catalog]);

  const filterByStatus = useCallback(
    (status: EmpresaModuleStatus) => allModules.filter((m) => m.status === status),
    [allModules],
  );

  const activeModules = useMemo(() => filterByStatus("active"), [filterByStatus]);
  const pendingModules = useMemo(() => filterByStatus("pending"), [filterByStatus]);
  const inactiveModules = useMemo(() => filterByStatus("inactive"), [filterByStatus]);

  // Set de feature_keys ativas para lookup O(1)
  const activeFeatureKeys = useMemo(
    () => new Set(activeModules.map((m) => m.catalog?.feature_key).filter(Boolean) as string[]),
    [activeModules],
  );
  const activeCatalogFeatureKeys = useMemo(
    () => new Set(catalog.map((module) => module.feature_key)),
    [catalog],
  );

  const hasModule = useCallback(
    (featureKey: string) =>
      isCompanyModuleAccessible({
        featureKey,
        activeCatalogFeatureKeys,
        activeEntitlementFeatureKeys: activeFeatureKeys,
        isLifetime,
      }),
    [activeCatalogFeatureKeys, activeFeatureKeys, isLifetime],
  );

  return {
    allModules,
    activeModules,
    pendingModules,
    inactiveModules,
    hasModule,
    isLifetime,
    catalog,
    isLoading: loadingCatalog || loadingModules || loadingLicense,
  };
}
