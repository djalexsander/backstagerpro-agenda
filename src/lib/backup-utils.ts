// Backup utility functions: validation, normalization, types
import type { Tables } from "@/integrations/supabase/types";

export const BACKUP_VERSION = "1.0";
export const BACKUP_SYSTEM = "Backstage Pro";
export const MAX_AUTO_BACKUPS = 10;
export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const LOCAL_STORAGE_KEY = "backstage_lastBackupAt";

export interface BackupMeta {
  empresa_id: string;
  tipo: "auto" | "manual";
  data_backup: string;
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
}

export interface BackupData {
  eventos: Tables<"events">[];
  event_days: Tables<"event_days">[];
  event_files: Tables<"event_files">[];
  financials: Tables<"financials">[];
}

export interface BackupPayload {
  versao: string;
  sistema: string;
  meta: BackupMeta;
  data: BackupData;
}

// Legacy format (pre-refactor)
interface LegacyPayload {
  empresa_id?: string;
  data_backup?: string;
  eventos?: BackupData["eventos"];
  event_days?: BackupData["event_days"];
  event_files?: BackupData["event_files"];
  financials?: BackupData["financials"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes any backup payload (legacy or new) into the current format.
 */
export function normalizeBackup(
  raw: unknown,
  fallbackEmpresaId?: string,
): BackupPayload {
  // Already in new format
  if (isRecord(raw) && raw.versao && raw.meta && raw.data) {
    return raw as unknown as BackupPayload;
  }

  // Legacy format conversion
  const legacy = (isRecord(raw) ? raw : {}) as LegacyPayload;
  return {
    versao: BACKUP_VERSION,
    sistema: BACKUP_SYSTEM,
    meta: {
      empresa_id: legacy.empresa_id || fallbackEmpresaId || "",
      tipo: "manual",
      data_backup: legacy.data_backup || new Date().toISOString(),
    },
    data: {
      eventos: legacy.eventos || [],
      event_days: legacy.event_days || [],
      event_files: legacy.event_files || [],
      financials: legacy.financials || [],
    },
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a backup payload structure.
 */
export function validateBackup(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload) {
    return { valid: false, errors: ["Payload vazio ou nulo."] };
  }

  // Try normalizing first
  const normalized = normalizeBackup(payload);

  if (!normalized.versao) errors.push("Campo 'versao' ausente.");
  if (!normalized.meta) errors.push("Campo 'meta' ausente.");
  if (!normalized.data) errors.push("Campo 'data' ausente.");

  if (normalized.meta && !normalized.meta.empresa_id) {
    errors.push("Meta: 'empresa_id' ausente.");
  }

  if (normalized.data) {
    if (!Array.isArray(normalized.data.eventos)) errors.push("'data.eventos' não é um array.");
    if (!Array.isArray(normalized.data.event_days)) errors.push("'data.event_days' não é um array.");
    if (!Array.isArray(normalized.data.event_files)) errors.push("'data.event_files' não é um array.");
    if (!Array.isArray(normalized.data.financials)) errors.push("'data.financials' não é um array.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns a summary of the backup contents for preview.
 */
export function getBackupSummary(payload: BackupPayload) {
  return {
    eventos: payload.data.eventos?.length ?? 0,
    eventDays: payload.data.event_days?.length ?? 0,
    eventFiles: payload.data.event_files?.length ?? 0,
    financials: payload.data.financials?.length ?? 0,
  };
}

/**
 * Builds a new-format backup payload from raw data.
 */
export function buildBackupPayload(
  empresaId: string,
  tipo: "auto" | "manual",
  data: BackupData,
  periodoInicio?: string | null,
  periodoFim?: string | null
): BackupPayload {
  return {
    versao: BACKUP_VERSION,
    sistema: BACKUP_SYSTEM,
    meta: {
      empresa_id: empresaId,
      tipo,
      data_backup: new Date().toISOString(),
      periodo_inicio: periodoInicio || null,
      periodo_fim: periodoFim || null,
    },
    data,
  };
}

/**
 * Validates a backup and forces every restored row into the selected tenant.
 * This pure step runs before any destructive database operation.
 */
export function prepareBackupForRestore(
  rawPayload: unknown,
  empresaId: string,
): BackupPayload {
  const hasCurrentStructure =
    isRecord(rawPayload) &&
    isRecord(rawPayload.meta) &&
    isRecord(rawPayload.data);
  const hasLegacyStructure =
    isRecord(rawPayload) &&
    ["eventos", "event_days", "event_files", "financials"].some((key) =>
      Array.isArray(rawPayload[key]),
    );

  if (!hasCurrentStructure && !hasLegacyStructure) {
    throw new Error("Backup inválido: estrutura não reconhecida");
  }

  const normalized = normalizeBackup(rawPayload, empresaId);
  const validation = validateBackup(normalized);

  if (!validation.valid) {
    throw new Error(`Backup inválido: ${validation.errors.join(", ")}`);
  }

  return {
    ...normalized,
    meta: { ...normalized.meta, empresa_id: empresaId },
    data: {
      eventos: normalized.data.eventos.map((event) => ({
        ...event,
        empresa_id: empresaId,
      })),
      event_days: normalized.data.event_days.map((day) => ({
        ...day,
        empresa_id: empresaId,
      })),
      event_files: normalized.data.event_files.map((file) => ({
        ...file,
        empresa_id: empresaId,
      })),
      financials: normalized.data.financials.map((financial) => ({
        ...financial,
        empresa_id: empresaId,
      })),
    },
  };
}

/**
 * Check localStorage for last backup time.
 */
export function getLastLocalBackupTime(empresaId: string): number {
  try {
    const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY}_${empresaId}`);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

export function setLastLocalBackupTime(empresaId: string) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY}_${empresaId}`, Date.now().toString());
  } catch {
    // localStorage unavailable
  }
}
