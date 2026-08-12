import type { PrinterOrientation } from "./printer-types";

// ============================================================================
// GENERIC LABEL/BOBINA LAYOUT ENGINE
// ============================================================================
//
// Single source of truth for turning a "bobina profile" (physical media
// description: label cell size, columns, gaps, margins, DPI, offsets) into
// print geometry. Every screen that prints or previews labels - the profile
// editor's live preview, the print dialog's batch preview, the real print
// pipeline (material-label-print.tsx) and the "imprimir teste" flow - calls
// these same functions instead of recomputing positions independently (see
// section 13/"pipeline único" of the request that produced this module).
//
// Deliberately printer/brand-agnostic: nothing here knows about TSC, Zebra,
// Argox, Elgin or any specific label stock. A profile is just numbers the
// user configures; the physical device DPI is auto-detected from the
// Windows driver itself at print time (GetDeviceCaps in
// src-tauri/src/printing.rs), never assumed here.

export type BobinaDpiMode = "automatico" | "203" | "300" | "personalizado";

export const BOBINA_DPI_LABELS: Record<BobinaDpiMode, string> = {
  automatico: "Automático",
  "203": "203 DPI",
  "300": "300 DPI",
  personalizado: "Personalizado",
};

export const BOBINA_DPI_MODES: BobinaDpiMode[] = ["automatico", "203", "300", "personalizado"];

/** The fields that determine physical geometry - shared by the DB-backed
 * BobinaProfile (bobina-profile-types.ts) and the synthetic single-column
 * profile derived from a legacy label model (legacyProfileFromModel). */
export interface BobinaLayoutInput {
  largura_etiqueta_mm: number;
  altura_etiqueta_mm: number;
  colunas: number;
  espacamento_horizontal_mm: number;
  espacamento_vertical_mm: number;
  margem_esquerda_mm: number;
  margem_direita_mm: number;
  margem_superior_mm: number;
  margem_inferior_mm: number;
  largura_midia_mm?: number | null;
  offset_horizontal_mm?: number;
  offset_vertical_mm?: number;
}

export interface BobinaDpiInput {
  dpi: BobinaDpiMode;
  dpi_personalizado?: number | null;
}

export interface BobinaProfileFormInput extends BobinaLayoutInput, BobinaDpiInput {
  nome: string;
}

function normalizedColumns(colunas: number): number {
  return Math.max(1, Math.floor(colunas || 1));
}

// ----------------------------------------------------------------------------
// mm <-> dots (DPI) conversion
// ----------------------------------------------------------------------------

// "Automático" and the personalizado fallback are a rendering-resolution
// choice, not a device assumption: the physical mm size is always what gets
// sent downstream unchanged, and the real device DPI is auto-detected from
// the Windows driver (GetDeviceCaps) independent of this value - see
// dpiToRasterScale.
const AUTOMATIC_RASTER_DPI = 300;
const CSS_REFERENCE_DPI = 96;
export const MIN_CUSTOM_DPI = 72;
export const MAX_CUSTOM_DPI = 1200;

export function resolveDpi(input: BobinaDpiInput): number {
  if (input.dpi === "203") return 203;
  if (input.dpi === "300") return 300;
  if (input.dpi === "personalizado") {
    return input.dpi_personalizado && input.dpi_personalizado > 0 ? input.dpi_personalizado : AUTOMATIC_RASTER_DPI;
  }
  return AUTOMATIC_RASTER_DPI;
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export function dotsToMm(dots: number, dpi: number): number {
  return (dots / dpi) * 25.4;
}

/** Resolution multiplier for offscreen rasterization (html2canvas `scale`),
 * relative to the CSS reference of 96dpi. Only affects how crisp the
 * intermediate PNG is - physical mm dimensions stay exactly what's declared
 * regardless of this value (see printHtmlBatch's `rasterScale` job field). */
export function dpiToRasterScale(dpi: number): number {
  return Math.max(1, dpi / CSS_REFERENCE_DPI);
}

// ----------------------------------------------------------------------------
// Width-fit validation (section 6): margem_esquerda + (largura * colunas) +
// gaps horizontais + margem_direita <= largura da mídia.
// ----------------------------------------------------------------------------

export function computeRequiredWidthMm(profile: Pick<BobinaLayoutInput,
  "margem_esquerda_mm" | "margem_direita_mm" | "largura_etiqueta_mm" | "colunas" | "espacamento_horizontal_mm">
): number {
  const columns = normalizedColumns(profile.colunas);
  const gaps = Math.max(columns - 1, 0) * profile.espacamento_horizontal_mm;
  return profile.margem_esquerda_mm + profile.largura_etiqueta_mm * columns + gaps + profile.margem_direita_mm;
}

const WIDTH_TOLERANCE_MM = 0.5;

/** Mirrors validateLabelModel's shape (material-label-domain.ts): a single
 * human-readable error, or null when everything checks out. Used by the
 * profile form before it ever reaches the RPC, and mirrored server-side by
 * a CHECK constraint as defense in depth (never trust the client alone). */
export function validateBobinaProfile(input: BobinaProfileFormInput): string | null {
  if (!input.nome.trim() || input.nome.trim().length > 80) return "Informe um nome com até 80 caracteres.";
  if (!(input.largura_etiqueta_mm > 0) || input.largura_etiqueta_mm > 500) return "A largura da etiqueta deve ficar entre 0 e 500 mm.";
  if (!(input.altura_etiqueta_mm > 0) || input.altura_etiqueta_mm > 1000) return "A altura da etiqueta deve ficar entre 0 e 1000 mm.";
  if (!Number.isInteger(input.colunas) || input.colunas < 1 || input.colunas > 20) return "A quantidade de colunas deve ser um número inteiro entre 1 e 20.";
  if (input.espacamento_horizontal_mm < 0 || input.espacamento_vertical_mm < 0) return "Os espaçamentos não podem ser negativos.";
  if (input.margem_esquerda_mm < 0 || input.margem_direita_mm < 0 || input.margem_superior_mm < 0 || input.margem_inferior_mm < 0) {
    return "As margens não podem ser negativas.";
  }
  if (input.dpi === "personalizado" && (!input.dpi_personalizado || input.dpi_personalizado < MIN_CUSTOM_DPI || input.dpi_personalizado > MAX_CUSTOM_DPI)) {
    return `Informe um DPI personalizado entre ${MIN_CUSTOM_DPI} e ${MAX_CUSTOM_DPI}.`;
  }
  if (input.largura_midia_mm != null && input.largura_midia_mm > 0) {
    const required = computeRequiredWidthMm(input);
    if (required > input.largura_midia_mm + WIDTH_TOLERANCE_MM) {
      return `As dimensões configuradas ultrapassam a largura da bobina (necessário ${required.toFixed(1)} mm, disponível ${input.largura_midia_mm.toFixed(1)} mm).`;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Sheet geometry - one row/page's worth of cell positions. A "row" is the
// physical unit the Windows driver treats as one page (one StartPage/EndPage
// cycle in src-tauri/src/printing.rs, one GAP-sensor advance on a thermal
// label printer), so this intentionally computes ONE row at a time; multiple
// rows are just this same row repeated with an increasing Y offset (see
// chunkIntoRows and the preview components, which stack copies of it).
// ----------------------------------------------------------------------------

export interface BobinaCellPosition {
  column: number;
  xMm: number;
  yMm: number;
}

export interface BobinaSheetGeometry {
  columns: number;
  rowWidthMm: number;
  rowHeightMm: number;
  cellWidthMm: number;
  cellHeightMm: number;
  cellPositions: BobinaCellPosition[];
}

// Note on espacamento_vertical_mm: it deliberately does NOT extend
// rowHeightMm. Each row is dispatched as its own independent physical page
// (one StartPage/EndPage cycle - see computeSheetGeometry's doc comment
// above), and the space between one label and the next on the roll is
// physically produced by the printer's own GAP/black-mark sensor advancing
// past the die-cut gap already on the media, using whatever page height is
// configured in the Windows driver for that stock (src-tauri/src/printing.rs
// intentionally never overrides DEVMODE). rowHeightMm only needs to describe
// the printable content box for a single row. espacamento_vertical_mm is
// still captured and validated because it's part of accurately describing
// the physical media (and the preview draws it as the visual step between
// rows - see BobinaPreview), just not a term this function needs to add in.
export function computeSheetGeometry(profile: BobinaLayoutInput): BobinaSheetGeometry {
  const columns = normalizedColumns(profile.colunas);
  const offsetX = profile.offset_horizontal_mm ?? 0;
  const offsetY = profile.offset_vertical_mm ?? 0;
  const cellPositions: BobinaCellPosition[] = Array.from({ length: columns }, (_, column) => ({
    column,
    xMm: profile.margem_esquerda_mm + offsetX + column * (profile.largura_etiqueta_mm + profile.espacamento_horizontal_mm),
    yMm: profile.margem_superior_mm + offsetY,
  }));
  return {
    columns,
    rowWidthMm: computeRequiredWidthMm(profile),
    rowHeightMm: profile.margem_superior_mm + profile.altura_etiqueta_mm + profile.margem_inferior_mm,
    cellWidthMm: profile.largura_etiqueta_mm,
    cellHeightMm: profile.altura_etiqueta_mm,
    cellPositions,
  };
}

// ----------------------------------------------------------------------------
// Chunking a flat, already-quantity-expanded list of physical labels into
// rows of `columns` cells each. The last row is padded with null so every
// row - including a partial final one - keeps the same physical footprint
// (section 4: "desde que fisicamente caibam"; section 16 explicitly wants
// an odd quantity in a 2-column bobina covered).
// ----------------------------------------------------------------------------

export function chunkIntoRows<T>(items: readonly T[], columns: number): (T | null)[][] {
  const size = normalizedColumns(columns);
  const rows: (T | null)[][] = [];
  for (let index = 0; index < items.length; index += size) {
    const row: (T | null)[] = items.slice(index, index + size);
    while (row.length < size) row.push(null);
    rows.push(row);
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Consecutive-row deduplication: when a run of rows is physically identical
// (same content in every cell, in order - always true for a single-column
// bobina printing N copies of one item, often true for a multi-column bobina
// printing a large quantity of one item too), rasterizing it once and asking
// the printer to repeat that same page N times is both correct and far
// cheaper than rasterizing the same pixels N times. This is what lets the
// new multi-column engine reproduce the previous single-column pipeline's
// "one rasterize call per item, quantity forwarded to the spooler" behavior
// as a special case, instead of needing a separate code path for it.
// ----------------------------------------------------------------------------

export interface BobinaRowGroup<T> {
  row: (T | null)[];
  count: number;
}

export function groupConsecutiveRows<T>(
  rows: readonly (T | null)[][],
  keyOf: (cell: T | null) => string,
): BobinaRowGroup<T>[] {
  const groups: (BobinaRowGroup<T> & { key: string })[] = [];
  for (const row of rows) {
    const key = row.map(keyOf).join("");
    const previous = groups[groups.length - 1];
    if (previous && previous.key === key) {
      previous.count += 1;
      continue;
    }
    groups.push({ row, count: 1, key });
  }
  return groups.map(({ row, count }) => ({ row, count }));
}

// ----------------------------------------------------------------------------
// Backward-compatibility bridge: when no bobina profile is configured yet
// (existing companies, pre-upgrade), synthesize a trivial single-column
// profile straight from the label model's own width/height so the same
// engine reproduces the old "one label fills the whole page" behavior
// exactly, instead of needing a second calculation path.
// ----------------------------------------------------------------------------

export type BobinaOrientation = PrinterOrientation;

/** Everything the print pipeline needs from a bobina profile, independent of
 * DB bookkeeping fields (id/nome/empresa_id/padrao/ativo/updated_at). A full
 * BobinaProfile (bobina-profile-types.ts) satisfies this structurally. */
export interface BobinaPrintProfile extends BobinaLayoutInput, BobinaDpiInput {
  orientacao: BobinaOrientation;
}

export function legacyProfileFromModel(model: { largura_mm: number; altura_mm: number }): BobinaPrintProfile {
  return {
    largura_etiqueta_mm: model.largura_mm,
    altura_etiqueta_mm: model.altura_mm,
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
    orientacao: "retrato",
  };
}
