// The canvas's rotate handle: where it sits above the selection, and how far
// a drag of it turns the selection about the pivot. Pure, so the canvas
// only has to commit.

import { type Bounds, type EntityId, type Point, type Resolved, unionBounds } from "../model";

/** How far (screen px) the rotate handle sits above the selection. */
export const ROTATE_HANDLE_PX = 24;

/** The screen clearance (px) kept around a dimension line for its text. */
export const LABEL_CLEAR_PX = 16;

/** The rotate handle, in model mm: a fixed screen distance above the top centre of `bounds`. */
export function rotateHandleAt(bounds: Bounds, scale: number): Point {
  return [(bounds.minX + bounds.maxX) / 2, bounds.minY - ROTATE_HANDLE_PX / scale];
}

/**
 * Where the rotate handle is drawn for the shapes among `ids`, in model mm:
 * `at` is the circle, `stem` the foot of its stem. Above the top centre of
 * their bounds, raised over any of their dimensions crossing its column
 * (within `LABEL_CLEAR_PX` either side) with `LABEL_CLEAR_PX` to spare for
 * the text, so it never hides one.
 */
export function rotateHandleSpot(resolved: Resolved, ids: readonly EntityId[], scale: number): { at: Point; stem: Point } {
  const bs = ids.flatMap((id) => (Object.hasOwn(resolved.shapes, id) ? [resolved.shapes[id]!.bounds] : []));
  const b = bs.length > 0 ? unionBounds(bs) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const cx = (b.minX + b.maxX) / 2;
  const band = LABEL_CLEAR_PX / scale;
  const mine = new Set(ids);
  let top = b.minY;
  for (const d of resolved.dimensions) {
    if (!mine.has(d.target)) continue;
    const y = highestInStrip(d.line.from, d.line.to, cx - band, cx + band);
    if (y !== undefined) top = Math.min(top, y - band);
  }
  return { at: [cx, top - ROTATE_HANDLE_PX / scale], stem: [cx, top] };
}

/** The least y of the segment a–b within the strip lo ≤ x ≤ hi, or undefined if none of it is in the strip. */
function highestInStrip(a: Point, b: Point, lo: number, hi: number): number | undefined {
  const dx = b[0] - a[0];
  if (dx === 0) return a[0] >= lo && a[0] <= hi ? Math.min(a[1], b[1]) : undefined;
  // The parameters (0..1 along a–b) where it meets each edge of the strip.
  const t1 = (lo - a[0]) / dx, t2 = (hi - a[0]) / dx;
  const t0 = Math.max(0, Math.min(t1, t2)), tEnd = Math.min(1, Math.max(t1, t2));
  if (t0 > tEnd) return undefined;
  const yAt = (t: number) => a[1] + t * (b[1] - a[1]);
  return Math.min(yAt(t0), yAt(tEnd));
}

/**
 * The turn (degrees, clockwise on screen) a drag from `from` to `to` sweeps
 * about `pivot`, the short way round, in (-180, 180]: whole degrees, or
 * 15° steps with `snap15`. 0 with either point on the pivot.
 */
export function dragTurn(pivot: Point, from: Point, to: Point, snap15: boolean): number {
  const fx = from[0] - pivot[0], fy = from[1] - pivot[1];
  const tx = to[0] - pivot[0], ty = to[1] - pivot[1];
  if ((fx === 0 && fy === 0) || (tx === 0 && ty === 0)) return 0;
  const swept = ((Math.atan2(ty, tx) - Math.atan2(fy, fx)) * 180) / Math.PI;
  const step = snap15 ? 15 : 1;
  // Rounded first, so a turn just short of -180 doesn't round onto it.
  let turn = Math.round(swept / step) * step;
  turn %= 360;
  if (turn > 180) turn -= 360;
  else if (turn <= -180) turn += 360;
  return turn + 0;
}
