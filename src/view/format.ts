// Number formatting shared by the canvas, panels and output, so a length
// reads the same on screen, in a printout and in an export.

/** A length in mm for display: at most two decimals, no trailing zeros. */
export function formatMm(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

export type DrawTool = "line" | "rect" | "circle";

/**
 * The status bar while a new shape is dragged out from `start` to
 * `current`: where it started and how big it is. Angles as the shape
 * panel shows them, degrees from +x towards +y.
 */
export function drawStatus(tool: DrawTool, start: readonly [number, number], current: readonly [number, number]): string {
  const [x0, y0] = start, dx = current[0] - x0, dy = current[1] - y0;
  const at = `${formatMm(x0)}, ${formatMm(y0)} mm`;
  switch (tool) {
    case "rect": return `from ${at} · ${formatMm(Math.abs(dx))} × ${formatMm(Math.abs(dy))} mm`;
    case "circle": return `centre ${at} · ⌀ ${formatMm(2 * Math.hypot(dx, dy))} mm`;
    case "line": return `from ${at} · ${formatMm(Math.hypot(dx, dy))} mm at ${formatMm((Math.atan2(dy, dx) * 180) / Math.PI)}°`;
  }
}
