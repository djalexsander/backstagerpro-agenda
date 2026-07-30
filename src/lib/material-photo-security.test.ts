import { describe, expect, it } from "vitest";
import {
  buildMaterialPhotoPath,
  MATERIAL_PHOTO_MAX_BYTES,
  validateMaterialPhoto,
} from "./material-photo-security";

const empresaId = "123e4567-e89b-42d3-a456-426614174000";
const materialId = "223e4567-e89b-42d3-a456-426614174000";

describe("material photo security", () => {
  it("accepts JPEG, PNG and WebP within the size limit", () => {
    for (const [name, type] of [
      ["foto.jpg", "image/jpeg"],
      ["foto.png", "image/png"],
      ["foto.webp", "image/webp"],
    ]) {
      expect(() =>
        validateMaterialPhoto({ name, type, size: 1024 }),
      ).not.toThrow();
    }
  });

  it("rejects mismatched, empty and oversized files", () => {
    expect(() =>
      validateMaterialPhoto({
        name: "foto.svg",
        type: "image/svg+xml",
        size: 100,
      }),
    ).toThrow(/JPEG, PNG ou WebP/i);
    expect(() =>
      validateMaterialPhoto({
        name: "foto.jpg",
        type: "image/jpeg",
        size: 0,
      }),
    ).toThrow(/vazia/i);
    expect(() =>
      validateMaterialPhoto({
        name: "foto.webp",
        type: "image/webp",
        size: MATERIAL_PHOTO_MAX_BYTES + 1,
      }),
    ).toThrow(/8 MB/i);
  });

  it("builds a tenant and material scoped storage path", () => {
    expect(
      buildMaterialPhotoPath({
        empresaId,
        materialId,
        fileName: "Foto Principal Áudio.jpg",
        nonce: "abc123",
      }),
    ).toBe(
      `${empresaId}/${materialId}/abc123_Foto_Principal_Audio.jpg`,
    );
  });
});

