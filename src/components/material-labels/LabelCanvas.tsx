import { useId } from "react";
import { buildLabelContentCss, renderLabelMarkup } from "@/lib/material-label-print";
import type { LabelMaterialSnapshot, LabelModelSnapshot } from "@/lib/material-label-types";

// 96 CSS px per inch / 25.4mm per inch - the same physical-size reference
// the browser itself uses to lay out CSS `mm` units, kept here only for the
// wrapper's *scaled* pixel footprint (see below); the actual label content
// is sized in real `mm` so it renders at true physical scale before the
// scale() transform shrinks/grows it for on-screen preview.
const CSS_MM_TO_PX = 96 / 25.4;

// Preview and real print render through the exact same function
// (renderLabelMarkup + buildLabelContentCss, both in material-label-print.tsx)
// instead of two hand-maintained implementations - see that module's
// comments for why this matters (section 11: they must never drift again).
// `scope` gives each instance its own CSS namespace so multiple previews on
// one page (or re-renders) never leak `.codes`/`.field` rules into each other.
export function LabelCanvas({ model, material, scale = 1 }: {
  model: LabelModelSnapshot; material: LabelMaterialSnapshot; scale?: number;
}) {
  const rawId = useId();
  const scope = `#label-preview-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const markup = renderLabelMarkup(model, material);
  const css = buildLabelContentCss(model, scope);

  return (
    <div
      id={scope.slice(1)}
      className="overflow-hidden bg-white"
      style={{ width: `${model.largura_mm * CSS_MM_TO_PX * scale}px`, height: `${model.altura_mm * CSS_MM_TO_PX * scale}px` }}
      data-testid="label-canvas"
    >
      <style>{css}</style>
      <div
        style={{ width: `${model.largura_mm}mm`, height: `${model.altura_mm}mm`, transform: `scale(${scale})`, transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  );
}
