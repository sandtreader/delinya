// Rulers along the top and left of the drawing area: a tick on every drawn
// grid line (the drawing's spacing, coarsened with zoom as the grid is),
// longer every fifth, longest and labelled in mm every tenth, the same
// lines the grid draws darker (labelled more often when zoomed in past the
// spacing). Shown whether or not the grid is.

import type { Axis } from "../model";
import { formatMm } from "./format";
import { gridPitch, type View } from "./viewport";

/** How thick the rulers are, px. */
export const RULER_PX = 20;
/** Labelled ticks at least this far apart, px. */
const LABEL_GAP = 80;

export interface RulerTick {
  /** Screen px along the ruler, from the drawing area's left or top edge. */
  at: number;
  size: "minor" | "mid" | "major";
  /** The model position in mm: on major ticks, and more when zoomed in (see rulerTicks). */
  label?: string;
}

/**
 * The ticks along a ruler `lengthPx` long, from 0 to `lengthPx` inclusive:
 * the top one for axis "x", the left one for "y".
 */
export function rulerTicks(view: View, axis: Axis, lengthPx: number, gridSpacing: number): RulerTick[] {
  const pitch = gridPitch(view, gridSpacing);
  const origin = axis === "x" ? view.ox : view.oy;
  const px = pitch * view.scale;
  if (!(px > 0) || !Number.isFinite(px) || !Number.isFinite(origin) || !(lengthPx >= 0) || !Number.isFinite(lengthPx)) return [];
  // Count grid lines by index rather than adding up pitches, so a pitch like
  // 0.1 doesn't drift; the slack keeps a line on either end despite float noise.
  const first = Math.ceil((0 - origin) / px - 1e-9);
  const last = Math.floor((lengthPx - origin) / px + 1e-9);
  // Labels every tenth line, or every fifth or every line once those are
  // far enough apart: zoomed in past the spacing, tenths can be a screen apart.
  const labelEvery = px >= LABEL_GAP ? 1 : 5 * px >= LABEL_GAP ? 5 : 10;
  const ticks: RulerTick[] = [];
  for (let i = first; i <= last; i++) {
    // As the grid places its lines: origin + (i × pitch) × scale.
    const at = origin + i * pitch * view.scale;
    const size = i % 10 === 0 ? "major" : i % 5 === 0 ? "mid" : "minor";
    ticks.push(i % labelEvery === 0 ? { at, size, label: formatMm(i * pitch) } : { at, size });
  }
  return ticks;
}
