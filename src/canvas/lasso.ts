// Rectangular lasso selection with the select tool: a mouse or pen drag on
// the empty background selects the shapes wholly inside the rectangle.

import { isSelectable, type EntityId, type LayerView, type Point, type Resolved } from "../model";

/** Slack for float noise in derived bounds (e.g. an angled line's end), in mm. */
const EPS = 1e-9;

/**
 * The shapes whose bounds lie wholly inside the rectangle with corners `a`
 * and `b` (either way round; touching an edge counts as inside), in draw
 * order, leaving out any on a layer this viewer has hidden or locked.
 */
export function lassoSelect(r: Resolved, a: Point, b: Point, view: LayerView): EntityId[] {
  const minX = Math.min(a[0], b[0]) - EPS, maxX = Math.max(a[0], b[0]) + EPS;
  const minY = Math.min(a[1], b[1]) - EPS, maxY = Math.max(a[1], b[1]) + EPS;
  return r.order.filter((id) => {
    if (!isSelectable(r, id, view)) return false;
    const s = r.shapes[id]!.bounds;
    return s.minX >= minX && s.maxX <= maxX && s.minY >= minY && s.maxY <= maxY;
  });
}

/**
 * What a drag on the empty background does with the select tool: a mouse or
 * pen draws a lasso; a finger pans, since touch has no Space or middle button.
 */
export function lassoMode(pointerType: string): "lasso" | "pan" {
  return pointerType === "touch" ? "pan" : "lasso";
}
