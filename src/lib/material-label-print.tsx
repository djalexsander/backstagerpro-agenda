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
import type { LabelField, LabelMaterialSnapshot, LabelModelSnapshot, LabelPrintBatch } from "./material-label-types";
import { printHtmlBatch } from "./printer-service";
import type { PrinterConfig } from "./printer-types";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

// QR source sizing remains independent from Code128's physical module
// calculation below. Preview and print still use this same renderer.
function qrIntrinsicSizePx(model: Pick<LabelModelSnapshot, "altura_mm" | "largura_mm">) {
  return Math.min(model.altura_mm * 2.2, model.largura_mm * 1.3);
}

// A barcode's human-readable value is only worth rendering when the label is
// tall enough that it won't be squeezed into illegibility by the barcode's
// own max-height clamp below - shorter labels still get a correct, scannable
// CODE128, just without the sub-millimeter text under it.
const MIN_HEIGHT_MM_FOR_BARCODE_TEXT = 15;
const POINT_TO_MM = 25.4 / 72;
const CSS_PX_PER_MM = 96 / 25.4;
const CODE128_QUIET_ZONE_MODULES = 10;
// Aim for a 0.254mm X-dimension (2 dots at 203 DPI, 3 at 300 DPI). Legacy
// BSP values may step down to one whole raster dot to remain complete, but
// never to a fractional/sub-pixel module; CSS is forbidden from shrinking it.
const CODE128_TARGET_MODULE_MM = 0.254;
const CODE128_MIN_MODULE_DOTS = 1;

interface BarcodePhysicalGeometry {
  widthMm: number;
  heightMm: number;
  dpi: number;
}

function informationAreaHeightMm(model: LabelModelSnapshot) {
  return model.altura_mm <= 30 ? 11 : Math.min(16, model.altura_mm * 0.4);
}

function effectiveLabelFontPt(model: LabelModelSnapshot) {
  const priorityLineCount =
    (model.campos.includes("nome") ? 2 : 0) +
    (model.campos.includes("empresa") ? 1 : 0);
  if (priorityLineCount === 0) return model.tamanho_fonte;

  const maximumFontForPriorityFields =
    informationAreaHeightMm(model) / (priorityLineCount * POINT_TO_MM * 1.08);
  return Math.min(model.tamanho_fonte, maximumFontForPriorityFields);
}

function barcodeHumanFontSizePx(model: Pick<LabelModelSnapshot, "altura_mm">) {
  return Math.max(13, Math.min(16, Math.round(model.altura_mm * 0.35)));
}

function code128ModuleCount(value: string, compactNumeric: boolean) {
  const dataCodewords = compactNumeric ? value.length / 2 : value.length;
  return (dataCodewords + 3) * 11 + 2;
}

function barcodePhysicalGeometry(
  model: LabelModelSnapshot,
  profile?: BobinaPrintProfile,
  geometry?: BobinaSheetGeometry,
): BarcodePhysicalGeometry {
  if (!profile || !geometry) {
    return { widthMm: model.largura_mm, heightMm: model.altura_mm, dpi: resolveDpi({ dpi: "automatico" }) };
  }
  const landscape = profile.orientacao === "paisagem";
  return {
    widthMm: landscape ? geometry.cellHeightMm : geometry.cellWidthMm,
    heightMm: landscape ? geometry.cellWidthMm : geometry.cellHeightMm,
    dpi: resolveDpi(profile),
  };
}

function barcodeMarkup(value: string, model: LabelModelSnapshot, physical: BarcodePhysicalGeometry) {
  const compactNumeric = /^\d{10}$/.test(value);
  const format = compactNumeric ? "CODE128C" : "CODE128";
  const moduleCount = code128ModuleCount(value, compactNumeric);
  const totalModules = moduleCount + CODE128_QUIET_ZONE_MODULES * 2;
  const borderMm = model.mostrar_borda ? 0.5 : 0;
  const availableWidthMm = Math.max(1, physical.widthMm - 2 * (model.margem_interna_mm ?? 1.5) - borderMm);
  const maximumFittingDots = Math.floor((availableWidthMm / 25.4 * physical.dpi) / totalModules);
  const targetDots = Math.max(2, Math.round(CODE128_TARGET_MODULE_MM / 25.4 * physical.dpi));
  const moduleDots = Math.max(CODE128_MIN_MODULE_DOTS, Math.min(targetDots, maximumFittingDots));
  const moduleWidthPx = moduleDots * 96 / physical.dpi;
  const quietZonePx = moduleWidthPx * CODE128_QUIET_ZONE_MODULES;
  const showHumanText =
    physical.heightMm >= MIN_HEIGHT_MM_FOR_BARCODE_TEXT &&
    maximumFittingDots >= targetDots;
  const humanFontSizePx = barcodeHumanFontSizePx({ altura_mm: physical.heightMm });
  const informationHeightMm = informationAreaHeightMm(model);
  const codeAreaHeightMm = Math.max(
    6,
    physical.heightMm - 2 * (model.margem_interna_mm ?? 1.5) - (model.espacamento_interno_mm ?? 1.5) - informationHeightMm,
  );
  const humanTextHeightMm = showHumanText ? humanFontSizePx / CSS_PX_PER_MM + 0.6 : 0;
  const barHeightPx = Math.max(6, codeAreaHeightMm - humanTextHeightMm) * CSS_PX_PER_MM;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, value, {
    format,
    width: moduleWidthPx,
    height: barHeightPx,
    // Lateral quiet zone only (top/bottom stay at 0) - a real quiet zone
    // baked into the generated SVG itself, not left to whatever margin the
    // surrounding layout happens to leave, and never at the cost of bar
    // height, which is the one dimension this code type is prioritized for.
    marginTop: 0, marginBottom: 0, marginLeft: quietZonePx, marginRight: quietZonePx,
    font: "Arial",
    fontOptions: "bold",
    fontSize: humanFontSizePx,
    textMargin: Math.max(1, Math.round(0.6 * CSS_PX_PER_MM)),
    displayValue: showHumanText,
  });
  const intrinsicWidth = Number.parseFloat(svg.getAttribute("width") ?? "") || totalModules * moduleWidthPx;
  const intrinsicHeight = Number.parseFloat(svg.getAttribute("height") ?? "") || barHeightPx;
  svg.setAttribute("viewBox", `0 0 ${intrinsicWidth} ${intrinsicHeight}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("data-code128-format", format);
  svg.setAttribute("data-module-dots", String(moduleDots));
  svg.setAttribute("data-module-mm", (moduleDots / physical.dpi * 25.4).toFixed(3));
  svg.setAttribute("data-quiet-zone-modules", String(CODE128_QUIET_ZONE_MODULES));
  svg.style.width = `${(intrinsicWidth / CSS_PX_PER_MM).toFixed(3)}mm`;
  svg.style.height = "100%";
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "100%";
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
export function renderLabelMarkup(
  model: LabelModelSnapshot,
  material: LabelMaterialSnapshot,
  physical = barcodePhysicalGeometry(model),
) {
  const wantsQr = model.tipo_identificacao !== "codigo_barras";
  const wantsBarcode = model.tipo_identificacao !== "qr_code";
  const qr = wantsQr && material.conteudo_qr_code
    ? `<div class="qr-code">${renderToStaticMarkup(
        <QRCodeSVG value={material.conteudo_qr_code} level="M" size={qrIntrinsicSizePx(model)} marginSize={2} />,
      )}</div>`
    : "";
  const barcode = wantsBarcode && material.codigo_barras
    ? `<div class="barcode">${barcodeMarkup(material.codigo_barras, model, physical)}</div>` : "";
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
    return value ? {
      field,
      markup: `<div class="field field-${field} ${index === 0 ? "primary" : ""}"><small>${escapeHtml(LABEL_FIELD_LABELS[field])}:</small> ${escapeHtml(value)}</div>`,
    } : null;
  }).filter((entry): entry is { field: LabelField; markup: string } => entry !== null);
  const identityFields = fields
    .filter(({ field }) => field === "nome" || field === "empresa")
    .map(({ markup }) => markup)
    .join("");
  const secondaryFields = fields
    .filter(({ field }) => field !== "nome" && field !== "empresa")
    .map(({ markup }) => markup)
    .join("");
  return `<article class="label"><div class="fields">${identityFields ? `<div class="identity-fields">${identityFields}</div>` : ""}${secondaryFields ? `<div class="secondary-fields">${secondaryFields}</div>` : ""}</div><div class="codes">${qr}${barcode}${missing}</div></article>`;
}

// Shared `.label`/`.fields`/`.codes` rules - the visual contract for one
// label's content, independent of whatever positions the label on the page
// (@page for a single label, absolute cell positioning for a bobina row, or
// a scale() transform for the on-screen preview). Kept as its own function
// (rather than inlined twice) so buildLabelSheetCss, buildBobinaCss and
// LabelCanvas.tsx's preview can never drift from each other again.
//
// The outer grid reserves separate rows for information and codes, so flex
// sizing inside the barcode can never compress the text. Name/company are
// kept in the priority group (two lines and one line respectively); any
// secondary fields use only the remaining information-row space. QR and
// Code128 retain aspect-preserving max-width/max-height caps, and the label
// itself fills the same explicitly sized surface in preview and print.
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
  const informationHeight = informationAreaHeightMm(model);
  const effectiveFontSize = effectiveLabelFontPt(model);
  // The "QR capped small, Code128 takes the rest" split only makes sense
  // when both are actually present - a QR-only or Code128-only model must
  // still get the *entire* codes area for its one code, not be shrunk by a
  // rule written for the combined case.
  const isCombined = model.tipo_identificacao === "ambos";
  const qrFlex = isCombined
    ? "flex: 0 0 auto; max-width: 60%; max-height: 34%;"
    : "flex: 1 1 auto; min-height: 0; max-width: 100%; max-height: 100%;";
  return `
    ${prefix}.label { box-sizing: border-box; width: 100%; height: 100%; padding: ${model.margem_interna_mm ?? 1.5}mm; overflow: hidden; display: grid; grid-template-rows: minmax(0, ${informationHeight}mm) minmax(0, 1fr); gap: ${model.espacamento_interno_mm ?? 1.5}mm; color: #000; font-family: Arial, sans-serif; ${model.mostrar_borda ? "border: .25mm solid #000;" : ""} }
    ${prefix}.fields { min-width: 0; min-height: 0; width: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); align-content: start; overflow: visible; font-size: ${effectiveFontSize.toFixed(3)}pt; line-height: 1.08; }
    ${prefix}.identity-fields, ${prefix}.secondary-fields { min-width: 0; }
    ${prefix}.identity-fields { overflow: visible; }
    ${prefix}.secondary-fields { min-height: 0; overflow: hidden; }
    ${prefix}.field { min-width: 0; overflow-wrap: anywhere; }
    ${prefix}.field-nome { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
    ${prefix}.field-empresa, ${prefix}.secondary-fields .field { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${prefix}.field.primary { font-weight: 700; } ${prefix}small { color: #555; font-size: .72em; }
    ${prefix}.codes { min-width: 0; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 1mm; overflow: hidden; }
    ${prefix}.codes .qr-code { ${qrFlex} width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; }
    ${prefix}.codes .qr-code svg { max-width: 100%; max-height: 100%; }
    ${prefix}.codes .barcode { flex: 1 1 auto; min-width: 0; min-height: 0; width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; }
    ${prefix}.codes .barcode svg { display: block; flex: 0 0 auto; max-width: none; max-height: 100%; }
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
    ${buildLabelContentCss(model)}
    .label { width: ${model.largura_mm}mm; height: ${model.altura_mm}mm; page-break-after: always; }
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
function buildBobinaGeometryCss(
  profile: Pick<BobinaPrintProfile, "orientacao">,
  geometry: BobinaSheetGeometry,
  scope = "",
) {
  const prefix = scope ? `${scope} ` : "";
  const labelBox = profile.orientacao === "paisagem"
    ? `position: absolute; left: 50%; top: 50%; width: ${geometry.cellHeightMm}mm; height: ${geometry.cellWidthMm}mm; transform: translate(-50%, -50%) rotate(90deg);`
    : `width: 100%; height: 100%;`;
  return `
    ${prefix}.row { position: relative; width: ${geometry.rowWidthMm}mm; height: ${geometry.rowHeightMm}mm; background: white; }
    ${prefix}.cell { position: absolute; width: ${geometry.cellWidthMm}mm; height: ${geometry.cellHeightMm}mm; overflow: hidden; }
    ${prefix}.cell .label { ${labelBox} }
  `;
}

export function buildBobinaPreviewCss(
  profile: BobinaPrintProfile,
  model: LabelModelSnapshot,
  geometry: BobinaSheetGeometry,
  scope: string,
) {
  return `${buildBobinaGeometryCss(profile, geometry, scope)}${buildLabelContentCss(model, scope)}`;
}

function buildBobinaCss(profile: BobinaPrintProfile, model: LabelModelSnapshot, geometry: BobinaSheetGeometry) {
  return `<style>
    @page { size: ${geometry.rowWidthMm}mm ${geometry.rowHeightMm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; }
    ${buildBobinaGeometryCss(profile, geometry)}
    .row { page-break-after: always; }
    ${buildLabelContentCss(model)}
    @media screen { body { background: #ddd; } .row { margin: 8px auto; box-shadow: 0 1px 6px #777; } }
  </style>`;
}

// One row's markup: `columns` cells, positioned per computeSheetGeometry.
// A null cell (last, partial row - e.g. an odd quantity in a 2-column
// bobina) renders empty but keeps its slot, so every row - including the
// last - shares the exact same physical geometry/calibration.
export function renderBobinaRowMarkup(
  model: LabelModelSnapshot,
  geometry: BobinaSheetGeometry,
  rowItems: (LabelMaterialSnapshot | null)[],
  profile?: BobinaPrintProfile,
) {
  const physical = barcodePhysicalGeometry(model, profile, geometry);
  const cells = geometry.cellPositions.map((position, index) => {
    const material = rowItems[index];
    const content = material ? renderLabelMarkup(model, material, physical) : "";
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
  const body = rows.map((row) => renderBobinaRowMarkup(model, geometry, row, profile)).join("");
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
  profile: BobinaPrintProfile,
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
    jobs.push({ key, html: `${css}${renderBobinaRowMarkup(model, geometry, row, profile)}`, quantity: 1, widthMm: geometry.rowWidthMm, heightMm: geometry.rowHeightMm });
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
    jobs: buildBobinaRowJobs(effectiveProfile, model, geometry, rows, css).map(({ key: _key, ...job }) => ({ ...job, rasterScale })),
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
 * pipeline as a real print (buildBobinaCss/renderBobinaRowMarkup/printHtmlBatch)
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
  const rowHtml = renderBobinaRowMarkup(testModel, geometry, items, profile);
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
