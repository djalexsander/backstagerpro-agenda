import { supabase } from "@/integrations/supabase/client";
import type { ImportPayloadEvent } from "@/lib/agenda-import";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

// As RPCs de 20260827110000_agenda_import_traceability.sql não estão no
// types.ts gerado (sem Supabase CLI local) - mesmo cast já usado em
// push-notifications-service.ts / user-module-permissions-service.ts.
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

export interface ImportAgendaResult {
  imported: number;
  skipped: number;
}

/**
 * Consulta quais `source_event_id` (de `sourceSystem`) já foram importados
 * pela empresa ativa. Usado na prévia de duplicidades. A empresa é resolvida
 * no servidor (auth.uid()); não recebe empresa_id.
 */
export async function fetchAlreadyImportedSourceEventIds(
  sourceSystem: string,
  sourceEventIds: string[],
): Promise<Set<string>> {
  if (sourceEventIds.length === 0) return new Set();
  const { data, error } = await callRpc("listar_eventos_agenda_ja_importados", {
    _source_system: sourceSystem,
    _source_event_ids: sourceEventIds,
  });
  if (error) {
    console.error("[agenda-import-service] listar_eventos_agenda_ja_importados", error);
    throw new Error(error.message || "Falha ao verificar eventos já importados.");
  }
  const rows = (data ?? []) as Array<{ source_event_id: string }>;
  return new Set(rows.map((row) => row.source_event_id));
}

/**
 * Importa o lote via RPC transacional. Eventos já importados são ignorados
 * pelo servidor (dedupe por empresa + source_system + source_event_id).
 */
export async function importAgendaEvents(
  sourceSystem: string,
  events: ImportPayloadEvent[],
): Promise<ImportAgendaResult> {
  const { data, error } = await callRpc("importar_agenda_eventos", {
    _source_system: sourceSystem,
    _eventos: events,
  });
  if (error) {
    console.error("[agenda-import-service] importar_agenda_eventos", error);
    throw new Error(error.message || "Falha ao importar a agenda.");
  }
  const result = (data ?? {}) as Partial<ImportAgendaResult>;
  return {
    imported: Number(result.imported ?? 0),
    skipped: Number(result.skipped ?? 0),
  };
}
