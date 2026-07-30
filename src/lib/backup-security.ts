import type { AppRole } from "./user-role";

export const MAX_BACKUP_IMPORT_BYTES = 25 * 1024 * 1024;

export function canManageBackups(
  role: AppRole | string | null | undefined,
): boolean {
  return role === "master_admin" || role === "admin_empresa";
}

export function assertBackupAdministrator(
  role: AppRole | string | null | undefined,
): void {
  if (!canManageBackups(role)) {
    throw new Error("Apenas administradores podem acessar backups");
  }
}

export interface BackupImportFileMetadata {
  name: string;
  size: number;
  type?: string;
}

export function validateBackupImportFile(
  file: BackupImportFileMetadata,
): void {
  if (!file.name.toLowerCase().endsWith(".json")) {
    throw new Error("O backup deve ser um arquivo JSON");
  }
  if (file.size <= 0) {
    throw new Error("O arquivo de backup está vazio");
  }
  if (file.size > MAX_BACKUP_IMPORT_BYTES) {
    throw new Error("O arquivo de backup excede o limite de 25 MB");
  }
  if (
    file.type &&
    file.type !== "application/json" &&
    file.type !== "text/json"
  ) {
    throw new Error("O tipo do arquivo de backup não é permitido");
  }
}
