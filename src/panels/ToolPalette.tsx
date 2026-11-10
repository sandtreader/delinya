// Floating drawing-tool palette over the canvas, top left by default and
// dragged by its grip (see floating.tsx).

import { type ReactNode } from "react";
import { useEditor, type Tool } from "../app/editor";
import type { Point } from "../app/floatPosition";
import { Grip, useFloating } from "./floating";

const STORAGE_KEY = "delinya.toolPalette";
const HOME: Point = { x: 10, y: 10 };

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
            data-tip={name}
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
