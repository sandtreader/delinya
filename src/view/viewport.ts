// Screen <-> model mapping. The model is in mm; the view holds pixels per
// mm and a pixel offset for the model origin. Scale is view state only and
// is never part of the document.

import type { Point } from "../model";

export interface View {
  /** Pixels per millimetre. */
  scale: number;
  /** Screen position of the model origin, px. */
  ox: number;
  oy: number;
}

export const DEFAULT_VIEW: View = { scale: 2, ox: 60, oy: 60 };
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 100;

export function toScreen(v: View, p: Point): Point {
  return [v.ox + p[0] * v.scale, v.oy + p[1] * v.scale];
}

export function toModel(v: View, p: Point): Point {
  return [(p[0] - v.ox) / v.scale, (p[1] - v.oy) / v.scale];
}

export function pan(v: View, dx: number, dy: number): View {
  return { ...v, ox: v.ox + dx, oy: v.oy + dy };
}

/** Zoom by a factor keeping the model point under `at` (screen px) fixed. */
export function zoomAt(v: View, factor: number, at: Point): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, ox: at[0] - (at[0] - v.ox) * k, oy: at[1] - (at[1] - v.oy) * k };
}

/** A grid pitch in mm that stays between ~8 and ~80 px at this scale. */
export function gridPitch(v: View): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) if (s * v.scale >= 8) return s;
  return 1000;
}
