// Backup utility functions: validation, normalization, types
import type { Tables } from "@/integrations/supabase/types";

// 1.1 adds clientes/funcionarios/event_funcionarios/event_checklist_items/
// document_templates/generated_documents (P1-10: the backup used to only
// cover events/event_days/event_files/financials). 1.2 adds the operational
// core - categorias_materiais/materiais/estoque_localizacoes/estoque_saldos/
// estoque_movimentacoes/material_custodias/material_custodia_eventos/
// material_locacoes/material_locacao_itens/material_locacao_eventos/
// manutencao_ordens/manutencao_ordem_insumos/manutencao_ordem_eventos/
// financeiro_lancamentos/financeiro_parcelas/financeiro_recebimentos
// (P1-10B). Every one of these collections is optional on BackupData on
// purpose: a payload produced by an older client, or normalized from a
// legacy export, simply omits them, and restore_company_backup treats an
// absent key as "leave this table untouched" rather than "restore to
// empty". Never default a missing collection to `[]` anywhere in this file
// - that would silently turn into a destructive wipe for old backups once
// sent to the RPC. RFID/etiquetas, impressoras/bobinas, binários do
// Storage, usuários/permissões e módulos/assinaturas/pagamentos continuam
// fora do escopo do backup (ver Backups.tsx e o comentário no topo da
// migration 20260818120000_extend_operational_core_backup.sql).
export const BACKUP_VERSION = "1.2";
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
  // Present on every backup created from this version onward. Optional in
  // the type only to accept payloads restored/imported from before 1.1.
  clientes?: Tables<"clientes">[];
  funcionarios?: Tables<"funcionarios">[];
  event_funcionarios?: Tables<"event_funcionarios">[];
  event_checklist_items?: Tables<"event_checklist_items">[];
  document_templates?: Tables<"document_templates">[];
  generated_documents?: Tables<"generated_documents">[];
  // Present on every backup created from 1.2 onward (P1-10B, operational
  // core). Optional in the type only to accept payloads restored/imported
  // from before 1.2. materiais_fotos (Storage metadata) and
  // material_locacao_numeradores (a pure sequence counter) are
  // deliberately not part of this scope - see the migration comment.
  categorias_materiais?: Tables<"categorias_materiais">[];
  materiais?: Tables<"materiais">[];
  estoque_localizacoes?: Tables<"estoque_localizacoes">[];
  estoque_saldos?: Tables<"estoque_saldos">[];
  estoque_movimentacoes?: Tables<"estoque_movimentacoes">[];
  material_custodias?: Tables<"material_custodias">[];
  material_custodia_eventos?: Tables<"material_custodia_eventos">[];
  material_locacoes?: Tables<"material_locacoes">[];
  material_locacao_itens?: Tables<"material_locacao_itens">[];
  material_locacao_eventos?: Tables<"material_locacao_eventos">[];
  manutencao_ordens?: Tables<"manutencao_ordens">[];
  manutencao_ordem_insumos?: Tables<"manutencao_ordem_insumos">[];
  manutencao_ordem_eventos?: Tables<"manutencao_ordem_eventos">[];
  financeiro_lancamentos?: Tables<"financeiro_lancamentos">[];
  financeiro_parcelas?: Tables<"financeiro_parcelas">[];
  financeiro_recebimentos?: Tables<"financeiro_recebimentos">[];
}

/** Collection keys added in 1.1. Kept in one place so normalize/validate/
 * restore-payload-building stay in sync when a future version adds more. */
const OPTIONAL_COLLECTION_KEYS = [
  "clientes",
  "funcionarios",
  "event_funcionarios",
  "event_checklist_items",
  "document_templates",
  "generated_documents",
] as const satisfies readonly (keyof BackupData)[];

/** Collection keys added in 1.2 (P1-10B, operational core). Same
 * absent-means-untouched rule as OPTIONAL_COLLECTION_KEYS above - kept as a
 * separate list only so callers that care about the distinction (e.g. a
 * future UI section grouping "core" vs "operational" data) can, while
 * validate/summary/restore-prep still treat every key the same way. */
const OPERATIONAL_CORE_COLLECTION_KEYS = [
  "categorias_materiais",
  "materiais",
  "estoque_localizacoes",
  "estoque_saldos",
  "estoque_movimentacoes",
  "material_custodias",
  "material_custodia_eventos",
  "material_locacoes",
  "material_locacao_itens",
  "material_locacao_eventos",
  "manutencao_ordens",
  "manutencao_ordem_insumos",
  "manutencao_ordem_eventos",
  "financeiro_lancamentos",
  "financeiro_parcelas",
  "financeiro_recebimentos",
] as const satisfies readonly (keyof BackupData)[];

const ALL_OPTIONAL_COLLECTION_KEYS = [
  ...OPTIONAL_COLLECTION_KEYS,
  ...OPERATIONAL_CORE_COLLECTION_KEYS,
] as const satisfies readonly (keyof BackupData)[];

export interface BackupPayload {
  versao: string;
  sistema: string;
  meta: BackupMeta;
  data: BackupData;
}

// Legacy format (pre-refactor). Never had any of the 1.1 collections, so
// there is nothing to add for them here - they simply stay absent.
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
 * A 1.0 payload (legacy, or already-versioned but predating 1.1) simply has
 * no 'clientes'/'funcionarios'/etc. keys under data - that absence is left
 * as-is here (never backfilled to `[]`) so restore_company_backup can tell
 * "nothing to restore" apart from "this table isn't in this backup".
 */
export function normalizeBackup(
  raw: unknown,
  fallbackEmpresaId?: string,
): BackupPayload {
  // Already in new format (1.0 or 1.1 - both have versao/meta/data)
  if (isRecord(raw) && raw.versao && raw.meta && raw.data) {
    return raw as unknown as BackupPayload;
  }

  // Legacy (pre-versioning) format conversion
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
 * Validates a backup payload structure. The 1.1 collections are optional:
 * a backup predating this version is still valid without them.
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

    for (const key of ALL_OPTIONAL_COLLECTION_KEYS) {
      const value = normalized.data[key];
      if (value !== undefined && !Array.isArray(value)) {
        errors.push(`'data.${key}' não é um array.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns a summary of the backup contents for preview. A 1.1 collection
 * absent from an older backup shows as `null`, not `0`, so the preview UI
 * can say "not included in this backup" instead of implying it was empty.
 */
export function getBackupSummary(payload: BackupPayload) {
  const optional = Object.fromEntries(
    ALL_OPTIONAL_COLLECTION_KEYS.map((key) => [
      key,
      payload.data[key] !== undefined ? (payload.data[key]?.length ?? 0) : null,
    ]),
  ) as Record<(typeof ALL_OPTIONAL_COLLECTION_KEYS)[number], number | null>;

  return {
    eventos: payload.data.eventos?.length ?? 0,
    eventDays: payload.data.event_days?.length ?? 0,
    eventFiles: payload.data.event_files?.length ?? 0,
    financials: payload.data.financials?.length ?? 0,
    ...optional,
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
 * Forces empresa_id onto every item of an optional collection, preserving
 * `undefined` when the collection itself is absent from the payload - an
 * absent collection must stay absent all the way to the RPC call, never
 * become `[]`, or restore_company_backup would treat it as "restore this
 * table to empty" instead of "this backup doesn't cover this table".
 */
function withForcedEmpresaId<T extends { empresa_id?: string | null }>(
  items: T[] | undefined,
  empresaId: string,
): T[] | undefined {
  if (items === undefined) return undefined;
  return items.map((item) => ({ ...item, empresa_id: empresaId }));
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
      clientes: withForcedEmpresaId(normalized.data.clientes, empresaId),
      funcionarios: withForcedEmpresaId(normalized.data.funcionarios, empresaId),
      event_funcionarios: withForcedEmpresaId(normalized.data.event_funcionarios, empresaId),
      event_checklist_items: withForcedEmpresaId(normalized.data.event_checklist_items, empresaId),
      document_templates: withForcedEmpresaId(normalized.data.document_templates, empresaId),
      generated_documents: withForcedEmpresaId(normalized.data.generated_documents, empresaId),
      categorias_materiais: withForcedEmpresaId(normalized.data.categorias_materiais, empresaId),
      materiais: withForcedEmpresaId(normalized.data.materiais, empresaId),
      estoque_localizacoes: withForcedEmpresaId(normalized.data.estoque_localizacoes, empresaId),
      estoque_saldos: withForcedEmpresaId(normalized.data.estoque_saldos, empresaId),
      estoque_movimentacoes: withForcedEmpresaId(normalized.data.estoque_movimentacoes, empresaId),
      material_custodias: withForcedEmpresaId(normalized.data.material_custodias, empresaId),
      material_custodia_eventos: withForcedEmpresaId(normalized.data.material_custodia_eventos, empresaId),
      material_locacoes: withForcedEmpresaId(normalized.data.material_locacoes, empresaId),
      material_locacao_itens: withForcedEmpresaId(normalized.data.material_locacao_itens, empresaId),
      material_locacao_eventos: withForcedEmpresaId(normalized.data.material_locacao_eventos, empresaId),
      manutencao_ordens: withForcedEmpresaId(normalized.data.manutencao_ordens, empresaId),
      manutencao_ordem_insumos: withForcedEmpresaId(normalized.data.manutencao_ordem_insumos, empresaId),
      manutencao_ordem_eventos: withForcedEmpresaId(normalized.data.manutencao_ordem_eventos, empresaId),
      financeiro_lancamentos: withForcedEmpresaId(normalized.data.financeiro_lancamentos, empresaId),
      financeiro_parcelas: withForcedEmpresaId(normalized.data.financeiro_parcelas, empresaId),
      financeiro_recebimentos: withForcedEmpresaId(normalized.data.financeiro_recebimentos, empresaId),
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
