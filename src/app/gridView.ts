// Showing the grid and snapping to it: each viewer's own choice, held in
// editor state and remembered per browser, never part of the document (so
// not synced, saved or undoable, and kept for a new or opened drawing). The
// grid spacing is the drawing's and lives in the document.

import type { PositionStorage } from "./floatPosition";

export interface GridView {
  /** Draw the grid lines (the origin axes are drawn either way). */
  visible: boolean;
  /** Free points and moves round to the grid; off, only to 0.01 mm. Shapes' snap points apply either way. */
  snap: boolean;
}

export const DEFAULT_GRID_VIEW: GridView = { visible: true, snap: true };

const KEY = "delinya.grid";

/** The stored choice, each setting falling back to the default when missing or junk, or all of it when storage is blocked. */
export function loadGridView(storage: PositionStorage | null): GridView {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_GRID_VIEW;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return DEFAULT_GRID_VIEW;
    const { visible, snap } = v as Record<string, unknown>;
    return {
      visible: typeof visible === "boolean" ? visible : DEFAULT_GRID_VIEW.visible,
      snap: typeof snap === "boolean" ? snap : DEFAULT_GRID_VIEW.snap,
    };
  } catch {
    return DEFAULT_GRID_VIEW;
  }
}

/** Best effort: private modes and full quotas throw, and losing the choice doesn't matter. */
export function saveGridView(storage: PositionStorage | null, v: GridView): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ visible: v.visible, snap: v.snap }));
  } catch {
    // ignore
  }
}
