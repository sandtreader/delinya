// Number formatting shared by the canvas, panels and output, so a length
// reads the same on screen, in a printout and in an export.

import { type EntityId, type Resolved, type ResolvedShape, elementLength, unionBounds } from "../model";

/** A length in mm for display: at most two decimals, no trailing zeros. */
export function formatMm(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

export type DrawTool = "line" | "rect" | "circle" | "polyline";

/**
 * The status bar while a new shape is dragged out from `start` to
 * `current`: where it started and how big it is. Angles as the shape
 * panel shows them, degrees from +x towards +y. A path being drawn reads
 * as a line: its segment from the last node to the pointer.
 */
export function drawStatus(tool: DrawTool, start: readonly [number, number], current: readonly [number, number]): string {
  const [x0, y0] = start, dx = current[0] - x0, dy = current[1] - y0;
  const at = `${formatMm(x0)}, ${formatMm(y0)} mm`;
  switch (tool) {
    case "rect": return `from ${at} · ${formatMm(Math.abs(dx))} × ${formatMm(Math.abs(dy))} mm`;
    case "circle": return `centre ${at} · ⌀ ${formatMm(2 * Math.hypot(dx, dy))} mm`;
    case "line":
    case "polyline": return `from ${at} · ${formatMm(Math.hypot(dx, dy))} mm at ${formatMm((Math.atan2(dy, dx) * 180) / Math.PI)}°`;
  }
}

/**
 * The drawing's title for the header, in quotes after the file name: null
 * when it's blank or just repeats the file name.
 */
export function quotedTitle(title: string, fileName: string): string | null {
  const t = title.replace(/\s+/g, " ").trim();
  return t && t !== fileName ? `“${t}”` : null;
}

/**
 * The status bar while a selected shape is dragged (moved, or resized by a
 * handle): its position and size, reading as drawing it does.
 */
export function shapeStatus(s: ResolvedShape): string {
  const at = (p: readonly [number, number]) => `${formatMm(p[0])}, ${formatMm(p[1])} mm`;
  switch (s.kind) {
    case "rect": return `from ${at([s.x, s.y])} · ${formatMm(s.width)} × ${formatMm(s.height)} mm`;
    case "circle": return `centre ${at(s.centre)} · ⌀ ${formatMm(s.diameter)} mm`;
    case "line": return `from ${at(s.from)} · ${formatMm(s.length)} mm at ${formatMm(s.angle)}°`;
    case "polyline": {
      const b = s.bounds;
      return `path · ${s.nodes.length} nodes · from ${at([b.minX, b.minY])} · ${formatMm(b.maxX - b.minX)} × ${formatMm(b.maxY - b.minY)} mm`;
    }
  }
}

/** What the status bar's position readout depends on (from editor state). */
export interface PositionState {
  tool: "select" | DrawTool;
  selection: readonly EntityId[];
  cursor: readonly [number, number] | null;
  draw: { tool: DrawTool; start: readonly [number, number] } | null;
  measure: EntityId | null;
  /** The selected node of a path: its stored index. */
  node?: { shape: EntityId; index: number } | null;
  /** The selected segment of a path: its start node's stored index. */
  segment?: { shape: EntityId; index: number } | null;
}

/**
 * The status bar's position readout, first that applies: the shape being
 * drawn (a path: its segment to the pointer); the shape being
 * dragged; with the select tool, a path's selected node (its number and
 * drawn position) or segment (its number and length), then the selection (one shape's position and size, or
 * the bounds of several); the pointer.
 */
export function positionStatus(e: PositionState, r: Resolved): string {
  if (e.draw && e.cursor) return drawStatus(e.draw.tool, e.draw.start, e.cursor);
  const dragged = e.measure ? r.shapes[e.measure] : undefined;
  if (dragged) return shapeStatus(dragged);
  if (e.tool === "select") {
    const path = e.node ? r.shapes[e.node.shape] : undefined;
    if (path?.kind === "polyline") {
      const k = path.nodes.findIndex((n) => n.index === e.node!.index);
      const n = path.nodes[k];
      if (n) return `node ${k + 1} of ${path.nodes.length} · ${formatMm(n.point[0])}, ${formatMm(n.point[1])} mm`;
    }
    const segPath = e.segment ? r.shapes[e.segment.shape] : undefined;
    if (segPath?.kind === "polyline") {
      const k = segPath.nodes.findIndex((n) => n.index === e.segment!.index);
      const element = k < 0 ? undefined : segPath.path[k];
      if (element) return `segment ${k + 1} of ${segPath.path.length} · ${formatMm(elementLength(element))} mm`;
    }
    const shapes = e.selection.flatMap((id) => (Object.hasOwn(r.shapes, id) ? [r.shapes[id]!] : []));
    if (shapes.length === 1) return shapeStatus(shapes[0]!);
    if (shapes.length > 1) {
      const b = unionBounds(shapes.map((s) => s.bounds));
      return drawStatus("rect", [b.minX, b.minY], [b.maxX, b.maxY]);
    }
  }
  return e.cursor ? `${formatMm(e.cursor[0])}, ${formatMm(e.cursor[1])} mm` : "";
}
