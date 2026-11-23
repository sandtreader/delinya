// Text boxes in the view: the box the Text tool's drag makes, and a line as
// SVG <text> attributes, so every SVG of it (the canvas, the export and the
// print pages) draws it the same way.

import { snapNumber, type EntityId, type FontFamily, type FontStyle, type Point, type TextProps } from "../model";

/**
 * The text box a drag from `start` to `current` draws on `layer`: empty,
 * sans, its corner the top left of the two points, sized as the Rectangle
 * tool sizes. Undefined if it has no width or no height.
 */
export function newTextProps(start: Point, current: Point, layer: EntityId): TextProps | undefined {
  const [x0, y0] = start, [x1, y1] = current;
  const width = snapNumber(Math.abs(x1 - x0)), height = snapNumber(Math.abs(y1 - y0));
  if (width === 0 || height === 0) return undefined;
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width, height, text: "", font: "sans", layer };
}

/**
 * Portable font stacks: the PDF standard font first, then the fonts most
 * systems have that share its widths (Arial and the Liberation and Nimbus
 * clones), then the generic family.
 */
const STACKS: Record<FontFamily, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace",
};

export function fontStack(family: FontFamily): string {
  return STACKS[family];
}

/** One line of a text box as SVG needs it; a TextPrim fits. */
export interface TextLineSpec {
  /** Where the baseline starts. */
  at: Point;
  /** Degrees, clockwise on a y-down page. */
  angle: number;
  size: number;
  font: FontStyle;
  mirror?: boolean;
  /** The line's advance by the font's metrics. */
  width?: number;
}

/**
 * Attributes for one line's <text>: the family, size, weight and style;
 * `textLength` with `lengthAdjust="spacing"`, so a substitute font still
 * fills exactly the width the metrics give and wraps where every client
 * does; and a transform that moves to the baseline's start, turns, and
 * mirrors along the baseline (x and y stay 0). Start-anchored.
 */
export function textElementAttrs(t: TextLineSpec): Record<string, string> {
  const a: Record<string, string> = { "font-family": fontStack(t.font.family), "font-size": svgNumber(t.size) };
  if (t.font.bold) a["font-weight"] = "bold";
  if (t.font.italic) a["font-style"] = "italic";
  if (t.width !== undefined && t.width > 0) {
    a.textLength = svgNumber(t.width);
    a.lengthAdjust = "spacing";
  }
  let transform = `translate(${svgNumber(t.at[0])} ${svgNumber(t.at[1])})`;
  if (svgNumber(t.angle) !== "0") transform += ` rotate(${svgNumber(t.angle)})`;
  if (t.mirror) transform += " scale(-1 1)";
  a.transform = transform;
  return a;
}

/** A number for an SVG attribute: at most 4 decimals, no trailing zeros, never "-0". */
export function svgNumber(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return (r === 0 ? 0 : r).toString();
}
