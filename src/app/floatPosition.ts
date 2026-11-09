// Position of a floating panel over the canvas: kept inside its area and
// remembered per browser. View state only, never part of the document.

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export type PositionStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Keep a panel of `size` inside `area`, `margin` from every edge. When it
 * can't fit, pin it to the top-left margin so its grip stays reachable.
 */
export function clampPosition(pos: Point, size: Size, area: Size, margin = 8): Point {
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, max - margin));
  return { x: clamp(pos.x, area.w - size.w), y: clamp(pos.y, area.h - size.h) };
}

/** The stored position, or `fallback` if there is none, it's junk or storage is blocked. */
export function loadPosition(storage: PositionStorage | null, key: string, fallback: Point): Point {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return fallback;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return fallback;
    const { x, y } = v as Record<string, unknown>;
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : fallback;
  } catch {
    return fallback;
  }
}

/** Best effort: private modes and full quotas throw, and losing a panel position doesn't matter. */
export function savePosition(storage: PositionStorage | null, key: string, pos: Point): void {
  try {
    storage?.setItem(key, JSON.stringify({ x: pos.x, y: pos.y }));
  } catch {
    // ignore
  }
}

/** localStorage if this environment has it and allows touching it. */
export function browserStorage(): PositionStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
