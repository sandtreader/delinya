// Screen <-> model mapping. The model is in mm; the view holds pixels per
// mm and a pixel offset for the model origin. Scale is view state only and
// is never part of the document.

import type { Bounds, Point } from "../model";
import { FIT_PAD_PX } from "./fit";

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

/**
 * The view showing `b` (mm) as large as a canvas of `size` px allows, with
 * FIT_PAD_PX clear all round, centred, within the zoom limits. A side with
 * no extent doesn't limit the scale; with neither, it is the default
 * scale. A canvas under four paddings across keeps half of it for the
 * drawing. Nothing to show, or no canvas, gives the default view.
 */
export function fitView(b: Bounds | null, size: readonly [number, number]): View {
  const [w, h] = size;
  if (!b || !(w > 0) || !(h > 0)) return DEFAULT_VIEW;
  const room = (px: number, mm: number) => (mm > 0 ? (px - 2 * Math.min(FIT_PAD_PX, px / 4)) / mm : Infinity);
  const fit = Math.min(room(w, b.maxX - b.minX), room(h, b.maxY - b.minY));
  const scale = Number.isFinite(fit) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit)) : DEFAULT_VIEW.scale;
  return { scale, ox: w / 2 - ((b.minX + b.maxX) / 2) * scale, oy: h / 2 - ((b.minY + b.maxY) / 2) * scale };
}

/**
 * The zoom factor for a wheel event, as in SynFlo. A trackpad pinch arrives
 * as a ctrl-wheel with small deltas, so it gets a higher gain than wheel notches.
 */
export function wheelZoom(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.002));
}

/** Closest the drawn grid lines get, px. */
export const MIN_GRID_PX = 8;

/**
 * The grid pitch to draw and snap to, mm: the drawing's grid `spacing`, or
 * the smallest multiple of it (×2, ×5, ×10, ×20, ×50…) whose lines are at
 * least MIN_GRID_PX apart at this scale.
 */
export function gridPitch(v: View, spacing = 1): number {
  const base = Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
  if (!(v.scale > 0) || !Number.isFinite(v.scale)) return base;
  for (let decade = 1; ; decade *= 10) {
    for (const m of [1, 2, 5]) {
      // toPrecision drops float noise, e.g. 0.1 × 30.
      const pitch = Number((base * m * decade).toPrecision(12));
      if (pitch * v.scale >= MIN_GRID_PX) return pitch;
    }
  }
}
