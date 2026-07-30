import { describe, expect, it } from "vitest";
import {
  MATERIAL_QR_PREFIX,
  buildMaterialQrContent,
  generateMaterialBarcodeValue,
  isMaterialQrContentForIdentifier,
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

  it("generates an unpredictable BSP barcode without using a database ID", () => {
    const generated = generateMaterialBarcodeValue(
      () => "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(generated).toBe("BSP-550E8400E29B41D4A716");
    expect(validateMaterialBarcode(generated)).toBe(generated);
    expect(generated.slice(4)).not.toContain("-");
    expect(generated).not.toContain("material-id");
  });

  it("can generate another barcode before persistence", () => {
    const first = generateMaterialBarcodeValue(
      () => "550e8400-e29b-41d4-a716-446655440000",
    );
    const second = generateMaterialBarcodeValue(
      () => "650e8400-e29b-41d4-a716-446655440000",
    );

    expect(second).not.toBe(first);
    expect(second).toMatch(/^BSP-[0-9A-F]{20}$/);
  });
});
