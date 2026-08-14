// Only entry point for materials-traceability data access: both exports
// call a read-only Supabase RPC. There is no direct select against
// materiais/material_custodias/material_locacoes/manutencao_ordens/
// rfid_tags from this screen - the aggregation (and every module
// entitlement check) happens server-side in
// buscar_rastreabilidade_materiais/obter_rastreabilidade_material.
import { supabase } from "@/integrations/supabase/client";
import type {
  MaterialTraceabilityDetail,
  MaterialTraceabilitySearchPage,
  TraceabilitySearchResult,
} from "./material-traceability-types";

// buscar_rastreabilidade_materiais/obter_rastreabilidade_material ainda não
// estão nos tipos gerados do Supabase - mesmo padrão não tipado já usado por
// rfid-service.ts/client-service.ts/user-module-permissions-service.ts.
interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwTraceabilityError(error: RpcError, context: string): never {
  console.error(`[material-traceability-service] ${context}`, error);
  throw new Error(error.message || "Não foi possível consultar a rastreabilidade do material.");
}

const DEFAULT_PAGE_SIZE = 20;

export async function searchMaterialTraceability(
  companyId: string,
  term: string,
  page: { limit?: number; offset?: number } = {},
): Promise<MaterialTraceabilitySearchPage> {
  const { data, error } = await callRpc("buscar_rastreabilidade_materiais", {
    _termo: term,
    _limite: page.limit ?? DEFAULT_PAGE_SIZE,
    _offset: page.offset ?? 0,
    _empresa_id: companyId,
  });
  if (error) throwTraceabilityError(error, "search");
  const rows = (data ?? []) as { item: unknown; total_count: number }[];
  return {
    items: rows.map((row) => row.item as TraceabilitySearchResult),
    total: Number(rows[0]?.total_count ?? 0),
  };
}

export async function getMaterialTraceability(
  companyId: string,
  materialId: string,
): Promise<MaterialTraceabilityDetail> {
  const { data, error } = await callRpc("obter_rastreabilidade_material", {
    _material_id: materialId,
    _empresa_id: companyId,
  });
  if (error) throwTraceabilityError(error, "detail");
  return data as MaterialTraceabilityDetail;
}
