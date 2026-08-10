import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface MasterModuleCatalogRow {
  id: string;
  nome: string;
  descricao: string | null;
  valor: number;
  periodicidade: string;
  ativo: boolean;
  ordem: number;
  tipo_modulo: string;
  feature_key: string;
  metadata: any;
  is_capacity_module: boolean;
  capacidade_extra_usuarios: number;
  capacidade_extra_eventos: number;
  capacidade_extra_storage: number;
  destaque: boolean;
  categoria: string;
  badge: string | null;
  texto_venda: string | null;
}

export async function fetchMasterModuleCatalog(
  supabase: Pick<SupabaseClient<Database>, "from">,
): Promise<MasterModuleCatalogRow[]> {
  const tableResponse = await supabase
    .from("module_catalog")
    .select("*")
    .order("ordem", { ascending: true });

  if (tableResponse.error) {
    throw tableResponse.error;
  }

  return (tableResponse.data as MasterModuleCatalogRow[]) ?? [];
}
