// Rulers along the top and left of the drawing area, and the corner where
// they meet. They follow pan and zoom and the drawing's grid spacing (see
// view/rulers.ts), with a marker at the pointer. They sit outside the
// drawing area, so pressing on them never draws or lassoes; the wheel
// zooms about the pointer as it does over the canvas.

import { useEffect, useRef, useState } from "react";
import type { Axis, Point } from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { RULER_PX, rulerTicks, type RulerTick } from "../view/rulers";
import { toScreen, wheelZoom, type View } from "../view/viewport";
import { useHover } from "./hover";

/** Inside the border on the ruler's inner edge, px. */
const DEPTH = RULER_PX - 1;
/** Tick lengths in from the inner edge, px. */
const TICK: Record<RulerTick["size"], number> = { minor: 4, mid: 8, major: DEPTH };
/** Labels sit just past their tick, this far in from the outer edge (baseline). */
const LABEL_GAP = 3, LABEL_BASE = 9;

export function Rulers() {
  useDocument();
  const { editor } = useEditor();
  const hover = useHover();
  // The position the status bar shows (snapped while drawing), else the bare pointer.
  const marker = editor.cursor ? toScreen(editor.view, editor.cursor) : hover;
  const spacing = store.resolved.document.gridSpacing;
  return (
    <>
      <div className="ruler-corner" aria-hidden="true">mm</div>
      <Ruler axis="x" view={editor.view} spacing={spacing} marker={marker?.[0] ?? null} />
      <Ruler axis="y" view={editor.view} spacing={spacing} marker={marker?.[1] ?? null} />
    </>
  );
}

function Ruler({ axis, view, spacing, marker }: { axis: Axis; view: View; spacing: number; marker: number | null }) {
  const { dispatch } = useEditor();
  const ref = useRef<SVGSVGElement>(null);
  const [length, setLength] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLength(axis === "x" ? el.clientWidth : el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    // A native listener: React's onWheel is passive, and a pinch must not zoom the page.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // In the drawing area's px: its edge is the ruler's inner edge.
      const r = el.getBoundingClientRect();
      const at: Point = axis === "x" ? [e.clientX - r.left, e.clientY - r.bottom] : [e.clientX - r.right, e.clientY - r.top];
      dispatch({ type: "zoomAt", factor: wheelZoom(e.deltaY, e.ctrlKey), at });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); };
  }, [axis, dispatch]);

  // Across the ruler from the inner edge `depth` px, at `along` px down its length.
  const across = (along: number, depth: number) => axis === "x"
    ? { x1: along, x2: along, y1: DEPTH, y2: DEPTH - depth }
    : { y1: along, y2: along, x1: DEPTH, x2: DEPTH - depth };

  return (
    <svg ref={ref} className={`ruler ruler-${axis}`} aria-hidden="true">
      {/* Keyed by place, so panning updates the same elements. */}
      {rulerTicks(view, axis, length, spacing).map((t, i) => (
        <g key={i}>
          <line {...across(t.at, TICK[t.size])} />
          {/* Past the tick along the axis: left to right on top, bottom to top on the left. */}
          {t.label !== undefined && (axis === "x"
            ? <text x={t.at + LABEL_GAP} y={LABEL_BASE}>{t.label}</text>
            : <text transform={`translate(${LABEL_BASE} ${t.at + LABEL_GAP}) rotate(-90)`} textAnchor="end">{t.label}</text>)}
        </g>
      ))}
      {marker !== null && <line className="marker" {...across(marker, DEPTH)} />}
    </svg>
  );
}
