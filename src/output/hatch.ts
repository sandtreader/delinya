// Fill patterns: the marks of a layer's hatch, in paper mm.
//
// Spacing, angle, line width and dot size are fixed on paper, as line
// widths are, so a pattern looks the same at any print scale. Marks sit on
// a lattice anchored at the origin, so neighbouring shapes' patterns line up
// and a shape's pattern doesn't shift as it moves. Renderers clip the marks
// to the shape and draw them in the layer's ink at FILL_OPACITY.

import type { Bounds, HatchPattern, Point } from "../model";
import { svgNumber as num } from "../view/textSvg";

/** Distance between neighbouring lines or dots, paper mm. */
export const HATCH_SPACING = 2.5;
/** A pattern line's width, paper mm. */
export const HATCH_LINE_WIDTH = 0.18;
/** A dot's diameter, paper mm. */
export const HATCH_DOT_SIZE = 0.4;

/**
 * The pattern's marks over `bounds`: line segments clipped to it, and dot
 * centres inside it. "lines" run at 45° (down to the right, y down) on
 * x − y = k·spacing·√2, so `spacing` apart; "crosshatch" adds lines up to the
 * right on x + y = k·spacing·√2; "grid" is horizontal and vertical lines
 * every `spacing` from the origin; "dots" a dot on every point of that grid.
 */
export function hatchMarks(bounds: Bounds, pattern: HatchPattern, spacing = HATCH_SPACING): { lines: Array<[Point, Point]>; dots: Point[] } {
  const lines: Array<[Point, Point]> = [], dots: Point[] = [];
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY, spacing].every(Number.isFinite) || !(spacing > 0) || minX > maxX || minY > maxY) return { lines, dots };

  if (pattern === "dots" || pattern === "grid") {
    const xs = steps(minX, maxX, spacing), ys = steps(minY, maxY, spacing);
    if (pattern === "dots") {
      for (const y of ys) for (const x of xs) dots.push([x, y]);
    } else {
      for (const y of ys) lines.push([[minX, y], [maxX, y]]);
      for (const x of xs) lines.push([[x, minY], [x, maxY]]);
    }
    return { lines, dots };
  }

  const step = spacing * Math.SQRT2;
  // Down to the right: x = y + c, so y runs where x is also in bounds.
  for (const c of steps(minX - maxY, maxX - minY, step)) {
    const y0 = Math.max(minY, minX - c), y1 = Math.min(maxY, maxX - c);
    if (y1 - y0 > 1e-9) lines.push([[y0 + c, y0], [y1 + c, y1]]);
  }
  if (pattern === "crosshatch") {
    // Up to the right: x = c − y.
    for (const c of steps(minX + minY, maxX + maxY, step)) {
      const y0 = Math.max(minY, c - maxX), y1 = Math.min(maxY, c - minX);
      if (y1 - y0 > 1e-9) lines.push([[c - y0, y0], [c - y1, y1]]);
    }
  }
  return { lines, dots };
}

/**
 * The pattern as a repeating tile, for renderers that tile it (an SVG
 * <pattern> in user space, its corner on the origin, so the same lattice as
 * hatchMarks'): the tile's side, and its marks as SVG path data, filled
 * (dots) or stroked HATCH_LINE_WIDTH wide (lines), in paper mm. Dots sit on the tile's
 * corners and grid lines along its edges, each tile drawing its part; 45°
 * lines cross a spacing·√2 square corner to corner, running past it to be
 * clipped at its edges.
 */
export function hatchTile(pattern: HatchPattern): { size: number; d: string; filled: boolean } {
  const s = HATCH_SPACING;
  if (pattern === "dots") {
    const r = HATCH_DOT_SIZE / 2;
    const d = ([[0, 0], [s, 0], [0, s], [s, s]] as const)
      .map(([x, y]) => `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0z`).join("");
    return { size: s, d, filled: true };
  }
  if (pattern === "grid") return { size: s, d: `M0 0H${num(s)}M0 ${num(s)}H${num(s)}M0 0V${num(s)}M${num(s)} 0V${num(s)}`, filled: false };
  // Down to the right through (k·t, 0); then, for crosshatch, up to the right.
  const t = s * Math.SQRT2, ks = [-1, 0, 1];
  let d = ks.map((k) => `M${num(k * t - t)} ${num(-t)}L${num(k * t + 2 * t)} ${num(2 * t)}`).join("");
  if (pattern === "crosshatch") d += ks.map((k) => `M${num(k * t + 2 * t)} ${num(-t)}L${num(k * t - t)} ${num(2 * t)}`).join("");
  return { size: t, d, filled: false };
}

/** Every multiple of `step` from `lo` to `hi`, inclusive (within rounding). */
function steps(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9), last = Math.floor(hi / step + 1e-9); k <= last; k++) out.push(k * step);
  return out;
}
