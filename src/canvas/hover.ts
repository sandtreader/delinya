// Where the pointer is over the drawing area, screen px from its top left,
// or null when it is elsewhere: for the rulers' markers. Kept out of the
// editor reducer so that hovering re-renders only the rulers, not the canvas.

import { useSyncExternalStore } from "react";
import type { Point } from "../model";

let at: Point | null = null;
const listeners = new Set<() => void>();

export function setHover(p: Point | null): void {
  if (p === at || (p && at && p[0] === at[0] && p[1] === at[1])) return;
  at = p;
  for (const fn of listeners) fn();
}

export function useHover(): Point | null {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => at,
    () => null,
  );
}
