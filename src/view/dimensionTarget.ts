// What the Dimension tool highlights under the pointer: the part of the
// shape it would measure. Pure, so the canvas only has to draw it.

import { type DimensionTarget, type Path, type Point, type Resolved, rotatePoint, segment } from "../model";

/**
 * The part of the shape `t` names to highlight, for a pointer at `p` (model
 * mm): a rounded corner's arc; the straight part of a rect's edge nearer the
 * pointer, top or bottom for its width, left or right for its height (in its
 * own frame, if turned); a circle's outline; a line. Empty if the shape has gone.
 */
export function targetPath(r: Resolved, t: DimensionTarget, p: Point): Path {
  const s = Object.hasOwn(r.shapes, t.target) ? r.shapes[t.target]! : undefined;
  if (!s) return [];
  if (t.kind === "radius") {
    const a = s.kind === "rect" ? s.arcs[t.corner] : null;
    return a ? [a] : [];
  }
  if (s.kind !== "rect") return s.kind === "circle" || s.kind === "line" ? s.path : [];
  const { x, y, width: w, height: h, rotation } = s, [tl, tr, br, bl] = s.r;
  const [lx, ly] = rotatePoint(p, -rotation, [x, y]);
  const [a, b]: [Point, Point] = t.prop === "width"
    ? ly <= y + h / 2 ? [[x + tl, y], [x + w - tr, y]] : [[x + bl, y + h], [x + w - br, y + h]]
    : lx <= x + w / 2 ? [[x, y + tl], [x, y + h - bl]] : [[x + w, y + tr], [x + w, y + h - br]];
  const turn = (q: Point) => rotatePoint(q, rotation, [x, y]);
  return [segment(turn(a), turn(b))];
}
