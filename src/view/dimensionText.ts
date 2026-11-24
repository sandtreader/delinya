// Where a dimension's value or a radius label reads, shared by the canvas
// and output so they agree: never upside down; a dimension's along its
// line on the side away from the shape, a radius label inside its corner.

import { rotatePoint, type Point, type ResolvedDimension, type ResolvedRadiusLabel } from "../model";
import { formatMm } from "./format";

/** Off vertical by less than this (degrees), a line counts as vertical. */
const VERTICAL = 1e-6;

/**
 * The text's angle, the line's direction turned to read left to right (in
 * [-90, 90), so vertical text reads bottom to top), and whether it sits
 * above the line as read (else below), whichever side faces away from the
 * measured points. Lines of any direction, so turned rects and lines alike.
 */
export function dimensionText(d: ResolvedDimension): { angle: number; above: boolean } {
  const [a, b] = [d.line.from, d.line.to];
  const along = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const angle = along >= 90 - VERTICAL ? along - 180 : along < -90 - VERTICAL ? along + 180 : along;
  // The text's "up", and the way the line stands off from the shape.
  const t = (angle * Math.PI) / 180;
  const up = [Math.sin(t), -Math.cos(t)];
  const out = [a[0] - d.anchors[0][0], a[1] - d.anchors[0][1]];
  return { angle, above: up[0]! * out[0]! + up[1]! * out[1]! >= 0 };
}

/** A radius label's text: "R5", or "4× R5" for one standing for four equal corners. */
export function radiusLabelText(l: Pick<ResolvedRadiusLabel, "radius" | "count">): string {
  return `${l.count > 1 ? `${l.count}× ` : ""}R${formatMm(l.radius)}`;
}

/** How far a radius label stands in from its corner's curve, in em of the text size. */
export const RADIUS_LABEL_GAP = 0.3;
/** The height of a radius label's capitals and digits, in em: a top corner's hangs this far below. */
export const RADIUS_LABEL_CAP = 0.7;

/**
 * Where a radius label is set, its text `size` high: inside its corner's
 * curve, in from the midpoint (`l.at`) towards the rect's middle, in the
 * rect's own frame so it turns with the rect. A left corner's text starts
 * there and a right corner's ends there (right-aligned against the
 * right-hand edge); a top corner's hangs below, a bottom corner's stands
 * above. Kept readable as dimension text is (an angle in [-90, 90)):
 * turned past upright, the text turns half round and the corner's role
 * with it, so top-left reads as bottom-right.
 */
export function radiusLabelPlace(l: Pick<ResolvedRadiusLabel, "at" | "corner" | "rotation">, size: number): {
  at: Point; angle: number; anchor: "start" | "end";
} {
  const r = l.rotation;
  const over = r >= 90 - VERTICAL && r < 270 - VERTICAL;
  const angle = over ? r - 180 : r >= 270 - VERTICAL ? r - 360 : r;
  const corner = over ? (l.corner + 2) % 4 : l.corner;
  const right = corner === 1 || corner === 2;
  const top = corner === 0 || corner === 1;
  const gap = RADIUS_LABEL_GAP * size;
  const d = rotatePoint([right ? -gap : gap, top ? gap + RADIUS_LABEL_CAP * size : -gap], angle);
  return { at: [l.at[0] + d[0], l.at[1] + d[1]], angle, anchor: right ? "end" : "start" };
}
