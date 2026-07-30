export const MATERIAL_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

const allowedTypes: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateMaterialPhoto(
  file: Pick<File, "name" | "size" | "type">,
): void {
  const extensions = allowedTypes[file.type];
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (!extensions || !extension || !extensions.includes(extension)) {
    throw new Error("A foto deve estar em JPEG, PNG ou WebP");
  }
  if (file.size <= 0) throw new Error("A foto está vazia");
  if (file.size > MATERIAL_PHOTO_MAX_BYTES) {
    throw new Error("A foto excede o limite de 8 MB");
  }
}

function safeImageName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() || "jpg";
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${base || "foto"}.${extension}`;
}

export function buildMaterialPhotoPath({
  empresaId,
  materialId,
  fileName,
  nonce,
}: {
  empresaId: string;
  materialId: string;
  fileName: string;
  nonce: string;
}): string {
  if (!uuidPattern.test(empresaId) || !uuidPattern.test(materialId)) {
    throw new Error("Empresa ou material inválido para upload");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(nonce)) {
    throw new Error("Identificador da foto inválido");
  }
  return `${empresaId}/${materialId}/${nonce}_${safeImageName(fileName)}`;
}

