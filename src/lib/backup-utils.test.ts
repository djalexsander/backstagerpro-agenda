import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKUP_SYSTEM,
  BACKUP_VERSION,
  buildBackupPayload,
  getBackupSummary,
  getLastLocalBackupTime,
  normalizeBackup,
  prepareBackupForRestore,
  setLastLocalBackupTime,
  validateBackup,
  type BackupData,
} from "./backup-utils";

const tenantA = "123e4567-e89b-42d3-a456-426614174000";
const tenantB = "223e4567-e89b-42d3-a456-426614174000";

function sampleData(empresaId = tenantA): BackupData {
  return {
    eventos: [{ id: "event-1", empresa_id: empresaId }] as BackupData["eventos"],
    event_days: [
      { id: "day-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["event_days"],
    event_files: [
      { id: "file-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["event_files"],
    financials: [
      { id: "financial-1", event_id: "event-1", empresa_id: empresaId },
    ] as BackupData["financials"],
  };
}

// Includes the six 1.1 collections (P1-10), unlike sampleData() above which
// intentionally stays minimal so tests can still exercise the pre-1.1
// (undefined-collection) shape.
function sampleExtendedData(empresaId = tenantA): BackupData {
  return {
    ...sampleData(empresaId),
    clientes: [
      { id: "client-1", empresa_id: empresaId, nome: "Cliente 1" },
    ] as NonNullable<BackupData["clientes"]>,
    funcionarios: [
      { id: "employee-1", empresa_id: empresaId, nome: "Funcionário 1" },
    ] as NonNullable<BackupData["funcionarios"]>,
    event_funcionarios: [
      { id: "link-1", event_id: "event-1", funcionario_id: "employee-1", empresa_id: empresaId },
    ] as NonNullable<BackupData["event_funcionarios"]>,
    event_checklist_items: [
      { id: "check-1", event_id: "event-1", empresa_id: empresaId, categoria: "som", descricao: "Testar PA" },
    ] as NonNullable<BackupData["event_checklist_items"]>,
    document_templates: [
      { id: "template-1", empresa_id: empresaId, nome: "Contrato padrão" },
    ] as NonNullable<BackupData["document_templates"]>,
    generated_documents: [
      { id: "doc-1", empresa_id: empresaId, event_id: "event-1", nome: "Contrato Evento 1" },
    ] as NonNullable<BackupData["generated_documents"]>,
  };
}

describe("backup payload utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds a versioned payload with period metadata", () => {
    const payload = buildBackupPayload(
      tenantA,
      "manual",
      sampleData(),
      "2026-01-01",
      "2026-01-31",
    );

    expect(payload.versao).toBe(BACKUP_VERSION);
    expect(BACKUP_VERSION).toBe("1.1"); // P1-10 bumped this from "1.0"
    expect(payload.sistema).toBe(BACKUP_SYSTEM);
    expect(payload.meta).toMatchObject({
      empresa_id: tenantA,
      tipo: "manual",
      periodo_inicio: "2026-01-01",
      periodo_fim: "2026-01-31",
    });
    expect(payload.meta.data_backup).toEqual(expect.any(String));
  });

  it("normalizes the legacy backup format", () => {
    const normalized = normalizeBackup({
      empresa_id: tenantA,
      data_backup: "2026-07-29T12:00:00.000Z",
      eventos: sampleData().eventos,
    });

    expect(normalized.meta).toEqual({
      empresa_id: tenantA,
      tipo: "manual",
      data_backup: "2026-07-29T12:00:00.000Z",
    });
    expect(normalized.data.eventos).toHaveLength(1);
    expect(normalized.data.financials).toEqual([]);
  });

  it("rejects missing tenant metadata and malformed collections", () => {
    const result = validateBackup({
      versao: "1.0",
      meta: { empresa_id: "", tipo: "manual", data_backup: "now" },
      data: {
        eventos: {},
        event_days: [],
        event_files: "invalid",
        financials: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/empresa_id/),
        expect.stringMatching(/eventos/),
        expect.stringMatching(/event_files/),
      ]),
    );
  });

  it("summarizes every backup collection", () => {
    const payload = buildBackupPayload(tenantA, "auto", sampleData());
    expect(getBackupSummary(payload)).toEqual({
      eventos: 1,
      eventDays: 1,
      eventFiles: 1,
      financials: 1,
      clientes: null,
      funcionarios: null,
      event_funcionarios: null,
      event_checklist_items: null,
      document_templates: null,
      generated_documents: null,
    });
  });

  it("summarizes the six 1.1 collections as real counts, not null, when present", () => {
    const payload = buildBackupPayload(tenantA, "auto", sampleExtendedData());
    const summary = getBackupSummary(payload);
    expect(summary.clientes).toBe(1);
    expect(summary.funcionarios).toBe(1);
    expect(summary.event_funcionarios).toBe(1);
    expect(summary.event_checklist_items).toBe(1);
    expect(summary.document_templates).toBe(1);
    expect(summary.generated_documents).toBe(1);
  });

  it("overrides foreign tenant IDs on every 1.1 collection before a restore", () => {
    const restored = prepareBackupForRestore(
      buildBackupPayload(tenantA, "manual", sampleExtendedData(tenantA)),
      tenantB,
    );

    expect(restored.meta.empresa_id).toBe(tenantB);
    for (const [key, rows] of Object.entries(restored.data)) {
      expect(rows, `data.${key} should have been populated by sampleExtendedData`).toBeDefined();
      expect((rows ?? []).every((row) => row.empresa_id === tenantB)).toBe(true);
    }
  });

  it("never turns an absent 1.1 collection into an empty array during restore prep", () => {
    // sampleData() (unlike sampleExtendedData()) has no clientes/funcionarios/
    // etc. keys at all - this is what an old backup looks like. If any of
    // these ever became `[]` here, restore_company_backup would read that as
    // "restore this table to empty" instead of "not part of this backup",
    // wiping out live data the backup never touched.
    const restored = prepareBackupForRestore(
      buildBackupPayload(tenantA, "manual", sampleData(tenantA)),
      tenantB,
    );

    expect(restored.data.clientes).toBeUndefined();
    expect(restored.data.funcionarios).toBeUndefined();
    expect(restored.data.event_funcionarios).toBeUndefined();
    expect(restored.data.event_checklist_items).toBeUndefined();
    expect(restored.data.document_templates).toBeUndefined();
    expect(restored.data.generated_documents).toBeUndefined();
    // The original four are unaffected by any of this.
    expect(restored.data.eventos).toHaveLength(1);
  });

  it("normalizes a pre-1.1 payload without inventing the new collections", () => {
    const normalized = normalizeBackup({
      versao: "1.0",
      sistema: BACKUP_SYSTEM,
      meta: { empresa_id: tenantA, tipo: "manual", data_backup: "2026-08-01T00:00:00.000Z" },
      data: sampleData(tenantA),
    });

    expect(normalized.data.clientes).toBeUndefined();
    expect(normalized.data.eventos).toHaveLength(1);
  });

  it("keeps 1.1 collections intact when normalizing an already-current payload", () => {
    const payload = buildBackupPayload(tenantA, "manual", sampleExtendedData(tenantA));
    const normalized = normalizeBackup(payload);

    expect(normalized.data.clientes).toHaveLength(1);
    expect(normalized.data.generated_documents).toHaveLength(1);
  });

  it("accepts a payload that omits every 1.1 collection as still valid", () => {
    const result = validateBackup(buildBackupPayload(tenantA, "manual", sampleData()));
    expect(result.valid).toBe(true);
  });

  it("rejects a present-but-malformed 1.1 collection", () => {
    const payload = buildBackupPayload(tenantA, "manual", sampleExtendedData());
    // @ts-expect-error -- deliberately malformed for the test
    payload.data.clientes = { not: "an array" };

    const result = validateBackup(payload);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/data\.clientes/)]),
    );
  });

  it("refuses an invalid payload before destructive restore operations", () => {
    expect(() => prepareBackupForRestore(null, tenantB)).toThrow(
      /backup inválido/i,
    );
    expect(() => prepareBackupForRestore({}, tenantB)).toThrow(
      /estrutura não reconhecida/i,
    );
  });

  it("keeps automatic-backup timestamps isolated per tenant", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    setLastLocalBackupTime(tenantA);

    expect(getLastLocalBackupTime(tenantA)).toBe(123456789);
    expect(getLastLocalBackupTime(tenantB)).toBe(0);
  });
});
