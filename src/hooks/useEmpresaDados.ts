/**
 * ============================================================================
 * HOOK: useEmpresaDados
 * ============================================================================
 *
 * Dados cadastrais da empresa atual — a fonte que a tela "Configurações →
 * Empresa" (src/pages/ConfiguracoesEmpresa.tsx) edita e que Documentos
 * (src/pages/Documentos.tsx) lê para preencher os placeholders {{empresa_*}}.
 *
 * O escopo é SEMPRE o `empresaId` do useAuth() — nunca um id vindo de
 * input/props/URL. A RLS de `public.empresas` ("Company users view own
 * empresa") recalcula `get_user_empresa_id(auth.uid())` no servidor, então um
 * id forjado no cliente não lê outra empresa.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { EMPRESA_DADOS_SELECT, type EmpresaDados } from "@/lib/empresa-dados";

export function useEmpresaDados() {
  const { empresaId } = useAuth();

  return useQuery({
    queryKey: ["empresa-dados", empresaId],
    queryFn: async (): Promise<EmpresaDados | null> => {
      if (!empresaId) return null;
      const { data, error } = await supabase
        .from("empresas")
        .select(EMPRESA_DADOS_SELECT)
        .eq("id", empresaId)
        .maybeSingle<EmpresaDados>();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!empresaId,
  });
}
