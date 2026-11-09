// Floating drawing-tool palette over the canvas. Dragged by its grip; where
// it sits is per-browser view state (localStorage), never in the document or
// the editor reducer.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useEditor, type Tool } from "../app/editor";
import { browserStorage, clampPosition, loadPosition, savePosition, type Point, type Size } from "../app/floatPosition";

const STORAGE_KEY = "delinya.toolPalette";
const HOME: Point = { x: 10, y: 10 };

// "Reset view" sends the palette home; the mounted palette listens.
const homeListeners = new Set<() => void>();

/** Put the palette back top left and remember that. */
export function sendToolPaletteHome(): void {
  savePosition(browserStorage(), STORAGE_KEY, HOME);
  for (const fn of homeListeners) fn();
}

const TOOLS: Array<{ tool: Tool; label: string; key: string; icon: ReactNode }> = [
  { tool: "select", label: "Select", key: "V", icon: <path d="M4.5 2.5v12l3-3 2.2 4.6 2-.9-2.2-4.5h4.2z" fill="currentColor" strokeLinejoin="round" /> },
  {
    tool: "line", label: "Line", key: "L",
    icon: <><line x1="4" y1="14" x2="14" y2="4" /><circle cx="4" cy="14" r="1.6" fill="currentColor" /><circle cx="14" cy="4" r="1.6" fill="currentColor" /></>,
  },
  { tool: "rect", label: "Rectangle", key: "R", icon: <rect x="3.5" y="3.5" width="11" height="11" /> },
  { tool: "circle", label: "Circle", key: "C", icon: <circle cx="9" cy="9" r="6" /> },
];

export function ToolPalette() {
  const { editor, dispatch } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  // Where the user put it; shown clamped, so shrinking the window and
  // growing it again brings the palette back.
  const [pos, setPos] = useState(() => loadPosition(browserStorage(), STORAGE_KEY, HOME));
  const [bounds, setBounds] = useState<{ size: Size; area: Size } | null>(null);
  const drag = useRef<{ dx: number; dy: number; at: Point | null } | null>(null);
  const shown = bounds ? clampPosition(pos, bounds.size, bounds.area) : pos;

  useEffect(() => {
    const home = () => setPos(HOME);
    homeListeners.add(home);
    return () => { homeListeners.delete(home); };
  }, []);

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

  const onGripDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - shown.x, dy: e.clientY - shown.y, at: null };
  };
  const onGripMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !bounds) return;
    d.at = clampPosition({ x: e.clientX - d.dx, y: e.clientY - d.dy }, bounds.size, bounds.area);
    setPos(d.at);
  };
  const onGripEnd = () => {
    const at = drag.current?.at;
    drag.current = null;
    if (at) savePosition(browserStorage(), STORAGE_KEY, at);
  };

  return (
    <div
      ref={ref}
      className="tool-palette"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      style={{ left: shown.x, top: shown.y }}
      // The canvas underneath would deselect or start drawing.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="grip"
        title="Drag to move"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripEnd}
        onPointerCancel={onGripEnd}
      >
        <svg width="14" height="6" viewBox="0 0 14 6" aria-hidden="true">
          {[2, 7, 12].flatMap((x) => [1.5, 4.5].map((y) => <circle key={`${x},${y}`} cx={x} cy={y} r="1" />))}
        </svg>
      </div>
      {TOOLS.map((t) => {
        const name = `${t.label} (${t.key})`;
        return (
          <button
            key={t.tool}
            className={editor.tool === t.tool ? "active" : ""}
            onClick={() => dispatch({ type: "tool", tool: t.tool })}
            title={name}
            aria-label={name}
            aria-pressed={editor.tool === t.tool}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              {t.icon}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
