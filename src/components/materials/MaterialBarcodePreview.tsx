import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function MaterialBarcodePreview({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    JsBarcode(svgRef.current, value, {
      format: /^\d{10}$/.test(value) ? "CODE128C" : "CODE128",
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
