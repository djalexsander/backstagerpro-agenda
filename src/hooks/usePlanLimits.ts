import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface PlanLimits {
  maxUsuarios: number | null;
  maxEventos: number | null;
  currentUsuarios: number;
  currentEventos: number;
  canCreateUser: boolean;
  canCreateEvent: boolean;
  isLoading: boolean;
}

export function usePlanLimits(): PlanLimits {
  const { empresaId, isMasterAdmin } = useAuth();

  const { data: planoData, isLoading: loadingPlano } = useQuery({
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
        .select("max_usuarios, max_eventos")
        .eq("id", empresa.plano_id)
        .single();
      return plano;
    },
    enabled: !!empresaId && !isMasterAdmin,
  });

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

  if (isMasterAdmin) {
    return {
      maxUsuarios: null,
      maxEventos: null,
      currentUsuarios: 0,
      currentEventos: 0,
      canCreateUser: true,
      canCreateEvent: true,
      isLoading: false,
    };
  }

  const maxUsuarios = planoData?.max_usuarios ?? null;
  const maxEventos = planoData?.max_eventos ?? null;

  return {
    maxUsuarios,
    maxEventos,
    currentUsuarios,
    currentEventos,
    canCreateUser: maxUsuarios === null || currentUsuarios < maxUsuarios,
    canCreateEvent: maxEventos === null || currentEventos < maxEventos,
    isLoading: loadingPlano || loadingEventos || loadingUsuarios,
  };
}
