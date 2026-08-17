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
 * Gathers all backup-worthy data for a given empresa.
 */
async function gatherBackupData(
  empresaId: string,
  dateStart?: string,
  dateEnd?: string
): Promise<BackupData> {
  let eventsQuery = supabase.from("events").select("*").eq("empresa_id", empresaId);
  if (dateStart) eventsQuery = eventsQuery.gte("date", dateStart);
  if (dateEnd) eventsQuery = eventsQuery.lte("date", dateEnd);
  const { data: eventos, error: eventsError } = await eventsQuery;
  if (eventsError) throw eventsError;

  const eventIds = (eventos || []).map((event) => event.id);

  let eventDays: BackupData["event_days"] = [];
  let eventFiles: BackupData["event_files"] = [];
  let financials: BackupData["financials"] = [];

  if (eventIds.length > 0) {
    const [daysRes, filesRes, finRes] = await Promise.all([
      supabase.from("event_days").select("*").in("event_id", eventIds),
      supabase.from("event_files").select("*").in("event_id", eventIds),
      supabase.from("financials").select("*").in("event_id", eventIds),
    ]);
    if (daysRes.error) throw daysRes.error;
    if (filesRes.error) throw filesRes.error;
    if (finRes.error) throw finRes.error;
    eventDays = daysRes.data || [];
    eventFiles = filesRes.data || [];
    financials = finRes.data || [];
  }

  return {
    eventos: eventos || [],
    event_days: eventDays,
    event_files: eventFiles,
    financials: financials,
  };
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
