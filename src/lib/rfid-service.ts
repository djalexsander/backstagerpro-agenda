import { supabase } from "@/integrations/supabase/client";
import type {
  EpcResolution,
  RfidReadSession,
  RfidReadSessionStatus,
  RfidReadSessionType,
  RfidTag,
  RfidTagStatus,
} from "./rfid-types";
import { translateRfidError } from "./rfid-errors";

// rfid_tags/rfid_read_sessions e as RPCs desta migration ainda não estão nos
// tipos gerados do Supabase - mesmo padrão não tipado já usado por
// client-service.ts (listar_clientes/salvar_cliente) e
// user-module-permissions-service.ts (list_user_module_permissions).
interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwRfidError(error: RpcError | null, context: string): never {
  const safeError = translateRfidError(error);
  console.error(`[rfid-service] ${context}`, error);
  throw safeError;
}

// ============================================================================
// TAGS
// ============================================================================

export async function linkOrReplaceTag(materialId: string, epc: string): Promise<RfidTag> {
  const { data, error } = await callRpc("rfid_link_or_replace_tag", {
    _material_id: materialId,
    _epc: epc,
  });
  if (error) throwRfidError(error, "link or replace tag");
  return data as RfidTag;
}

export async function deactivateTag(
  tagId: string,
  novoStatus: Exclude<RfidTagStatus, "ativa"> = "inativa",
  motivo?: string,
): Promise<RfidTag> {
  const { data, error } = await callRpc("rfid_deactivate_tag", {
    _tag_id: tagId,
    _novo_status: novoStatus,
    _motivo: motivo ?? null,
  });
  if (error) throwRfidError(error, "deactivate tag");
  return data as RfidTag;
}

export async function listMaterialTags(materialId: string): Promise<RfidTag[]> {
  const { data, error } = await callRpc("rfid_list_material_tags", {
    _material_id: materialId,
  });
  if (error) throwRfidError(error, "list material tags");
  return (data ?? []) as RfidTag[];
}

// ============================================================================
// RESOLUÇÃO
// ============================================================================

interface RawEpcResolution {
  epc: string;
  material_id: string | null;
  tag_status: RfidTagStatus | null;
}

/** Uma viagem ao servidor para o lote inteiro lido em uma sessão de conferência. */
export async function resolveEpcs(epcs: string[]): Promise<EpcResolution[]> {
  if (epcs.length === 0) return [];
  const { data, error } = await callRpc("rfid_resolve_epcs", { _epcs: epcs });
  if (error) throwRfidError(error, "resolve epcs");
  return ((data ?? []) as RawEpcResolution[]).map((row) => ({
    epc: row.epc,
    materialId: row.material_id,
    tagStatus: row.tag_status,
  }));
}

/**
 * Adapta resolveEpcs (em lote) ao formato de resolvedor único esperado por
 * resolveMaterialByEpc/resolveMaterialIdentifier (material-resolution.ts) -
 * para o campo de teste manual de EPC no cadastro do material, não para a
 * tela de conferência (que deve sempre chamar resolveEpcs diretamente com o
 * lote inteiro, não um EPC de cada vez).
 */
export async function resolveSingleEpc(
  epc: string,
): Promise<{ materialId: string | null; tagStatus: RfidTagStatus | null }> {
  const [result] = await resolveEpcs([epc]);
  return result ?? { materialId: null, tagStatus: null };
}

// ============================================================================
// SESSÕES DE CONFERÊNCIA
// ============================================================================

export interface StartReadSessionInput {
  tipo: RfidReadSessionType;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  dispositivoLabel?: string | null;
  expectedMaterialIds?: string[];
}

export async function startReadSession(input: StartReadSessionInput): Promise<RfidReadSession> {
  const { data, error } = await callRpc("rfid_start_read_session", {
    _tipo: input.tipo,
    _referencia_tipo: input.referenciaTipo ?? null,
    _referencia_id: input.referenciaId ?? null,
    _dispositivo_label: input.dispositivoLabel ?? null,
    _expected_material_ids: input.expectedMaterialIds ?? [],
  });
  if (error) throwRfidError(error, "start read session");
  return data as RfidReadSession;
}

export interface FinishReadSessionInput {
  sessionId: string;
  status: Exclude<RfidReadSessionStatus, "em_andamento">;
}

/** Persists normalized EPC observations before finalization. The backend
 * deduplicates and tenant-validates them; future physical readers use this
 * same batch boundary instead of sending a trusted result summary. */
export async function recordReadSessionEpcs(sessionId: string, epcs: string[]): Promise<RfidReadSession> {
  const { data, error } = await callRpc("rfid_record_read_session_epcs", {
    _session_id: sessionId,
    _epcs: epcs,
  });
  if (error) throwRfidError(error, "record read session epcs");
  return data as RfidReadSession;
}

export async function finishReadSession(input: FinishReadSessionInput): Promise<RfidReadSession> {
  const { data, error } = await callRpc("rfid_finish_read_session", {
    _session_id: input.sessionId,
    _status: input.status,
  });
  if (error) throwRfidError(error, "finish read session");
  return data as RfidReadSession;
}
