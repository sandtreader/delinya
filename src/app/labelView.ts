// Dimensions and radius labels, as this viewer wants them: whether drawing
// a shape adds its dimensions, and whether they show on screen at all. Each
// viewer's own choice, held in editor state and remembered per browser,
// never part of the document (so not synced, saved or undoable). Print and
// export have their own dimensions option.

import type { PositionStorage } from "./floatPosition";

export interface LabelView {
  /** Drawing a rect, circle or line adds its standard dimensions. */
  autoDimension: boolean;
  /** Dimensions and radius labels are drawn (and can be picked) on screen. */
  show: boolean;
}

export const DEFAULT_LABEL_VIEW: LabelView = { autoDimension: true, show: true };

const KEY = "delinya.labels";

/** The stored choice, each setting falling back to the default when missing or junk, or all of it when storage is blocked. */
export function loadLabelView(storage: PositionStorage | null): LabelView {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_LABEL_VIEW;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return DEFAULT_LABEL_VIEW;
    const { autoDimension, show } = v as Record<string, unknown>;
    return {
      autoDimension: typeof autoDimension === "boolean" ? autoDimension : DEFAULT_LABEL_VIEW.autoDimension,
      show: typeof show === "boolean" ? show : DEFAULT_LABEL_VIEW.show,
    };
  } catch {
    return DEFAULT_LABEL_VIEW;
  }
}

/** Best effort: private modes and full quotas throw, and losing the choice doesn't matter. */
export function saveLabelView(storage: PositionStorage | null, v: LabelView): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ autoDimension: v.autoDimension, show: v.show }));
  } catch {
    // ignore
  }
}
