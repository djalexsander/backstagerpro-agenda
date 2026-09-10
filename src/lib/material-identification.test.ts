import { describe, expect, it } from "vitest";
import * as materialIdentification from "@/lib/material-identification";
import {
  MATERIAL_QR_PREFIX,
  buildMaterialQrContent,
  ean13CheckDigit,
  isMaterialQrContentForIdentifier,
  isValidEan13,
  normalizeMaterialBarcode,
  validateMaterialBarcode,
} from "@/lib/material-identification";

const IDENTIFIER = "550e8400-e29b-41d4-a716-446655440000";

describe("material identification", () => {
  it("builds QR content exclusively from the stable technical UUID", () => {
    expect(buildMaterialQrContent(IDENTIFIER)).toBe(
      `${MATERIAL_QR_PREFIX}${IDENTIFIER}`,
    );
  });

  it("does not depend on mutable material fields", () => {
    const before = buildMaterialQrContent(IDENTIFIER);
    const afterNameEdit = buildMaterialQrContent(IDENTIFIER);
    const afterLocationEdit = buildMaterialQrContent(IDENTIFIER);

    expect(afterNameEdit).toBe(before);
    expect(afterLocationEdit).toBe(before);
  });

  it("rejects non-UUID QR identifiers", () => {
    expect(() => buildMaterialQrContent("material-123")).toThrow(
      /identificador técnico inválido/i,
    );
  });

  it("checks that stored QR content belongs to the material identifier", () => {
    expect(
      isMaterialQrContentForIdentifier(
        `${MATERIAL_QR_PREFIX}${IDENTIFIER}`,
        IDENTIFIER,
      ),
    ).toBe(true);
    expect(
      isMaterialQrContentForIdentifier(
        `${MATERIAL_QR_PREFIX}650e8400-e29b-41d4-a716-446655440000`,
        IDENTIFIER,
      ),
    ).toBe(false);
  });

  it("normalizes optional barcodes without inventing a value", () => {
    expect(normalizeMaterialBarcode("  BSP-A1B2C3  ")).toBe("BSP-A1B2C3");
    expect(normalizeMaterialBarcode("   ")).toBeNull();
  });

  it("accepts printable Code 128 content and rejects control characters", () => {
    expect(validateMaterialBarcode("BSP-A1B2C3")).toBe("BSP-A1B2C3");
    expect(() => validateMaterialBarcode("AB\nCD")).toThrow(/Code 128/i);
    expect(() => validateMaterialBarcode("AB")).toThrow(/3 a 80/i);
  });

  it("does not expose a client-side automatic barcode generator", () => {
    expect(materialIdentification).not.toHaveProperty(
      "generateMaterialBarcodeValue",
    );
  });

  it("computes the EAN-13 check digit like Gestão Pro's calcularDvEan13", () => {
    // Real retail EAN-13s: the 13th digit must fall out of the first twelve.
    expect(ean13CheckDigit("400638133393")).toBe(1); // 4006381333931
    expect(ean13CheckDigit("789100005512")).toBe(0); // 7891000055120
    // "200" internal range, first company sequence -> 2000000000015.
    expect(ean13CheckDigit("200000000001")).toBe(5);
    expect(() => ean13CheckDigit("20000000001")).toThrow(/12 díg/i);
  });

  it("validates a full EAN-13 only when its check digit matches", () => {
    expect(isValidEan13("2000000000015")).toBe(true);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("2000000000012")).toBe(false); // wrong check digit
    expect(isValidEan13("0000000018")).toBe(false); // legacy 10-digit code
    expect(isValidEan13("MANUAL-ABC-123")).toBe(false);
  });
});
