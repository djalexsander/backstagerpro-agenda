import JsBarcode from "jsbarcode";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import {
  chunkIntoRows,
  computeSheetGeometry,
  dpiToRasterScale,
  legacyProfileFromModel,
  resolveDpi,
  type BobinaPrintProfile,
  type BobinaSheetGeometry,
} from "./label-layout-engine";
import { expandLabelBatch, LABEL_FIELD_LABELS } from "./material-label-domain";
import type { LabelMaterialSnapshot, LabelModelSnapshot, LabelPrintBatch } from "./material-label-types";
import { printHtmlBatch } from "./printer-service";
import type { PrinterConfig } from "./printer-types";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function barcodeMarkup(value: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, { format: "CODE128", displayValue: true, margin: 0, height: 42, fontSize: 11 });
  return svg.outerHTML;
}

// One physical label's markup (QR/barcode + fields), shared by the web
// iframe and offscreen desktop rasterization paths.
export function renderLabelMarkup(model: LabelModelSnapshot, material: LabelMaterialSnapshot) {
  const qr = model.tipo_identificacao !== "codigo_barras" && material.conteudo_qr_code
    ? renderToStaticMarkup(<QRCodeSVG value={material.conteudo_qr_code} level="M" size={Math.min(model.altura_mm * 3, model.largura_mm * 1.8)} />) : "";
  const barcode = model.tipo_identificacao !== "qr_code" && material.codigo_barras ? barcodeMarkup(material.codigo_barras) : "";
  const fieldValues = { nome: material.nome, codigo_interno: material.codigo_interno, categoria: material.categoria,
    marca_modelo: [material.marca, material.modelo].filter(Boolean).join(" "), numero_serie: material.numero_serie,
    numero_patrimonio: material.numero_patrimonio, localizacao: material.localizacao, empresa: material.empresa };
  const fields = model.campos.map((field, index) => {
    const value = fieldValues[field];
    return value ? `<div class="field ${index === 0 ? "primary" : ""}"><small>${escapeHtml(LABEL_FIELD_LABELS[field])}:</small> ${escapeHtml(value)}</div>` : "";
  }).join("");
  return `<article class="label"><div class="codes">${qr}${barcode}</div><div class="fields">${fields}</div></article>`;
}

// Shared between the popup document (web) and the offscreen rasterization
// container (desktop) - `@page` only matters for the former, but it's
// harmless for html2canvas to see it too, so one string serves both.
export function buildLabelSheetCss(model: LabelModelSnapshot) {
  return `<style>
    @page { size: ${model.largura_mm}mm ${model.altura_mm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; }
    .label { width: ${model.largura_mm}mm; height: ${model.altura_mm}mm; padding: ${model.margem_interna_mm ?? 1.5}mm; overflow: hidden; page-break-after: always; display: flex; gap: ${model.espacamento_interno_mm ?? 1.5}mm; color: #000; font-family: Arial, sans-serif; ${model.mostrar_borda ? "border: .25mm solid #000;" : ""} }
    .codes { width: 42%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1mm; overflow: hidden; }
    .codes:empty { display: none; } .codes svg { max-width: 100%; max-height: 48%; }
    .fields { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; font-size: ${model.tamanho_fonte}pt; line-height: 1.15; }
    .field { overflow-wrap: anywhere; } .field.primary { font-weight: 700; } small { color: #555; font-size: .72em; }
    @media screen { body { background: #ddd; } .label { margin: 8px auto; background: white; box-shadow: 0 1px 6px #777; } }
  </style>`;
}

export function buildLabelPrintHtml(request: LabelPrintBatch): string {
  const model = request.modelo_snapshot;
  const labels = expandLabelBatch(request).map((material) => renderLabelMarkup(model, material)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas - lote ${escapeHtml(request.id)}</title>${buildLabelSheetCss(model)}</head><body>${labels}</body></html>`;
}

// ============================================================================
// BOBINA-AWARE PIPELINE (single source of truth for every etiqueta print
// point: printLabelBatch below, plus the "imprimir teste" flow in
// printBobinaTestPage). One row = one physical page/StartPage cycle on the
// Windows driver (see src-tauri/src/printing.rs) - the same unit a thermal
// label printer's GAP sensor advances by. Multi-column bobinas compose N
// cells into that one row image instead of stretching a single label across
// it; a bobina with 1 column and zero margins/gaps reduces to exactly the
// old one-label-per-page behavior (see legacyProfileFromModel), so this is
// the only calculation path - not a second one bolted on for multi-column.
// ============================================================================

// Landscape rotates CONTENT within the cell's own footprint (the physical
// die-cut slot on the media doesn't change based on what's printed on it):
// the .label box is sized to the cell's swapped dimensions, centered, then
// rotated 90deg back into the unrotated cell - a standard CSS technique, no
// Rust/GDI changes needed since rotation already happened in the bitmap
// html2canvas captures.
function buildBobinaCss(profile: Pick<BobinaPrintProfile, "orientacao">, model: LabelModelSnapshot, geometry: BobinaSheetGeometry) {
  const labelBox = profile.orientacao === "paisagem"
    ? `position: absolute; left: 50%; top: 50%; width: ${geometry.cellHeightMm}mm; height: ${geometry.cellWidthMm}mm; transform: translate(-50%, -50%) rotate(90deg);`
    : `width: 100%; height: 100%;`;
  return `<style>
    @page { size: ${geometry.rowWidthMm}mm ${geometry.rowHeightMm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; }
    .row { position: relative; width: ${geometry.rowWidthMm}mm; height: ${geometry.rowHeightMm}mm; background: white; page-break-after: always; }
    .cell { position: absolute; width: ${geometry.cellWidthMm}mm; height: ${geometry.cellHeightMm}mm; overflow: hidden; }
    .cell .label { ${labelBox} padding: ${model.margem_interna_mm ?? 1.5}mm; overflow: hidden; display: flex; gap: ${model.espacamento_interno_mm ?? 1.5}mm; color: #000; font-family: Arial, sans-serif; ${model.mostrar_borda ? "border: .25mm solid #000;" : ""} }
    .codes { width: 42%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1mm; overflow: hidden; }
    .codes:empty { display: none; } .codes svg { max-width: 100%; max-height: 48%; }
    .fields { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; font-size: ${model.tamanho_fonte}pt; line-height: 1.15; }
    .field { overflow-wrap: anywhere; } .field.primary { font-weight: 700; } small { color: #555; font-size: .72em; }
    @media screen { body { background: #ddd; } .row { margin: 8px auto; box-shadow: 0 1px 6px #777; } }
  </style>`;
}

// One row's markup: `columns` cells, positioned per computeSheetGeometry.
// A null cell (last, partial row - e.g. an odd quantity in a 2-column
// bobina) renders empty but keeps its slot, so every row - including the
// last - shares the exact same physical geometry/calibration.
function buildBobinaRowHtml(model: LabelModelSnapshot, geometry: BobinaSheetGeometry, rowItems: (LabelMaterialSnapshot | null)[]) {
  const cells = geometry.cellPositions.map((position, index) => {
    const material = rowItems[index];
    const content = material ? renderLabelMarkup(model, material) : "";
    return `<div class="cell" style="left:${position.xMm}mm;top:${position.yMm}mm;">${content}</div>`;
  }).join("");
  return `<div class="row">${cells}</div>`;
}

/** Full multi-row HTML document for the browser/web print path - every row
 * in order, no dedup (a real print dialog just prints the flow once; the
 * spooler-side quantity trick in printLabelBatch is desktop-only). */
export function buildBobinaPrintHtml(
  profile: BobinaPrintProfile,
  model: LabelModelSnapshot,
  items: LabelMaterialSnapshot[],
  documentTitle: string,
): string {
  const geometry = computeSheetGeometry(profile);
  const rows = chunkIntoRows(items, geometry.columns);
  const css = buildBobinaCss(profile, model, geometry);
  const body = rows.map((row) => buildBobinaRowHtml(model, geometry, row)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title>${css}</head><body>${body}</body></html>`;
}

interface BobinaRowJob { key: string; html: string; quantity: number; widthMm: number; heightMm: number; }

function rowKey(row: (LabelMaterialSnapshot | null)[]): string {
  return row.map((material) => material?.id ?? "∅").join("");
}

// Consecutive physically-identical rows (same content in every cell) are
// rasterized once and repeated via `quantity` at the spooler instead of
// re-rasterizing pixel-identical pages - this is what makes a single-column
// bobina printing N copies of one item collapse to exactly one job with
// quantity=N, matching the pre-bobina pipeline's behavior/tests exactly.
function buildBobinaRowJobs(
  model: LabelModelSnapshot,
  geometry: BobinaSheetGeometry,
  rows: (LabelMaterialSnapshot | null)[][],
  css: string,
): BobinaRowJob[] {
  const jobs: BobinaRowJob[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    const previous = jobs[jobs.length - 1];
    if (previous && previous.key === key) {
      previous.quantity += 1;
      continue;
    }
    jobs.push({ key, html: `${css}${buildBobinaRowHtml(model, geometry, row)}`, quantity: 1, widthMm: geometry.rowWidthMm, heightMm: geometry.rowHeightMm });
  }
  return jobs;
}

// The canonical transport for every etiqueta print point. `profile` is the
// bobina currently loaded on the configured printer (see
// getConfiguredPrinter/perfil_bobina_padrao_id) - when unset (no profile
// ever configured, or an old install upgrading in place), a trivial
// single-column profile is synthesized straight from the label model's own
// width/height, reproducing the previous one-label-per-page behavior
// exactly through this same engine rather than a separate code path.
export async function printLabelBatch(
  companyId: string,
  batch: LabelPrintBatch,
  configuredPrinter?: PrinterConfig,
  profile?: BobinaPrintProfile | null,
): Promise<void> {
  const model = batch.modelo_snapshot;
  const effectiveProfile = profile ?? legacyProfileFromModel(model);
  const geometry = computeSheetGeometry(effectiveProfile);
  const flatItems = expandLabelBatch(batch);
  const rows = chunkIntoRows(flatItems, geometry.columns);
  const css = buildBobinaCss(effectiveProfile, model, geometry);
  const rasterScale = dpiToRasterScale(resolveDpi(effectiveProfile));

  await printHtmlBatch({
    companyId,
    purpose: "etiqueta",
    documentName: `Etiquetas - lote ${batch.id}`,
    configuredPrinter,
    jobs: buildBobinaRowJobs(model, geometry, rows, css).map(({ key: _key, ...job }) => ({ ...job, rasterScale })),
    webHtml: buildBobinaPrintHtml(effectiveProfile, model, flatItems, `Etiquetas - lote ${batch.id}`),
    messages: { failed: "Não foi possível enviar a etiqueta para a impressora." },
  });
}

const TEST_LABEL_MODEL_BASE: Omit<LabelModelSnapshot, "largura_mm" | "altura_mm"> = {
  id: "teste-bobina", nome: "Teste de impressão", tipo_identificacao: "ambos",
  campos: ["nome", "codigo_interno", "categoria"], tamanho_fonte: 9, mostrar_borda: true,
  margem_interna_mm: 1.5, espacamento_interno_mm: 1.5, versao: 1,
};

function buildTestCellSnapshot(column: number, geometry: BobinaSheetGeometry): LabelMaterialSnapshot {
  return {
    id: `teste-coluna-${column}`, nome: "TESTE",
    codigo_interno: `${geometry.cellWidthMm}×${geometry.cellHeightMm} mm`,
    categoria: `Coluna ${column}`, marca: null, modelo: null, numero_serie: null, numero_patrimonio: null,
    localizacao: null, empresa: "", identificador_unico: `teste-coluna-${column}`,
    conteudo_qr_code: `TESTE-COLUNA-${column}`, codigo_barras: "0000000000000",
  };
}

/**
 * "Imprimir teste de etiqueta" (section 11): exercises the EXACT same
 * pipeline as a real print (buildBobinaCss/buildBobinaRowHtml/printHtmlBatch)
 * instead of a separate simplified test-page builder, so what's validated
 * physically - borders, width, height, columns, gap, margins, alignment,
 * offset, text, barcode, QR Code - is what real batches will also produce.
 * One synthetic row with one labeled cell per column ("TESTE / WxH / Coluna N").
 */
export async function printBobinaTestPage(
  companyId: string,
  profile: BobinaPrintProfile,
  configuredPrinter?: PrinterConfig,
): Promise<void> {
  const geometry = computeSheetGeometry(profile);
  const testModel: LabelModelSnapshot = { ...TEST_LABEL_MODEL_BASE, largura_mm: geometry.cellWidthMm, altura_mm: geometry.cellHeightMm };
  const items = Array.from({ length: geometry.columns }, (_, index) => buildTestCellSnapshot(index + 1, geometry));
  const css = buildBobinaCss(profile, testModel, geometry);
  const rowHtml = buildBobinaRowHtml(testModel, geometry, items);
  const rasterScale = dpiToRasterScale(resolveDpi(profile));

  await printHtmlBatch({
    companyId,
    purpose: "etiqueta",
    documentName: "Teste de etiqueta",
    configuredPrinter,
    jobs: [{ html: `${css}${rowHtml}`, quantity: 1, widthMm: geometry.rowWidthMm, heightMm: geometry.rowHeightMm, rasterScale }],
    webHtml: `<!doctype html><html><head><meta charset="utf-8"><title>Teste de etiqueta</title>${css}</head><body>${rowHtml}</body></html>`,
    messages: { failed: "Não foi possível enviar o teste de etiqueta para a impressora." },
  });
}
