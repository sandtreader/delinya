// Floating palettes over the canvas, dragged by a grip. Where each sits is
// per-browser view state (localStorage), never in the document or the
// editor reducer.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { browserStorage, clampPosition, loadPosition, savePosition, type Point, type Size } from "../app/floatPosition";
import { tip } from "./tip";

// "Reset view" sends every palette home; each mounted palette listens.
const homeListeners = new Set<() => void>();
const homes = new Map<string, Point>();

/** Put every palette back at its home position and remember that. */
export function sendPalettesHome(): void {
  for (const [key, home] of homes) savePosition(browserStorage(), key, home);
  for (const fn of homeListeners) fn();
}

/**
 * Position, clamping and grip dragging for a palette stored under `key`.
 * Put `ref` and `style` on the palette (absolutely positioned in its
 * area) and `grip` on its handle.
 */
export function useFloating(key: string, home: Point) {
  homes.set(key, home);
  const ref = useRef<HTMLDivElement>(null);
  // Where the user put it; shown clamped, so shrinking the window and
  // growing it again brings the palette back.
  const [pos, setPos] = useState(() => loadPosition(browserStorage(), key, home));
  const [bounds, setBounds] = useState<{ size: Size; area: Size } | null>(null);
  const drag = useRef<{ dx: number; dy: number; at: Point | null } | null>(null);
  const shown = bounds ? clampPosition(pos, bounds.size, bounds.area) : pos;

  useEffect(() => {
    const goHome = () => setPos(home);
    homeListeners.add(goHome);
    return () => { homeListeners.delete(goHome); };
  }, [home]);

  useLayoutEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!el || !area) return;
    const measure = () => setBounds({
      size: { w: el.offsetWidth, h: el.offsetHeight },
      area: { w: area.clientWidth, h: area.clientHeight },
    });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(area);
    measure();
    return () => ro.disconnect();
  }, []);

  const end = () => {
    const at = drag.current?.at;
    drag.current = null;
    if (at) savePosition(browserStorage(), key, at);
  };
  const grip = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - shown.x, dy: e.clientY - shown.y, at: null };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || !bounds) return;
      d.at = clampPosition({ x: e.clientX - d.dx, y: e.clientY - d.dy }, bounds.size, bounds.area);
      setPos(d.at);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  return { ref, style: { left: shown.x, top: shown.y }, grip, shown, bounds };
}

/** The palette's drag handle: a row of dots. */
export function Grip(props: ReturnType<typeof useFloating>["grip"]) {
  return (
    <div className="grip" {...tip("Drag to move")} data-tip-side="right" {...props}>
      <svg width="14" height="6" viewBox="0 0 14 6" aria-hidden="true">
        {[2, 7, 12].flatMap((x) => [1.5, 4.5].map((y) => <circle key={`${x},${y}`} cx={x} cy={y} r="1" />))}
      </svg>
    </div>
  );
}
