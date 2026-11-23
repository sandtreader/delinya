// Fit view to drawing: what it covers. The view itself is fitView in
// viewport.ts; the canvas, which knows its size, answers each request
// (EditorState.fitRequest).

import { type Bounds, type EntityId, type Resolved, boundsOfPoints, isVisible, unionBounds } from "../model";

/** Clear space left round a fitted drawing, px. */
export const FIT_PAD_PX = 40;

/**
 * Everything the viewer can see drawn, in mm: the shapes on shown layers,
 * their dimensions' lines and their radius labels' points; null for nothing.
 */
export function drawingExtent(r: Resolved, hidden: ReadonlySet<EntityId>): Bounds | null {
  const shown = (id: EntityId) => isVisible(r, id, hidden);
  const parts: Bounds[] = [];
  for (const id of r.order) if (shown(id)) parts.push(r.shapes[id]!.bounds);
  for (const d of r.dimensions) if (shown(d.target)) parts.push(boundsOfPoints([d.line.from, d.line.to]));
  for (const l of r.radiusLabels) if (shown(l.target)) parts.push(boundsOfPoints([l.at]));
  // Bad geometry doesn't get to throw the fit off.
  const sound = parts.filter((b) => [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite));
  return sound.length ? unionBounds(sound) : null;
}
