import JsBarcode from "jsbarcode";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { expandLabelBatch, LABEL_FIELD_LABELS } from "./material-label-domain";
import type { LabelMaterialSnapshot, LabelPrintBatch } from "./material-label-types";

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

export function openLabelPrintWindow() {
  return window.open("", "_blank", "popup,width=900,height=700");
}

export function printLabelRequest(request: LabelPrintBatch, target?: Window | null) {
  const popup = target ?? openLabelPrintWindow();
  if (!popup) throw new Error("O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.");
  const model = request.modelo_snapshot;
  const renderLabel = (material: LabelMaterialSnapshot) => {
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
  };
  const labels = expandLabelBatch(request).map(renderLabel).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas - lote ${escapeHtml(request.id)}</title><style>
    @page { size: ${model.largura_mm}mm ${model.altura_mm}mm; margin: 0; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: white; }
    .label { width: ${model.largura_mm}mm; height: ${model.altura_mm}mm; padding: ${model.margem_interna_mm ?? 1.5}mm; overflow: hidden; page-break-after: always; display: flex; gap: ${model.espacamento_interno_mm ?? 1.5}mm; color: #000; font-family: Arial, sans-serif; ${model.mostrar_borda ? "border: .25mm solid #000;" : ""} }
    .codes { width: 42%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1mm; overflow: hidden; }
    .codes:empty { display: none; } .codes svg { max-width: 100%; max-height: 48%; }
    .fields { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; font-size: ${model.tamanho_fonte}pt; line-height: 1.15; }
    .field { overflow-wrap: anywhere; } .field.primary { font-weight: 700; } small { color: #555; font-size: .72em; }
    @media screen { body { background: #ddd; } .label { margin: 8px auto; background: white; box-shadow: 0 1px 6px #777; } }
  </style></head><body>${labels}<script>window.addEventListener('load',function(){window.focus();window.print();});</script></body></html>`);
  popup.document.close();
}
