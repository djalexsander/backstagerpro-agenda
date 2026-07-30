import type { AppRole } from "./user-role";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const logoExtensions = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type LogoMimeType = keyof typeof logoExtensions;

export function canManageCompanyLogo({
  role,
  actorCompanyId,
  targetCompanyId,
}: {
  role: AppRole | string | null | undefined;
  actorCompanyId: string | null | undefined;
  targetCompanyId: string;
}): boolean {
  if (!uuidPattern.test(targetCompanyId)) return false;
  if (role === "master_admin") return true;
  return role === "admin_empresa" && actorCompanyId === targetCompanyId;
}

export function assertCanManageCompanyLogo(input: {
  role: AppRole | string | null | undefined;
  actorCompanyId: string | null | undefined;
  targetCompanyId: string;
}): void {
  if (!canManageCompanyLogo(input)) {
    throw new Error("Sem permissão para alterar a logo desta empresa");
  }
}

export function validateLogoFile(
  file: Pick<File, "name" | "size" | "type">,
): LogoMimeType {
  if (file.size <= 0) throw new Error("O arquivo da logo está vazio");
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error("A logo excede o limite de 2 MB");
  }
  if (!(file.type in logoExtensions)) {
    throw new Error("Use uma logo PNG, JPEG ou WebP");
  }

  const mimeType = file.type as LogoMimeType;
  const expectedExtension = logoExtensions[mimeType];
  const fileExtension = file.name.split(".").pop()?.toLowerCase();
  const validExtensions =
    mimeType === "image/jpeg" ? ["jpg", "jpeg"] : [expectedExtension];
  if (!fileExtension || !validExtensions.includes(fileExtension)) {
    throw new Error("A extensão da logo não corresponde ao conteúdo");
  }
  return mimeType;
}

export function buildCompanyLogoPath(
  companyId: string,
  mimeType: LogoMimeType,
): string {
  if (!uuidPattern.test(companyId)) {
    throw new Error("Empresa inválida para upload da logo");
  }
  return `${companyId}/logo.${logoExtensions[mimeType]}`;
}

export function buildPlatformLogoPath(
  mimeType: LogoMimeType,
  timestamp = Date.now(),
): string {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Identificador temporal inválido");
  }
  return `platform-logo-${timestamp}.${logoExtensions[mimeType]}`;
}
