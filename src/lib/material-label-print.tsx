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

// Single canonical intrinsic-size formula for the code SVGs, used by every
// rendering path (preview and real print alike - section 11 of the request
// that produced this: "preview e impressão real devem usar a MESMA função de
// renderização"). Before this, LabelCanvas.tsx (preview) and this module
// (real print) each hardcoded their own slightly different multipliers
// (2.5/1.5 vs 3/1.8, barcode height 34/10 vs 42/11), so what an operator
// previewed didn't quite match what got rasterized. The exact multiplier
// barely matters for final on-screen/print size - buildLabelContentCss's
// `svg { max-width/max-height }` is what actually clamps the visible result
// - but it does need to be big enough that CODE128's bars and the QR modules
// aren't generated at a source resolution too small to stay crisp once
// html2canvas rasterizes at the bobina's DPI-derived scale. QR is
// deliberately the smaller of the two budgets (Code128 is the read-priority
// code - see buildLabelContentCss below): this only sets how crisp its
// *source* is, the actual on-label size is capped separately by CSS.
function qrIntrinsicSizePx(model: Pick<LabelModelSnapshot, "altura_mm" | "largura_mm">) {
  return Math.min(model.altura_mm * 2.2, model.largura_mm * 1.3);
}

// Code128 gets a generously scaled intrinsic height so its bars are rendered
// at a source resolution proportional to the label itself, not a fixed 42px
// regardless of a 30mm vs 100mm label (section "CODE 128... aumentar
// significativamente largura e altura" / "não esticar bitmap artificialmente;
// gerar o SVG/Code128 nas dimensões corretas"). The bar *module* width is
// intentionally left at JsBarcode's default rather than also scaled by
// largura_mm: CODE128's overall width is value-length-driven, and inflating
// module width on top of that would fight the aspect-preserving CSS clamp
// below (a wider intrinsic SVG can end up *height*-constrained instead of
// width-constrained, working against "aumentar altura"). Width is instead
// grown by giving the barcode's own flex box the label's full width (no
// longer sharing it with a side-by-side fields column) - see
// buildLabelContentCss.
function barcodeIntrinsicHeightPx(model: Pick<LabelModelSnapshot, "altura_mm">) {
  return Math.max(42, Math.round(model.altura_mm * 3));
}

// A barcode's human-readable value is only worth rendering when the label is
// tall enough that it won't be squeezed into illegibility by the barcode's
// own max-height clamp below - shorter labels still get a correct, scannable
// CODE128, just without the sub-millimeter text under it.
const MIN_HEIGHT_MM_FOR_BARCODE_TEXT = 15;

function barcodeMarkup(value: string, model: Pick<LabelModelSnapshot, "altura_mm">) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, {
    format: "CODE128",
    height: barcodeIntrinsicHeightPx(model),
    // Lateral quiet zone only (top/bottom stay at 0) - a real quiet zone
    // baked into the generated SVG itself, not left to whatever margin the
    // surrounding layout happens to leave, and never at the cost of bar
    // height, which is the one dimension this code type is prioritized for.
    marginTop: 0, marginBottom: 0, marginLeft: 8, marginRight: 8,
    fontSize: 11,
    displayValue: model.altura_mm >= MIN_HEIGHT_MM_FOR_BARCODE_TEXT,
  });
  return svg.outerHTML;
}

// One physical label's markup (QR/barcode + fields), shared by the web
// iframe and offscreen desktop rasterization paths, AND by LabelCanvas.tsx's
// on-screen preview (via dangerouslySetInnerHTML) - there is exactly one
// function that turns a model+material into label content markup, never a
// second parallel implementation.
//
// Visual order is fields-then-codes (name/código on top, codes below) so the
// column flex layout in buildLabelContentCss stacks them in that order
// without needing any explicit `order:` CSS. QR and barcode are each wrapped
// in their own classed container (.qr-code / .barcode) so CSS can size them
// independently (QR capped small, Code128 given the remaining/priority
// space) - two bare sibling <svg>s couldn't be told apart by a selector.
export function renderLabelMarkup(model: LabelModelSnapshot, material: LabelMaterialSnapshot) {
  const wantsQr = model.tipo_identificacao !== "codigo_barras";
  const wantsBarcode = model.tipo_identificacao !== "qr_code";
  const qr = wantsQr && material.conteudo_qr_code
    ? `<div class="qr-code">${renderToStaticMarkup(
        <QRCodeSVG value={material.conteudo_qr_code} level="M" size={qrIntrinsicSizePx(model)} marginSize={2} />,
      )}</div>`
    : "";
  const barcode = wantsBarcode && material.codigo_barras
    ? `<div class="barcode">${barcodeMarkup(material.codigo_barras, model)}</div>` : "";
  // In normal operation this never happens - Etiquetas.tsx blocks adding a
  // material the selected model can't identify, and LabelPrintDialog blocks
  // the print button the same way - but neither of those is retroactive to
  // a model swapped after the fact, and this function must never invent a
  // fake QR/barcode value to paper over it (section 7/8: "não inventar um
  // valor"). Rather than silently leaving `.codes` empty - indistinguishable
  // from "this model doesn't use codes", which never actually happens, since
  // every tipo_identificacao wants at least one - render an explicit marker
  // so a missing identifier is visible directly on the label content itself,
  // in both the preview and (were it ever reached) a real print.
  const missing = (wantsQr && !qr) || (wantsBarcode && !barcode)
    ? `<div class="codes-missing">Sem identificação</div>` : "";
  const fieldValues = { nome: material.nome, codigo_interno: material.codigo_interno, categoria: material.categoria,
    marca_modelo: [material.marca, material.modelo].filter(Boolean).join(" "), numero_serie: material.numero_serie,
    numero_patrimonio: material.numero_patrimonio, localizacao: material.localizacao, empresa: material.empresa };
  const fields = model.campos.map((field, index) => {
    const value = fieldValues[field];
    return value ? `<div class="field ${index === 0 ? "primary" : ""}"><small>${escapeHtml(LABEL_FIELD_LABELS[field])}:</small> ${escapeHtml(value)}</div>` : "";
  }).join("");
  return `<article class="label"><div class="fields">${fields}</div><div class="codes">${qr}${barcode}${missing}</div></article>`;
}

// Shared `.label`/`.fields`/`.codes` rules - the visual contract for one
// label's content, independent of whatever positions the label on the page
// (@page for a single label, absolute cell positioning for a bobina row, or
// a scale() transform for the on-screen preview). Kept as its own function
// (rather than inlined twice) so buildLabelSheetCss, buildBobinaCss and
// LabelCanvas.tsx's preview can never drift from each other again.
//
// Layout is a single column stack, always in this order (DOM order in
// renderLabelMarkup drives it, no `order:` overrides): name/fields on top
// (bold primary field, controlled wrapping, full label width), QR below at
// a modest capped size, then Code128 last getting whatever height remains -
// the "prioridade de leitura" code. This replaced an earlier row-beside-
// column layout (fields beside a shared 42%-wide codes column, QR and
// Code128 splitting that column ~50/50) that put the name laterally next to
// the QR and gave both codes equal weight; every element here still gets an
// aspect-preserving max-width/max-height cap (never `width/height: 100%`,
// which would distort a barcode/QR that doesn't match its box's aspect
// ratio) and `overflow: hidden` at every level, so nothing can grow past its
// box or overlap a sibling regardless of how small the label is - a very
// short label first loses the fields column's headroom (flex: 0 1 auto, not
// flex: 1, so it never claims space Code128 needs) and the barcode's own
// tiny-label behavior (see MIN_HEIGHT_MM_FOR_BARCODE_TEXT above), never the
// barcode's bars themselves.
//
// `scope` namespaces every selector (e.g. "#label-preview-xyz") so this can
// be safely injected as a plain <style> tag into the live React app's shared
// DOM (LabelCanvas.tsx) without its bare `.label`/`.codes`/`.fields` classes
// leaking into or colliding with another LabelCanvas instance rendered
// elsewhere on the same page - the print callers below render into an
// isolated document per job and never pass a scope, so their output is
// unchanged (bare classes, exactly as before).
export function buildLabelContentCss(model: LabelModelSnapshot, scope = "") {
  const prefix = scope ? `${scope} ` : "";
  // The "QR capped small, Code128 takes the rest" split only makes sense
  // when both are actually present - a QR-only or Code128-only model must
  // still get the *entire* codes area for its one code, not be shrunk by a
  // rule written for the combined case.
  const isCombined = model.tipo_identificacao === "ambos";
  const qrFlex = isCombined
    ? "flex: 0 0 auto; max-width: 60%; max-height: 34%;"
    : "flex: 1 1 auto; min-height: 0; max-width: 100%; max-height: 100%;";
  return `
    ${prefix}.label { padding: ${model.margem_interna_mm ?? 1.5}mm; overflow: hidden; display: flex; flex-direction: column; gap: ${model.espacamento_interno_mm ?? 1.5}mm; color: #000; font-family: Arial, sans-serif; ${model.mostrar_borda ? "border: .25mm solid #000;" : ""} }
    ${prefix}.fields { flex: 0 1 auto; min-height: 0; width: 100%; display: flex; flex-direction: column; justify-content: center; overflow: hidden; font-size: ${model.tamanho_fonte}pt; line-height: 1.15; }
    ${prefix}.field { overflow-wrap: anywhere; } ${prefix}.field.primary { font-weight: 700; } ${prefix}small { color: #555; font-size: .72em; }
    ${prefix}.codes { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 1mm; overflow: hidden; }
    ${prefix}.codes .qr-code { ${qrFlex} width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; }
    ${prefix}.codes .qr-code svg { max-width: 100%; max-height: 100%; }
    ${prefix}.codes .barcode { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; }
    ${prefix}.codes .barcode svg { max-width: 100%; max-height: 100%; }
    ${prefix}.codes-missing { font-size: .6em; font-weight: 700; text-align: center; border: .25mm dashed #666; padding: 1mm; }
  `;
}

// Shared between the popup document (web) and the offscreen rasterization
// container (desktop) - `@page` only matters for the former, but it's
// harmless for html2canvas to see it too, so one string serves both.
export function buildLabelSheetCss(model: LabelModelSnapshot) {
  return `<style>
    @page { size: ${model.largura_mm}mm ${model.altura_mm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; }
    .label { width: ${model.largura_mm}mm; height: ${model.altura_mm}mm; page-break-after: always; }
    ${buildLabelContentCss(model)}
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
    .cell .label { ${labelBox} }
    ${buildLabelContentCss(model)}
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
