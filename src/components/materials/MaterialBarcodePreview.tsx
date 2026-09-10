import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { isValidEan13 } from "@/lib/material-identification";

// Automatic codes are now 13-digit EAN-13 (see generate_material_barcode);
// render them as a real EAN-13 symbol. Legacy 10-digit numeric codes stay on
// the compact CODE128 C set, and anything else (manual, legacy BSP-...) on
// plain CODE128.
function barcodeFormat(value: string): "EAN13" | "CODE128C" | "CODE128" {
  if (isValidEan13(value)) return "EAN13";
  if (/^\d{10}$/.test(value)) return "CODE128C";
  return "CODE128";
}

export function MaterialBarcodePreview({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    JsBarcode(svgRef.current, value, {
      format: barcodeFormat(value),
      width: 1.5,
      height: 54,
      margin: 8,
      fontSize: 14,
      textMargin: 3,
      displayValue: true,
    });
  }, [value]);

  return (
    <svg
      ref={svgRef}
      className="h-24 max-w-full"
      role="img"
      aria-label={`Código de barras ${value}`}
    />
  );
}
