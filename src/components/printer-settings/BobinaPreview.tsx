import { computeSheetGeometry, type BobinaLayoutInput } from "@/lib/label-layout-engine";

const MAX_PREVIEW_WIDTH_PX = 320;
const MAX_PX_PER_MM = 3.5;

/**
 * Renders the bobina's row/column grid using computeSheetGeometry - the
 * exact same function the print pipeline calls (material-label-print.tsx) -
 * so the preview can never drift from what actually gets printed. Purely
 * presentational: mm -> screen px here is unrelated to the DPI used for the
 * real offscreen rasterization/print step.
 */
export function BobinaPreview({
  profile,
  rows = 2,
  cellLabel,
}: {
  profile: BobinaLayoutInput;
  rows?: number;
  cellLabel?: (row: number, column: number) => string;
}) {
  const geometry = computeSheetGeometry(profile);
  const pxPerMm = Math.min(MAX_PX_PER_MM, MAX_PREVIEW_WIDTH_PX / Math.max(geometry.rowWidthMm, 1));
  // Vertical gap is drawn here for visual fidelity only - it's not part of
  // rowHeightMm (see the comment on computeSheetGeometry): the physical gap
  // between rows is produced by the printer's own GAP sensor, not by pixels
  // we render.
  const rowStepMm = geometry.rowHeightMm + Math.max(profile.espacamento_vertical_mm ?? 0, 0);
  const totalWidthPx = geometry.rowWidthMm * pxPerMm;
  const totalHeightPx = (rowStepMm * Math.max(rows - 1, 0) + geometry.rowHeightMm) * pxPerMm;

  return (
    <div className="space-y-1.5">
      <div
        className="relative rounded-sm bg-white shadow-sm ring-1 ring-border"
        style={{ width: totalWidthPx, height: totalHeightPx }}
        data-testid="bobina-preview"
      >
        {Array.from({ length: rows }, (_, row) => row).flatMap((row) =>
          geometry.cellPositions.map((cell) => (
            <div
              key={`${row}-${cell.column}`}
              className="absolute flex items-center justify-center overflow-hidden rounded-[2px] border border-dashed border-muted-foreground/50 bg-muted/40 px-1 text-center text-[9px] leading-tight text-muted-foreground"
              style={{
                left: cell.xMm * pxPerMm,
                top: (cell.yMm + row * rowStepMm) * pxPerMm,
                width: geometry.cellWidthMm * pxPerMm,
                height: geometry.cellHeightMm * pxPerMm,
              }}
            >
              {cellLabel ? cellLabel(row, cell.column) : `Etiqueta ${row * geometry.columns + cell.column + 1}`}
            </div>
          )),
        )}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        {geometry.rowWidthMm.toFixed(1)} × {geometry.rowHeightMm.toFixed(1)} mm por linha · {geometry.columns} coluna{geometry.columns > 1 ? "s" : ""}
      </p>
    </div>
  );
}
