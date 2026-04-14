import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { computeConsolidatedCapabilities } from "@/lib/plan-helpers";
import type { EnrichedEmpresaModule, ModuleCatalogRow } from "@/types/subscription";
import type { Tables } from "@/integrations/supabase/types";

interface PlanLimits {
  maxUsuarios: number | null;
  maxEventos: number | null;
  /** Storage em GB */
  storageLimitGb: number | null;
  currentUsuarios: number;
  currentEventos: number;
  canCreateUser: boolean;
  canCreateEvent: boolean;
  /** feature_keys de módulos ativos */
  activeFeatures: string[];
  isLoading: boolean;
}

export function usePlanLimits(): PlanLimits {
  const { empresaId, isMasterAdmin } = useAuth();

  // ---------- Plano base ----------
  const { data: planoBase = null, isLoading: loadingPlano } = useQuery({
    queryKey: ["plan-limits-plano", empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const { data: empresa } = await supabase
        .from("empresas")
        .select("plano_id")
        .eq("id", empresaId)
        .single();
      if (!empresa?.plano_id) return null;
      const { data: plano } = await supabase
        .from("planos")
        .select("*")
        .eq("id", empresa.plano_id)
        .single();
      return (plano as Tables<"planos">) ?? null;
    },
    enabled: !!empresaId && !isMasterAdmin,
  });

  // ---------- Módulos ativos da empresa ----------
  const { data: activeModules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["plan-limits-modules", empresaId],
    queryFn: async () => {
      if (!empresaId) return [];

      // Busca módulos ativos da empresa
      const { data: emRows, error: emErr } = await supabase
        .from("empresa_modules")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("status", "active");
      if (emErr || !emRows?.length) return [];

      // Busca catálogo dos módulos referenciados
      const moduleIds = emRows.map((r) => r.module_id);
      const { data: catRows } = await supabase
        .from("module_catalog")
        .select("*")
        .in("id", moduleIds);

      const catMap = new Map((catRows ?? []).map((c) => [c.id, c as ModuleCatalogRow]));

      return emRows.map((em) => ({
        ...em,
        catalog: catMap.get(em.module_id) ?? null,
      })) as EnrichedEmpresaModule[];
    },
    enabled: !!empresaId && !isMasterAdmin,
  });

  // ---------- Contagens atuais ----------
  const { data: currentEventos = 0, isLoading: loadingEventos } = useQuery({
    queryKey: ["plan-limits-events-count", empresaId],
    queryFn: async () => {
      if (!empresaId) return 0;
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId);
      return count ?? 0;
    },
    enabled: !!empresaId && !isMasterAdmin,
  });

  const { data: currentUsuarios = 0, isLoading: loadingUsuarios } = useQuery({
    queryKey: ["plan-limits-users-count", empresaId],
    queryFn: async () => {
      if (!empresaId) return 0;
      const { count } = await supabase
        .from("empresa_usuarios")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId);
      return count ?? 0;
    },
    enabled: !!empresaId && !isMasterAdmin,
  });

  // ---------- Master admin bypassa tudo ----------
  if (isMasterAdmin) {
    return {
      maxUsuarios: null,
      maxEventos: null,
      storageLimitGb: null,
      currentUsuarios: 0,
      currentEventos: 0,
      canCreateUser: true,
      canCreateEvent: true,
      activeFeatures: [],
      isLoading: false,
    };
  }

  // ---------- Capacidades consolidadas (plano base + módulos) ----------
  const capabilities = computeConsolidatedCapabilities(planoBase, activeModules);

  return {
    maxUsuarios: capabilities.maxUsuarios,
    maxEventos: capabilities.maxEventos,
    storageLimitGb: capabilities.storageLimitGb,
    currentUsuarios,
    currentEventos,
    canCreateUser: capabilities.maxUsuarios === null || currentUsuarios < capabilities.maxUsuarios,
    canCreateEvent: capabilities.maxEventos === null || currentEventos < capabilities.maxEventos,
    activeFeatures: capabilities.activeFeatures,
    isLoading: loadingPlano || loadingModules || loadingEventos || loadingUsuarios,
  };
}
