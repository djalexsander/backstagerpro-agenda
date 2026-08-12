import { describe, expect, it } from "vitest";
import {
  chunkIntoRows,
  computeRequiredWidthMm,
  computeSheetGeometry,
  dotsToMm,
  dpiToRasterScale,
  groupConsecutiveRows,
  legacyProfileFromModel,
  mmToDots,
  resolveDpi,
  validateBobinaProfile,
  type BobinaLayoutInput,
  type BobinaProfileFormInput,
} from "./label-layout-engine";

function profile(overrides: Partial<BobinaProfileFormInput> = {}): BobinaProfileFormInput {
  return {
    nome: "Perfil de teste",
    largura_etiqueta_mm: 50,
    altura_etiqueta_mm: 30,
    colunas: 1,
    espacamento_horizontal_mm: 0,
    espacamento_vertical_mm: 0,
    margem_esquerda_mm: 0,
    margem_direita_mm: 0,
    margem_superior_mm: 0,
    margem_inferior_mm: 0,
    largura_midia_mm: null,
    offset_horizontal_mm: 0,
    offset_vertical_mm: 0,
    dpi: "automatico",
    dpi_personalizado: null,
    ...overrides,
  };
}

describe("mm <-> dots conversion", () => {
  it.each([
    [25.4, 203, 203],
    [25.4, 300, 300],
    [50, 203, 400], // 50/25.4*203 = 399.6... rounds to 400
    [50, 300, 591], // 50/25.4*300 = 590.5... rounds to 591
  ])("mmToDots(%s, %s) -> %s", (mm, dpi, expected) => {
    expect(mmToDots(mm, dpi)).toBe(expected);
  });

  it("dotsToMm is the inverse of mmToDots within rounding", () => {
    expect(dotsToMm(203, 203)).toBeCloseTo(25.4, 5);
    expect(dotsToMm(300, 300)).toBeCloseTo(25.4, 5);
  });

  it.each<["automatico" | "203" | "300" | "personalizado", number | null, number]>([
    ["automatico", null, 300],
    ["203", null, 203],
    ["300", null, 300],
    ["personalizado", 600, 600],
    ["personalizado", null, 300], // falls back instead of producing an invalid/zero DPI
    ["personalizado", 0, 300],
  ])("resolveDpi(%s, %s) -> %s", (dpi, dpi_personalizado, expected) => {
    expect(resolveDpi({ dpi, dpi_personalizado })).toBe(expected);
  });

  it("dpiToRasterScale grows with DPI but never drops below 1x", () => {
    expect(dpiToRasterScale(96)).toBe(1);
    expect(dpiToRasterScale(48)).toBe(1);
    expect(dpiToRasterScale(203)).toBeCloseTo(203 / 96, 5);
    expect(dpiToRasterScale(300)).toBeCloseTo(300 / 96, 5);
  });
});

describe("computeRequiredWidthMm", () => {
  it("is just the label width with a single column and no margins/gaps", () => {
    expect(computeRequiredWidthMm(profile({ colunas: 1 }))).toBe(50);
  });

  it("adds N columns plus (N-1) horizontal gaps plus both margins", () => {
    const width = computeRequiredWidthMm(profile({
      colunas: 3, largura_etiqueta_mm: 40, espacamento_horizontal_mm: 2,
      margem_esquerda_mm: 5, margem_direita_mm: 5,
    }));
    // 5 + (40*3) + (2*2) + 5 = 5 + 120 + 4 + 5 = 134
    expect(width).toBe(134);
  });
});

describe("validateBobinaProfile", () => {
  it("accepts a well-formed single-column profile", () => {
    expect(validateBobinaProfile(profile())).toBeNull();
  });

  it("accepts 2 and 3 column profiles that fit their declared media width", () => {
    expect(validateBobinaProfile(profile({ colunas: 2, largura_midia_mm: 104, espacamento_horizontal_mm: 4 }))).toBeNull();
    expect(validateBobinaProfile(profile({ colunas: 3, largura_etiqueta_mm: 40, largura_midia_mm: 130 }))).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(validateBobinaProfile(profile({ nome: "   " }))).toMatch(/nome/i);
  });

  it("rejects non-positive or absurd label dimensions", () => {
    expect(validateBobinaProfile(profile({ largura_etiqueta_mm: 0 }))).toMatch(/largura/i);
    expect(validateBobinaProfile(profile({ altura_etiqueta_mm: -5 }))).toMatch(/altura/i);
  });

  it("rejects a non-integer or out-of-range column count", () => {
    expect(validateBobinaProfile(profile({ colunas: 1.5 }))).toMatch(/colunas/i);
    expect(validateBobinaProfile(profile({ colunas: 0 }))).toMatch(/colunas/i);
    expect(validateBobinaProfile(profile({ colunas: 21 }))).toMatch(/colunas/i);
  });

  it("rejects negative gaps or margins", () => {
    expect(validateBobinaProfile(profile({ espacamento_horizontal_mm: -1 }))).toMatch(/espaçamentos/i);
    expect(validateBobinaProfile(profile({ margem_esquerda_mm: -1 }))).toMatch(/margens/i);
  });

  it("requires a custom DPI value within range when dpi is personalizado", () => {
    expect(validateBobinaProfile(profile({ dpi: "personalizado", dpi_personalizado: null }))).toMatch(/dpi personalizado/i);
    expect(validateBobinaProfile(profile({ dpi: "personalizado", dpi_personalizado: 40 }))).toMatch(/dpi personalizado/i);
    expect(validateBobinaProfile(profile({ dpi: "personalizado", dpi_personalizado: 600 }))).toBeNull();
  });

  it("flags dimensions that exceed the declared media width with a clear message", () => {
    const error = validateBobinaProfile(profile({
      colunas: 2, largura_etiqueta_mm: 50, espacamento_horizontal_mm: 4, largura_midia_mm: 90,
    }));
    // required = 0 + 50*2 + 4 + 0 = 104 > 90
    expect(error).toMatch(/ultrapassam a largura da bobina/i);
    expect(error).toContain("104.0");
    expect(error).toContain("90.0");
  });

  it("does not require a media width at all - it is optional", () => {
    expect(validateBobinaProfile(profile({ colunas: 4, largura_etiqueta_mm: 60, largura_midia_mm: null }))).toBeNull();
  });

  it("tolerates a sub-millimeter rounding gap at the exact boundary", () => {
    expect(validateBobinaProfile(profile({ largura_etiqueta_mm: 50, colunas: 1, largura_midia_mm: 50 }))).toBeNull();
  });
});

describe("computeSheetGeometry", () => {
  it("places a single column at the top-left margin", () => {
    const geometry = computeSheetGeometry(profile({ margem_esquerda_mm: 3, margem_superior_mm: 2 }));
    expect(geometry.columns).toBe(1);
    expect(geometry.cellPositions).toEqual([{ column: 0, xMm: 3, yMm: 2 }]);
    expect(geometry.rowWidthMm).toBe(53);
    expect(geometry.rowHeightMm).toBe(32);
  });

  it("lays out 2 columns side by side, gap-separated", () => {
    const geometry = computeSheetGeometry(profile({ colunas: 2, espacamento_horizontal_mm: 3 }));
    expect(geometry.cellPositions).toEqual([
      { column: 0, xMm: 0, yMm: 0 },
      { column: 1, xMm: 53, yMm: 0 }, // 50 (width) + 3 (gap)
    ]);
    expect(geometry.rowWidthMm).toBe(103); // 50*2 + 3
  });

  it("lays out 3 columns with margins and gaps", () => {
    const geometry = computeSheetGeometry(profile({
      colunas: 3, largura_etiqueta_mm: 40, espacamento_horizontal_mm: 2, margem_esquerda_mm: 5,
    }));
    expect(geometry.cellPositions.map((cell) => cell.xMm)).toEqual([5, 47, 89]);
  });

  it("applies a positive offset by shifting every cell right/down without changing rowWidth/rowHeight", () => {
    const base = computeSheetGeometry(profile());
    const shifted = computeSheetGeometry(profile({ offset_horizontal_mm: 1.5, offset_vertical_mm: -0.5 }));
    expect(shifted.cellPositions[0].xMm).toBeCloseTo(base.cellPositions[0].xMm + 1.5, 5);
    expect(shifted.cellPositions[0].yMm).toBeCloseTo(base.cellPositions[0].yMm - 0.5, 5);
    expect(shifted.rowWidthMm).toBe(base.rowWidthMm);
    expect(shifted.rowHeightMm).toBe(base.rowHeightMm);
  });

  it("applies a negative offset symmetrically to a positive one", () => {
    const positive = computeSheetGeometry(profile({ offset_horizontal_mm: 2 }));
    const negative = computeSheetGeometry(profile({ offset_horizontal_mm: -2 }));
    expect(positive.cellPositions[0].xMm - negative.cellPositions[0].xMm).toBeCloseTo(4, 5);
  });

  it("floors a fractional column count and always yields at least one column", () => {
    expect(computeSheetGeometry(profile({ colunas: 2.9 })).columns).toBe(2);
    expect(computeSheetGeometry(profile({ colunas: 0 })).columns).toBe(1);
  });
});

describe("chunkIntoRows", () => {
  it("keeps one item per row for a single-column bobina", () => {
    const rows = chunkIntoRows(["A", "B", "C"], 1);
    expect(rows).toEqual([["A"], ["B"], ["C"]]);
  });

  it("fills a 2-column bobina evenly when the count divides exactly", () => {
    const rows = chunkIntoRows(["A", "B", "C", "D"], 2);
    expect(rows).toEqual([["A", "B"], ["C", "D"]]);
  });

  it("pads the last row with null for an odd quantity in a 2-column bobina", () => {
    const rows = chunkIntoRows(["A", "B", "C"], 2);
    expect(rows).toEqual([["A", "B"], ["C", null]]);
  });

  it("pads correctly for a 3-column bobina with a remainder of 1", () => {
    const rows = chunkIntoRows(["A", "B", "C", "D"], 3);
    expect(rows).toEqual([["A", "B", "C"], ["D", null, null]]);
  });

  it("returns no rows for an empty list", () => {
    expect(chunkIntoRows([], 2)).toEqual([]);
  });
});

describe("groupConsecutiveRows", () => {
  const keyOf = (cell: string | null) => cell ?? "∅";

  it("collapses N identical single-column rows into one group with count N (legacy single-item batch)", () => {
    const rows = chunkIntoRows(["X", "X", "X", "X", "X"], 1);
    const groups = groupConsecutiveRows(rows, keyOf);
    expect(groups).toEqual([{ row: ["X"], count: 5 }]);
  });

  it("keeps distinct consecutive rows as separate groups", () => {
    const rows = chunkIntoRows(["A", "B"], 1);
    const groups = groupConsecutiveRows(rows, keyOf);
    expect(groups).toEqual([{ row: ["A"], count: 1 }, { row: ["B"], count: 1 }]);
  });

  it("collapses repeated identical 2-column rows (same pair repeated)", () => {
    const rows = chunkIntoRows(["A", "B", "A", "B"], 2);
    const groups = groupConsecutiveRows(rows, keyOf);
    expect(groups).toEqual([{ row: ["A", "B"], count: 2 }]);
  });

  it("does not merge non-adjacent groups that happen to repeat later", () => {
    const rows = chunkIntoRows(["A", "B", "A"], 1);
    const groups = groupConsecutiveRows(rows, keyOf);
    expect(groups).toEqual([{ row: ["A"], count: 1 }, { row: ["B"], count: 1 }, { row: ["A"], count: 1 }]);
  });
});

describe("legacyProfileFromModel", () => {
  it("produces a trivial single-column profile matching the model's own size", () => {
    const legacy = legacyProfileFromModel({ largura_mm: 50, altura_mm: 30 });
    const geometry = computeSheetGeometry(legacy);
    expect(geometry.columns).toBe(1);
    expect(geometry.rowWidthMm).toBe(50);
    expect(geometry.rowHeightMm).toBe(30);
    expect(geometry.cellPositions).toEqual([{ column: 0, xMm: 0, yMm: 0 }]);
  });

  it("round-trips through validation as a legal profile", () => {
    const legacy = legacyProfileFromModel({ largura_mm: 60, altura_mm: 40 });
    expect(validateBobinaProfile({ nome: "Legado", ...legacy })).toBeNull();
  });
});

describe("custom label sizes beyond the built-in presets", () => {
  it("accepts an arbitrary, non-preset size with no special-casing", () => {
    const geometry = computeSheetGeometry(profile({ largura_etiqueta_mm: 73.5, altura_etiqueta_mm: 12.25, colunas: 4 }));
    expect(geometry.cellWidthMm).toBe(73.5);
    expect(geometry.cellHeightMm).toBe(12.25);
    expect(geometry.columns).toBe(4);
  });
});

describe("58mm and 80mm media widths stay valid as a media-width ceiling", () => {
  it.each([58, 80])("fits a single 50mm label under a %smm media width", (mediaWidth) => {
    const input: BobinaLayoutInput = profile({ largura_etiqueta_mm: 50, colunas: 1, largura_midia_mm: mediaWidth });
    expect(validateBobinaProfile(input as BobinaProfileFormInput)).toBeNull();
    expect(computeRequiredWidthMm(input)).toBeLessThanOrEqual(mediaWidth);
  });
});
