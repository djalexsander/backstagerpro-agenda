// Backup service: data gathering, creation, restore, cleanup

import { supabase } from "@/integrations/supabase/client";
import {
  buildBackupPayload,
  MAX_AUTO_BACKUPS,
  prepareBackupForRestore,
  setLastLocalBackupTime,
  type BackupPayload,
  type BackupData,
} from "./backup-utils";
import { format } from "date-fns";
import {
  assertBackupAdministrator,
} from "./backup-security";
import type { AppRole } from "./user-role";
import type {
  Json,
  TablesInsert,
} from "@/integrations/supabase/types";

/**
 * Gathers all backup-worthy data for a given empresa through
 * gather_company_backup_data, a SECURITY DEFINER RPC.
 *
 * This used to be ~20 direct client-side `.from(table).select()` calls,
 * each subject to normal RLS. That was a real gap for an authorized
 * backup: every one of these tables' SELECT policies is gated by
 * can_read_company_module/company_has_active_module for a specific
 * subscribed module, so a company whose module lapsed or was deactivated
 * after the data was created would have that table silently omitted from
 * its own backup - no error, just fewer rows than actually exist. The RPC
 * re-checks the same admin_empresa/master_admin bar those client calls
 * relied on (now enforced server-side too, not only by
 * assertBackupAdministrator below), resolves the caller's company itself,
 * and reads every collection directly - unaffected by which modules are
 * currently active. See the migration's own comment
 * (20260818120000_extend_operational_core_backup.sql) for the full
 * rationale and which specific tables were actually affected.
 *
 * dateStart/dateEnd only scope events and everything event-owned, exactly
 * as before; every standing company collection (clientes, funcionarios,
 * document_templates, and the sixteen P1-10B operational-core tables) is
 * always returned in full - a backup of "March's events" should still
 * carry the company's complete client/material/stock/etc. state, not a
 * partial one.
 */
async function gatherBackupData(
  empresaId: string,
  dateStart?: string,
  dateEnd?: string
): Promise<BackupData> {
  const { data, error } = await supabase.rpc("gather_company_backup_data", {
    _empresa_id: empresaId,
    _date_start: dateStart || null,
    _date_end: dateEnd || null,
  });
  if (error) throw error;
  return data as unknown as BackupData;
}

/**
 * Creates a backup record in the database.
 */
export async function createBackup(
  empresaId: string,
  tipo: "auto" | "manual",
  role: AppRole | null,
  dateStart?: string,
  dateEnd?: string
) {
  assertBackupAdministrator(role);
  const data = await gatherBackupData(empresaId, dateStart, dateEnd);

  if (!data.eventos.length && tipo === "auto") {
    return null; // Don't create empty auto backups
  }

  const payload = buildBackupPayload(empresaId, tipo, data, dateStart, dateEnd);
  const nome = `Backup ${tipo === "auto" ? "Auto " : ""}${format(new Date(), "dd-MM-yyyy HH:mm")}`;

  const backupRow: TablesInsert<"backups"> = {
    empresa_id: empresaId,
    nome,
    tipo,
    periodo_inicio: dateStart || null,
    periodo_fim: dateEnd || null,
    payload: payload as unknown as Json,
  };
  const { error } = await supabase.from("backups").insert(backupRow);

  if (error) throw error;

  setLastLocalBackupTime(empresaId);

  if (tipo === "auto") {
    await cleanupAutoBackups(empresaId);
  }

  return payload;
}

/**
 * Restores a backup, replacing all current empresa data.
 */
export async function restoreBackup(
  empresaId: string,
  rawPayload: unknown,
  role: AppRole | null,
) {
  assertBackupAdministrator(role);
  const payload = prepareBackupForRestore(rawPayload, empresaId);

  try {
    const { error } = await supabase.rpc("restore_company_backup", {
      _empresa_id: empresaId,
      _payload: payload as unknown as Json,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[BackupService] Erro no restore:", err);
    throw new Error(`Falha ao restaurar backup: ${(err as Error).message}`);
  }
}

/**
 * Keeps only the latest MAX_AUTO_BACKUPS auto backups.
 */
async function cleanupAutoBackups(empresaId: string) {
  const { data, error } = await supabase
    .from("backups")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("tipo", "auto")
    .order("created_at", { ascending: false });
  if (error) throw error;

  if (data && data.length > MAX_AUTO_BACKUPS) {
    const toDelete = data.slice(MAX_AUTO_BACKUPS).map((backup) => backup.id);
    const { error: deleteError } = await supabase
      .from("backups")
      .delete()
      .in("id", toDelete);
    if (deleteError) throw deleteError;
  }
}
