// The line style this viewer draws with: the toolbar's current width and
// pattern, held in editor state and remembered per browser, never part of
// the document (each shape stores its own).

import { DEFAULT_LINE_STYLE, isLineDash, isLineWidth, type LineStyle } from "../model";
import type { PositionStorage } from "./floatPosition";

const KEY = "delinya.lineStyle";

/** The stored style, each part falling back to the default when missing or junk, or all of it when storage is blocked. */
export function loadLineStyle(storage: PositionStorage | null): LineStyle {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_LINE_STYLE;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return DEFAULT_LINE_STYLE;
    const { width, dash } = v as Record<string, unknown>;
    return {
      width: isLineWidth(width) ? width : DEFAULT_LINE_STYLE.width,
      dash: isLineDash(dash) ? dash : DEFAULT_LINE_STYLE.dash,
    };
  } catch {
    return DEFAULT_LINE_STYLE;
  }
}

/** Best effort: private modes and full quotas throw, and losing the choice doesn't matter. */
export function saveLineStyle(storage: PositionStorage | null, v: LineStyle): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ width: v.width, dash: v.dash }));
  } catch {
    // ignore
  }
}
