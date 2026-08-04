import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { LABEL_FIELD_LABELS } from "@/lib/material-label-domain";
import type { LabelField, LabelMaterialSnapshot, LabelModelSnapshot } from "@/lib/material-label-types";

function fieldValue(field: LabelField, material: LabelMaterialSnapshot) {
  const values: Record<LabelField, string> = {
    nome: material.nome,
    codigo_interno: material.codigo_interno,
    categoria: material.categoria,
    marca_modelo: [material.marca, material.modelo].filter(Boolean).join(" "),
    numero_serie: material.numero_serie ?? "",
    numero_patrimonio: material.numero_patrimonio ?? "",
    localizacao: material.localizacao ?? "",
    empresa: material.empresa,
  };
  return values[field];
}

export function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, { format: "CODE128", displayValue: true, margin: 0, height: 34, fontSize: 10 });
  }, [value]);
  return <svg ref={ref} aria-label={`Código de barras ${value}`} className="max-h-[45%] max-w-full" />;
}

export function LabelCanvas({ model, material, scale = 1 }: {
  model: LabelModelSnapshot; material: LabelMaterialSnapshot; scale?: number;
}) {
  const showQr = model.tipo_identificacao !== "codigo_barras" && material.conteudo_qr_code;
  const showBarcode = model.tipo_identificacao !== "qr_code" && material.codigo_barras;
  return (
    <div
      className={`overflow-hidden bg-white text-black ${model.mostrar_borda ? "border border-black" : ""}`}
      style={{ width: `${model.largura_mm * 3.7795 * scale}px`, height: `${model.altura_mm * 3.7795 * scale}px`, padding: `${(model.margem_interna_mm ?? 1.5) * 3.7795 * scale}px` }}
      data-testid="label-canvas"
    >
      <div className="flex h-full min-w-0" style={{ gap: `${(model.espacamento_interno_mm ?? 1.5) * 3.7795 * scale}px` }}>
        {(showQr || showBarcode) && (
          <div className="flex w-[42%] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden">
            {showQr && <QRCodeSVG value={material.conteudo_qr_code!} level="M" size={Math.min(model.altura_mm * 2.5, model.largura_mm * 1.5)} />}
            {showBarcode && <BarcodeSvg value={material.codigo_barras!} />}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden" style={{ fontSize: `${model.tamanho_fonte * scale}px`, lineHeight: 1.15 }}>
          {model.campos.map((field, index) => {
            const value = fieldValue(field, material);
            if (!value) return null;
            return <div key={field} className={index === 0 ? "font-bold" : ""}><span className="text-[0.72em] text-gray-600">{LABEL_FIELD_LABELS[field]}: </span>{value}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
