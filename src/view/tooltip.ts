// The shared tooltip's timing and placement. Pure: the DOM side is
// panels/Tooltip.tsx.

/** Rest on an element this long before its tooltip shows, like the browser's. */
export const TIP_DELAY = 1000;
/** After one hides, another shows at once for this long (moving along a row of buttons). */
export const TIP_WARM = 500;

/** Space between the anchor and the tooltip. */
const GAP = 6;
/** The tooltip stays this far inside the window. */
const MARGIN = 4;

export type TipSide = "below" | "above" | "right" | "left";
export interface TipBox { x: number; y: number; w: number; h: number }
export interface TipSize { w: number; h: number }

const OPPOSITE: Record<TipSide, TipSide> = { below: "above", above: "below", right: "left", left: "right" };

/**
 * Where a tooltip of size `tip` goes for an anchor (window coordinates):
 * on `side`, centred along it, flipped to the opposite side when it would
 * leave the window and fits there, and kept inside the window along the
 * anchor.
 */
export function placeTip(anchor: TipBox, tip: TipSize, viewport: TipSize, side: TipSide): { x: number; y: number; side: TipSide } {
  const vertical = side === "below" || side === "above";
  const length = vertical ? tip.h : tip.w, room = vertical ? viewport.h : viewport.w;
  const start = (s: TipSide) =>
    s === "below" ? anchor.y + anchor.h + GAP
    : s === "above" ? anchor.y - GAP - tip.h
    : s === "right" ? anchor.x + anchor.w + GAP
    : anchor.x - GAP - tip.w;
  const fits = (s: TipSide) => start(s) >= MARGIN && start(s) + length <= room - MARGIN;
  const chosen = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];
  const clamp = (v: number, size: number, max: number) => Math.max(MARGIN, Math.min(v, max - MARGIN - size));
  const main = clamp(start(chosen), length, room);
  return vertical
    ? { x: clamp(anchor.x + anchor.w / 2 - tip.w / 2, tip.w, viewport.w), y: main, side: chosen }
    : { x: main, y: clamp(anchor.y + anchor.h / 2 - tip.h / 2, tip.h, viewport.h), side: chosen };
}

/**
 * When to show a tooltip. `enter` an element: its tooltip shows after
 * TIP_DELAY, or at once while one is showing or just hid (TIP_WARM).
 * `leave` hides it; `press` (a click, key, scroll) hides it too, and the
 * next waits the full delay. Calls `show` with the element, or null to hide.
 */
export class TipTimer<T> {
  private showing = false;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private warm: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly show: (el: T | null) => void) {}

  enter(el: T): void {
    this.cancel();
    if (this.showing || this.warm !== undefined) {
      this.cool();
      this.set(el);
      return;
    }
    this.pending = setTimeout(() => { this.pending = undefined; this.set(el); }, TIP_DELAY);
  }

  leave(): void {
    this.cancel();
    if (!this.showing) return;
    this.set(null);
    this.warm = setTimeout(() => { this.warm = undefined; }, TIP_WARM);
  }

  press(): void {
    this.cancel();
    this.cool();
    if (this.showing) this.set(null);
  }

  private set(el: T | null): void {
    this.showing = el !== null;
    this.show(el);
  }

  private cancel(): void {
    clearTimeout(this.pending);
    this.pending = undefined;
  }

  private cool(): void {
    clearTimeout(this.warm);
    this.warm = undefined;
  }
}
