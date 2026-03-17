// Backup service: data gathering, creation, restore, cleanup

import { supabase } from "@/integrations/supabase/client";
import {
  buildBackupPayload,
  normalizeBackup,
  validateBackup,
  MAX_AUTO_BACKUPS,
  setLastLocalBackupTime,
  type BackupPayload,
  type BackupData,
} from "./backup-utils";
import { format } from "date-fns";

/**
 * Gathers all backup-worthy data for a given empresa.
 */
export async function gatherBackupData(
  empresaId: string,
  dateStart?: string,
  dateEnd?: string
): Promise<BackupData> {
  let eventsQuery = supabase.from("events").select("*").eq("empresa_id", empresaId);
  if (dateStart) eventsQuery = eventsQuery.gte("date", dateStart);
  if (dateEnd) eventsQuery = eventsQuery.lte("date", dateEnd);
  const { data: eventos } = await eventsQuery;

  const eventIds = (eventos || []).map((e: any) => e.id);

  let eventDays: any[] = [];
  let eventFiles: any[] = [];
  let financials: any[] = [];

  if (eventIds.length > 0) {
    const [daysRes, filesRes, finRes] = await Promise.all([
      supabase.from("event_days").select("*").in("event_id", eventIds),
      supabase.from("event_files").select("*").in("event_id", eventIds),
      supabase.from("financials").select("*").in("event_id", eventIds),
    ]);
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
  dateStart?: string,
  dateEnd?: string
) {
  const data = await gatherBackupData(empresaId, dateStart, dateEnd);

  if (!data.eventos.length && tipo === "auto") {
    return null; // Don't create empty auto backups
  }

  const payload = buildBackupPayload(empresaId, tipo, data, dateStart, dateEnd);
  const nome = `Backup ${tipo === "auto" ? "Auto " : ""}${format(new Date(), "dd-MM-yyyy HH:mm")}`;

  const { error } = await supabase.from("backups").insert({
    empresa_id: empresaId,
    nome,
    tipo,
    periodo_inicio: dateStart || null,
    periodo_fim: dateEnd || null,
    payload: payload as any,
  } as any);

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
export async function restoreBackup(empresaId: string, rawPayload: any) {
  const normalized = normalizeBackup(rawPayload, empresaId);
  const validation = validateBackup(normalized);

  if (!validation.valid) {
    throw new Error(`Backup inválido: ${validation.errors.join(", ")}`);
  }

  // Override empresa_id for safety
  const payload = {
    ...normalized,
    meta: { ...normalized.meta, empresa_id: empresaId },
    data: {
      eventos: normalized.data.eventos.map((e: any) => ({ ...e, empresa_id: empresaId })),
      event_days: normalized.data.event_days.map((d: any) => ({ ...d, empresa_id: empresaId })),
      event_files: normalized.data.event_files.map((f: any) => ({ ...f, empresa_id: empresaId })),
      financials: normalized.data.financials.map((f: any) => ({ ...f, empresa_id: empresaId })),
    },
  };

  try {
    // 1. Delete current data (order matters for FK constraints)
    const { data: currentEvents } = await supabase.from("events").select("id").eq("empresa_id", empresaId);
    const currentIds = (currentEvents || []).map((e: any) => e.id);

    if (currentIds.length > 0) {
      await supabase.from("event_files").delete().in("event_id", currentIds);
      await supabase.from("event_days").delete().in("event_id", currentIds);
      await supabase.from("financials").delete().in("event_id", currentIds);
    }
    await supabase.from("events").delete().eq("empresa_id", empresaId);

    // 2. Insert backup data in correct order
    if (payload.data.eventos.length) {
      const { error } = await supabase.from("events").insert(payload.data.eventos);
      if (error) throw error;
    }
    if (payload.data.event_days.length) {
      const { error } = await supabase.from("event_days").insert(payload.data.event_days);
      if (error) throw error;
    }
    if (payload.data.event_files.length) {
      const { error } = await supabase.from("event_files").insert(payload.data.event_files);
      if (error) throw error;
    }
    if (payload.data.financials.length) {
      const { error } = await supabase.from("financials").insert(payload.data.financials);
      if (error) throw error;
    }
  } catch (err) {
    console.error("[BackupService] Erro no restore:", err);
    throw new Error(`Falha ao restaurar backup: ${(err as Error).message}`);
  }
}

/**
 * Keeps only the latest MAX_AUTO_BACKUPS auto backups.
 */
export async function cleanupAutoBackups(empresaId: string) {
  const { data } = await supabase
    .from("backups")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("tipo", "auto")
    .order("created_at", { ascending: false });

  if (data && data.length > MAX_AUTO_BACKUPS) {
    const toDelete = data.slice(MAX_AUTO_BACKUPS).map((b: any) => b.id);
    await supabase.from("backups").delete().in("id", toDelete);
  }
}
