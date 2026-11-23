// The canvas's rotate handle: where it sits above the selection, and how far
// a drag of it turns the selection about the pivot. Pure, so the canvas
// only has to commit.

import type { Bounds, Point } from "../model";

/** How far (screen px) the rotate handle sits above the selection. */
export const ROTATE_HANDLE_PX = 24;

/** The rotate handle, in model mm: a fixed screen distance above the top centre of `bounds`. */
export function rotateHandleAt(bounds: Bounds, scale: number): Point {
  return [(bounds.minX + bounds.maxX) / 2, bounds.minY - ROTATE_HANDLE_PX / scale];
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
