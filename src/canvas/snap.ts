// Pointer and drag snapping against the resolved geometry, then the grid.

import type { EntityId, Point, Resolved, SnapPoint } from "../model";

export interface SnapResult {
  point: Point;
  snap: SnapPoint | null;
}

function nearestSnap(resolved: Resolved, p: Point, tolerance: number, exclude: ReadonlySet<EntityId>): { snap: SnapPoint; d: number } | null {
  let best: SnapPoint | null = null;
  let bestD = tolerance;
  for (const id of resolved.order) {
    if (exclude.has(id)) continue;
    for (const s of resolved.shapes[id]!.snaps) {
      const d = Math.hypot(s.point[0] - p[0], s.point[1] - p[1]);
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  return best ? { snap: best, d: bestD } : null;
}

function toGrid(p: Point, grid: number): Point {
  const g = grid > 0 ? grid : 1;
  return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
}

/**
 * Snap a free pointer position: nearest snap point within `tolerance` mm,
 * ignoring `exclude` shapes, else rounded to `grid` mm.
 */
export function snapPoint(resolved: Resolved, p: Point, tolerance: number, exclude: ReadonlySet<EntityId>, grid: number): SnapResult {
  const hit = nearestSnap(resolved, p, tolerance, exclude);
  if (hit) return { point: hit.snap.point, snap: hit.snap };
  return { point: toGrid(p, grid), snap: null };
}

/**
 * Adjust a drag delta so that one of the moving shape's own snap points
 * lands on another shape's snap point, else on the grid. Returns the
 * adjusted delta and the snap it landed on.
 */
export function snapMove(resolved: Resolved, primary: EntityId, delta: Point, tolerance: number, moving: ReadonlySet<EntityId>, grid: number): { delta: Point; snap: SnapPoint | null } {
  const shape = resolved.shapes[primary];
  if (!shape) return { delta, snap: null };
  let best: { snap: SnapPoint; delta: Point; d: number } | null = null;
  for (const own of shape.snaps) {
    const moved: Point = [own.point[0] + delta[0], own.point[1] + delta[1]];
    const hit = nearestSnap(resolved, moved, tolerance, moving);
    if (hit && (!best || hit.d < best.d)) {
      best = { snap: hit.snap, d: hit.d, delta: [hit.snap.point[0] - own.point[0], hit.snap.point[1] - own.point[1]] };
    }
  }
  if (best) return { delta: best.delta, snap: best.snap };
  // Grid: keep the shape's first snap point (a corner, endpoint or centre) on the grid.
  const ref = shape.snaps[0]?.point ?? [0, 0];
  const g = toGrid([ref[0] + delta[0], ref[1] + delta[1]], grid);
  return { delta: [g[0] - ref[0], g[1] - ref[1]], snap: null };
}
