import { describe, expect, it } from "vitest";
import {
  MAX_BACKUP_IMPORT_BYTES,
  assertBackupAdministrator,
  canManageBackups,
  validateBackupImportFile,
} from "./backup-security";

describe("backup access security", () => {
  it("allows only company and master administrators", () => {
    expect(canManageBackups("admin_empresa")).toBe(true);
    expect(canManageBackups("master_admin")).toBe(true);
    expect(canManageBackups("usuario")).toBe(false);
    expect(canManageBackups("admin")).toBe(false);
    expect(canManageBackups(null)).toBe(false);
  });

  it("fails closed for a common or unknown role", () => {
    expect(() => assertBackupAdministrator("usuario")).toThrow(
      /apenas administradores/i,
    );
    expect(() => assertBackupAdministrator(undefined)).toThrow(
      /apenas administradores/i,
    );
  });

  it("accepts a bounded JSON backup file", () => {
    expect(() =>
      validateBackupImportFile({
        name: "empresa.backup.JSON",
        size: 1024,
        type: "application/json",
      }),
    ).not.toThrow();
  });

  it("rejects empty, oversized and non-JSON imports", () => {
    expect(() =>
      validateBackupImportFile({ name: "backup.json", size: 0 }),
    ).toThrow(/vazio/i);
    expect(() =>
      validateBackupImportFile({
        name: "backup.json",
        size: MAX_BACKUP_IMPORT_BYTES + 1,
      }),
    ).toThrow(/25 MB/i);
    expect(() =>
      validateBackupImportFile({ name: "backup.csv", size: 1024 }),
    ).toThrow(/JSON/i);
    expect(() =>
      validateBackupImportFile({
        name: "backup.json",
        size: 1024,
        type: "text/html",
      }),
    ).toThrow(/não é permitido/i);
  });
});
