import { useId } from "react";
import { computeSheetGeometry, legacyProfileFromModel, type BobinaPrintProfile } from "@/lib/label-layout-engine";
import { buildBobinaPreviewCss, renderBobinaRowMarkup } from "@/lib/material-label-print";
import type { LabelMaterialSnapshot, LabelModelSnapshot } from "@/lib/material-label-types";

// 96 CSS px per inch / 25.4mm per inch - the same physical-size reference
// the browser itself uses to lay out CSS `mm` units, kept here only for the
// wrapper's *scaled* pixel footprint (see below); the actual label content
// is sized in real `mm` so it renders at true physical scale before the
// scale() transform shrinks/grows it for on-screen preview.
const CSS_MM_TO_PX = 96 / 25.4;

// Preview and real print render through the same bobina geometry, row markup
// and content CSS from material-label-print.tsx. With no explicit profile,
// the same legacy model-sized profile used by printLabelBatch is synthesized.
// `scope` gives each instance its own CSS namespace so multiple previews on
// one page (or re-renders) never leak `.codes`/`.field` rules into each other.
export function LabelCanvas({ model, material, profile, scale = 1 }: {
  model: LabelModelSnapshot;
  material: LabelMaterialSnapshot;
  profile?: BobinaPrintProfile | null;
  scale?: number;
}) {
  const rawId = useId();
  const scope = `#label-preview-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const effectiveProfile = profile ?? legacyProfileFromModel(model);
  const geometry = computeSheetGeometry(effectiveProfile);
  const markup = renderBobinaRowMarkup(model, geometry, [material], effectiveProfile);
  const css = buildBobinaPreviewCss(effectiveProfile, model, geometry, scope);

  return (
    <div
      id={scope.slice(1)}
      className="overflow-hidden bg-white"
      style={{ width: `${geometry.rowWidthMm * CSS_MM_TO_PX * scale}px`, height: `${geometry.rowHeightMm * CSS_MM_TO_PX * scale}px` }}
      data-testid="label-canvas"
      data-effective-width-mm={geometry.cellWidthMm}
      data-effective-height-mm={geometry.cellHeightMm}
    >
      <style>{css}</style>
      <div
        style={{ width: `${geometry.rowWidthMm}mm`, height: `${geometry.rowHeightMm}mm`, transform: `scale(${scale})`, transformOrigin: "top left" }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  );
}
