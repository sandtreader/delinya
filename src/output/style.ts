// Fixed sizes for output, in paper millimetres. Shared by every renderer so
// a printout, its PDF and the preview match.

import { dashArray } from "../model";
import type { PathPrim } from "./types";

export const STYLE = {
  /** Stroke widths by role. */
  stroke: { shape: 0.35, dimension: 0.18, furniture: 0.2, guide: 0.2 },
  /**
   * Ink by role, for strokes and text alike. Dimensions are a mid blue so
   * they read as annotation, not part (and print lighter in greyscale).
   */
  colour: { shape: "#000000", dimension: "#3070c0", furniture: "#000000", guide: "#000000" },
  /** Dash pattern for "guide" paths (tile overlap lines). */
  guideDash: [2, 1.5] as const,
  /** Dimension and radius-label text size. */
  textSize: 3,
  /** Footer and ruler label size. */
  footerTextSize: 2.5,
  /** Half-length of a dimension's end ticks. */
  tick: 1.2,
  /** Clear space kept around the drawing's bounds. */
  padding: 2,
};

/**
 * How a path is stroked: its shape's own line style, else its role's width
 * (dashed for guides). `dash` is the array to draw with round caps; [] is solid.
 */
export function strokeOf(p: PathPrim): { width: number; dash: readonly number[] } {
  if (p.line) return { width: p.line.width, dash: dashArray(p.line.dash, p.line.width) };
  return { width: STYLE.stroke[p.role], dash: p.role === "guide" ? STYLE.guideDash : [] };
}

/** Blank border on every page; most printers can't reach the edge. */
export const PAGE_MARGIN = 10;
/**
 * Band at the bottom of the printable area: the check ruler on the left,
 * the title block on the right. The drawing area stops above it.
 */
export const FOOTER_HEIGHT = 30;
/** The title block, flush with the bottom-right corner of the printable area. */
export const TITLE_BLOCK = { width: 80, height: 30 };
/** How much neighbouring tiles repeat, so they can be lined up and taped. */
export const TILE_OVERLAP = 10;
/** Length of the check ruler. */
export const RULER_LENGTH = 100;
/** Padding around an SVG export, model mm. */
export const SVG_PADDING = 5;
