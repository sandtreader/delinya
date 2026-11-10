// Floating drawing-tool palette over the canvas, top left by default and
// dragged by its grip (see floating.tsx).

import { type ReactNode } from "react";
import { useEditor, type Tool } from "../app/editor";
import type { Point } from "../app/floatPosition";
import { Grip, useFloating } from "./floating";
import { tip } from "./tip";

const STORAGE_KEY = "delinya.toolPalette";
const HOME: Point = { x: 10, y: 10 };

/** `hint`: a longer tooltip, for a tool that needs telling how it works. */
const TOOLS: Array<{ tool: Tool; label: string; key: string; hint?: string; icon: ReactNode }> = [
  { tool: "select", label: "Select", key: "V", icon: <path d="M4.5 2.5v12l3-3 2.2 4.6 2-.9-2.2-4.5h4.2z" fill="currentColor" strokeLinejoin="round" /> },
  {
    tool: "line", label: "Line", key: "L",
    icon: <><line x1="4" y1="14" x2="14" y2="4" /><circle cx="4" cy="14" r="1.6" fill="currentColor" /><circle cx="14" cy="4" r="1.6" fill="currentColor" /></>,
  },
  { tool: "rect", label: "Rectangle", key: "R", icon: <rect x="3.5" y="3.5" width="11" height="11" /> },
  { tool: "circle", label: "Circle", key: "C", icon: <circle cx="9" cy="9" r="6" /> },
  {
    tool: "polyline", label: "Path", key: "P",
    hint: "Path (P): click for straight, Shift-click for curves; click the start to close; Enter or Esc to finish",
    icon: (
      <>
        <path d="M3.5 14.5C4 8.5 7 6.5 9 9s5 .5 5.5-5.5" />
        <rect x="2" y="13" width="3" height="3" fill="currentColor" stroke="none" />
        <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
        <rect x="13" y="2" width="3" height="3" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

export function ToolPalette() {
  const { editor, dispatch } = useEditor();
  const { ref, style, grip } = useFloating(STORAGE_KEY, HOME);

  return (
    <div
      ref={ref}
      className="palette tool-palette"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      style={style}
      // The canvas underneath would deselect or start drawing.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Grip {...grip} />
      {TOOLS.map((t) => {
        const name = `${t.label} (${t.key})`;
        return (
          <button
            key={t.tool}
            className={editor.tool === t.tool ? "active" : ""}
            onClick={() => dispatch({ type: "tool", tool: t.tool })}
            {...tip(t.hint ?? name, name)}
            data-tip-side="right"
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
