// Pointer and drag snapping against the resolved geometry, then the grid
// (or, with grid snap off, just 0.01 mm).

import { isVisible, snapNumber, type EntityId, type Point, type Resolved, type SnapPoint } from "../model";

export interface SnapResult {
  point: Point;
  snap: SnapPoint | null;
}

const NO_LAYERS: ReadonlySet<EntityId> = new Set();

function nearestSnap(
  resolved: Resolved, p: Point, tolerance: number, exclude: ReadonlySet<EntityId>, hidden: ReadonlySet<EntityId>,
): { snap: SnapPoint; d: number } | null {
  let best: SnapPoint | null = null;
  let bestD = tolerance;
  for (const id of resolved.order) {
    // Locked layers still snap; hidden ones are out of the picture.
    if (exclude.has(id) || !isVisible(resolved, id, hidden)) continue;
    for (const s of resolved.shapes[id]!.snaps) {
      const d = Math.hypot(s.point[0] - p[0], s.point[1] - p[1]);
      if (d < bestD) { bestD = d; best = s; }
    }
  }
  return best ? { snap: best, d: bestD } : null;
}

/** Places kept when not snapping to the grid: 0.01 mm, enough to drop float noise. */
const FREE_PLACES = 2;

/** Round to the grid pitch (float noise dropped), or with no grid just to 0.01 mm. */
function round(v: number, grid: number | null): number {
  if (grid === null) return snapNumber(v, FREE_PLACES);
  const g = grid > 0 ? grid : 1;
  return snapNumber(Math.round(v / g) * g);
}

function toGrid(p: Point, grid: number | null): Point {
  return [round(p[0], grid), round(p[1], grid)];
}

/**
 * Snap a free pointer position: nearest snap point within `tolerance` mm,
 * ignoring `exclude` shapes and those on `hidden` layers, else rounded to
 * `grid` mm. With `grid` null (grid snap off) it is only rounded to 0.01 mm;
 * shapes' snap points still apply.
 */
export function snapPoint(
  resolved: Resolved, p: Point, tolerance: number, exclude: ReadonlySet<EntityId>, grid: number | null,
  hidden: ReadonlySet<EntityId> = NO_LAYERS,
): SnapResult {
  const hit = nearestSnap(resolved, p, tolerance, exclude, hidden);
  if (hit) return { point: hit.snap.point, snap: hit.snap };
  return { point: toGrid(p, grid), snap: null };
}

/**
 * Adjust a drag delta so that one of the moving shape's own snap points
 * lands on another shape's snap point, else on the grid. Returns the
 * adjusted delta and the snap it landed on. Shapes on `hidden` layers are
 * not snapped to. With `grid` null the delta is the pointer's own, rounded
 * to 0.01 mm.
 */
export function snapMove(
  resolved: Resolved, primary: EntityId, delta: Point, tolerance: number, moving: ReadonlySet<EntityId>, grid: number | null,
  hidden: ReadonlySet<EntityId> = NO_LAYERS,
): { delta: Point; snap: SnapPoint | null } {
  const shape = resolved.shapes[primary];
  if (!shape) return { delta, snap: null };
  let best: { snap: SnapPoint; delta: Point; d: number } | null = null;
  for (const own of shape.snaps) {
    const moved: Point = [own.point[0] + delta[0], own.point[1] + delta[1]];
    const hit = nearestSnap(resolved, moved, tolerance, moving, hidden);
    if (hit && (!best || hit.d < best.d)) {
      best = { snap: hit.snap, d: hit.d, delta: [hit.snap.point[0] - own.point[0], hit.snap.point[1] - own.point[1]] };
    }
  }
  if (best) return { delta: best.delta, snap: best.snap };
  if (grid === null) return { delta: toGrid(delta, null), snap: null };
  // Grid: keep the shape's first snap point (a corner, endpoint or centre) on the grid.
  const ref = shape.snaps[0]?.point ?? [0, 0];
  const g = toGrid([ref[0] + delta[0], ref[1] + delta[1]], grid);
  return { delta: [g[0] - ref[0], g[1] - ref[1]], snap: null };
}
