// Where a dimension's value reads, shared by the canvas and output so they
// agree: along its line, never upside down, on the side away from the shape.

import type { ResolvedDimension } from "../model";

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
