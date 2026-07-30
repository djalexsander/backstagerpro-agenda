export const MATERIAL_QR_PREFIX = "BACKSTAGE-PRO:MATERIAL:";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Code 128 represents printable ASCII. Control characters are intentionally
// rejected because they are unsafe in forms, logs and future print payloads.
const CODE_128_TEXT_PATTERN = /^[\x20-\x7e]{3,80}$/;
const GENERATED_BARCODE_RANDOM_LENGTH = 20;

export function buildMaterialQrContent(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("Identificador técnico inválido.");
  }
  return `${MATERIAL_QR_PREFIX}${normalized}`;
}

export function isMaterialQrContentForIdentifier(
  content: string | null | undefined,
  identifier: string,
): boolean {
  if (!content) return false;
  try {
    return content === buildMaterialQrContent(identifier);
  } catch {
    return false;
  }
}

export function normalizeMaterialBarcode(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

export function generateMaterialBarcodeValue(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  const randomContent = randomUuid()
    .replace(/-/g, "")
    .slice(0, GENERATED_BARCODE_RANDOM_LENGTH)
    .toUpperCase();

  if (!/^[0-9A-F]{20}$/.test(randomContent)) {
    throw new Error("Não foi possível gerar um código de barras seguro.");
  }

  return `BSP-${randomContent}`;
}

export function validateMaterialBarcode(value: string): string | null {
  const normalized = normalizeMaterialBarcode(value);
  if (!normalized) return null;
  if (!CODE_128_TEXT_PATTERN.test(normalized)) {
    throw new Error(
      "Use de 3 a 80 caracteres imprimíveis compatíveis com Code 128.",
    );
  }
  return normalized;
}
