// A line style on screen: the pen width as it would measure on paper at
// 96 px to the inch, at any zoom (as CAD shows line weights), never under
// a pixel, and dashes in the same px, so a pattern looks the same however
// far in or out the view is. Callers multiply by `hair` (1 / scale) to
// draw in world units.

import { DASH_UNIT_MIN, roundCapArray, type LineDash } from "../model";

/** CSS px per paper mm. */
export const SCREEN_PX_PER_MM = 96 / 25.4;

/** A line `width` mm wide on paper, in screen px. */
export function screenLineWidth(width: number): number {
  return Math.max(1, width * SCREEN_PX_PER_MM);
}

/** The dash array, in screen px, for a line `width` mm wide drawn with round caps. */
export function screenDashArray(dash: LineDash, width: number): number[] {
  return roundCapArray(dash, Math.max(width, DASH_UNIT_MIN) * SCREEN_PX_PER_MM, screenLineWidth(width));
}
