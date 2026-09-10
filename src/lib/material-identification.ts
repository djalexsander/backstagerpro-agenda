export const MATERIAL_QR_PREFIX = "BACKSTAGE-PRO:MATERIAL:";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Code 128 represents printable ASCII. Control characters are intentionally
// rejected because they are unsafe in forms, logs and future print payloads.
const CODE_128_TEXT_PATTERN = /^[\x20-\x7e]{3,80}$/;

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

// GS1 mod-10 check digit for the 12-digit EAN-13 payload, mirroring Gestão
// Pro's calcularDvEan13 (its src/lib/barcode.ts): counting from the left,
// odd positions weigh 1 and even positions weigh 3; the digit is whatever
// raises the weighted sum to the next multiple of ten. This only validates a
// value the server produced - the barcode is still issued exclusively by the
// generate_material_barcode RPC, never on the client.
export function ean13CheckDigit(payload12: string): number {
  if (!/^\d{12}$/.test(payload12)) {
    throw new Error("O payload do EAN-13 precisa ter 12 dígitos.");
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(payload12[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
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
