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
    });
  });

  it("overrides foreign tenant IDs before a restore", () => {
    const restored = prepareBackupForRestore(
      buildBackupPayload(tenantA, "manual", sampleData(tenantA)),
      tenantB,
    );

    expect(restored.meta.empresa_id).toBe(tenantB);
    for (const rows of Object.values(restored.data)) {
      expect(rows.every((row) => row.empresa_id === tenantB)).toBe(true);
    }
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
