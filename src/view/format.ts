// Number formatting shared by the canvas, panels and output, so a length
// reads the same on screen, in a printout and in an export.

/** A length in mm for display: at most two decimals, no trailing zeros. */
export function formatMm(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}
