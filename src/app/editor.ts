// Editor (non-document) state: tool, selection, current layer, hidden and
// locked layers, grid show/snap, view, open dialog, duplicate settings.
// Never synced, saved or undoable.

import { createContext, useContext, type Dispatch } from "react";
import {
  isSelectable, type DuplicateDirection, type EntityId, type LayerView, type LinkTarget, type Resolved, type ResolvedPolyNode,
  type PathElement, type ResolvedPolyline, type SnapPoint,
} from "../model";
import { DEFAULT_VIEW, pan, zoomAt, type View } from "../view/viewport";
import type { DrawTool } from "../view/format";
import { DEFAULT_GRID_VIEW, type GridView } from "./gridView";

export type Tool = "select" | "line" | "rect" | "circle" | "polyline";
export type Dialog = "output" | "properties" | "about";

/**
 * The selection panel's Duplicate: which way the copies go, how far apart,
 * mm, how many, and whether their gaps, sizes and alignment are linked to
 * the original.
 */
export interface DuplicateSettings {
  direction: DuplicateDirection;
  spacing: number;
  count: number;
  linkGaps: boolean;
  linkSize: boolean;
  linkAlign: boolean;
}

/**
 * One node of a path: the path and the node's stored index (what the node
 * actions take). Also names a segment, by its start node.
 */
export interface NodeRef {
  shape: EntityId;
  index: number;
}

export interface EditorState {
  tool: Tool;
  selection: EntityId[];
  /**
   * The selected node of the one selected path, edited with the select
   * tool. Cleared whenever the selection changes or the tool leaves select.
   */
  node: NodeRef | null;
  /**
   * The selected segment of the one selected path, named by its start node;
   * never with a selected node. Kept and cleared as `node` is.
   */
  segment: NodeRef | null;
  /** The layer new shapes go on; null or gone means the first (see currentLayer). */
  layer: EntityId | null;
  /**
   * Layers this viewer has hidden or locked: their own choice, so not
   * synced, saved or undoable; cleared for a new or opened drawing.
   */
  layerView: LayerView;
  /**
   * Whether this viewer shows and snaps to the grid: their own choice, kept
   * in their browser and for a new or opened drawing. The spacing is the drawing's.
   */
  grid: GridView;
  view: View;
  /** Current pointer position in model mm, for the status bar. */
  cursor: [number, number] | null;
  /** Snap point the pointer is currently locked to. */
  snap: SnapPoint | null;
  /** While a new shape is dragged out: its tool and start, for the status bar. */
  draw: { tool: DrawTool; start: [number, number] } | null;
  /** While a selected shape is dragged (moved or resized): which, for the status bar. */
  measure: EntityId | null;
  dialog: Dialog | null;
  /** Arrange actions create live links instead of moving shapes once. */
  keepLinked: boolean;
  /** A link clicked on the canvas, offering to remove it; `at` is in screen px. */
  linkPopup: { target: LinkTarget; at: [number, number] } | null;
  /** Kept while the app is open, not saved. */
  duplicate: DuplicateSettings;
}

export const initialEditor: EditorState = {
  tool: "select",
  selection: [],
  node: null,
  segment: null,
  layer: null,
  layerView: { hidden: new Set(), locked: new Set() },
  grid: DEFAULT_GRID_VIEW,
  view: DEFAULT_VIEW,
  cursor: null,
  snap: null,
  draw: null,
  measure: null,
  dialog: null,
  keepLinked: false,
  linkPopup: null,
  duplicate: { direction: "right", spacing: 10, count: 1, linkGaps: false, linkSize: false, linkAlign: false },
};

export type EditorAction =
  | { type: "tool"; tool: Tool }
  | { type: "select"; ids: EntityId[] }
  | { type: "toggleSelect"; id: EntityId }
  | { type: "node"; node: NodeRef | null }
  | { type: "segment"; segment: NodeRef | null }
  | { type: "layer"; id: EntityId }
  | { type: "toggleLayer"; id: EntityId; flag: "hidden" | "locked" }
  | { type: "resetLayers" }
  | { type: "grid"; grid: Partial<GridView> }
  | { type: "view"; view: View }
  | { type: "panBy"; dx: number; dy: number }
  | { type: "zoomAt"; factor: number; at: [number, number] }
  | { type: "pointer"; cursor: [number, number] | null; snap: SnapPoint | null; draw?: EditorState["draw"]; measure?: EntityId }
  | { type: "dialog"; dialog: Dialog | null }
  | { type: "keepLinked"; on: boolean }
  | { type: "linkPopup"; popup: EditorState["linkPopup"] }
  | { type: "duplicate"; settings: Partial<DuplicateSettings> };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    // A link popup belongs to the moment it was opened: any other choice closes it.
    // Hovering with select shows no position, so arriving at it clears the readout.
    // Nodes and segments are edited with select only.
    case "tool": return {
      ...s, tool: a.tool, linkPopup: null, node: a.tool === "select" ? s.node : null, segment: a.tool === "select" ? s.segment : null,
      ...(hoverShowsPosition(a.tool) ? {} : { cursor: null, snap: null, draw: null, measure: null }),
    };
    // A selected node or segment belongs to its path being the whole selection.
    case "select": {
      const only = a.ids.length === 1 ? a.ids[0] : undefined;
      return {
        ...s, selection: a.ids, linkPopup: null,
        node: only === s.node?.shape ? s.node : null, segment: only === s.segment?.shape ? s.segment : null,
      };
    }
    case "toggleSelect":
      return { ...s, linkPopup: null, node: null, segment: null, selection: s.selection.includes(a.id) ? s.selection.filter((i) => i !== a.id) : [...s.selection, a.id] };
    // A node or a segment, not both.
    case "node": return { ...s, node: a.node, segment: a.node ? null : s.segment };
    case "segment": return { ...s, segment: a.segment, node: a.segment ? null : s.node };
    case "layer": return { ...s, layer: a.id };
    case "toggleLayer": {
      const set = new Set(s.layerView[a.flag]);
      if (!set.delete(a.id)) set.add(a.id);
      return { ...s, layerView: { ...s.layerView, [a.flag]: set } };
    }
    case "resetLayers": return { ...s, layer: null, layerView: initialEditor.layerView };
    case "grid": return { ...s, grid: { ...s.grid, ...a.grid } };
    case "view": return { ...s, view: a.view };
    // Deltas, not absolute views: several pointer or wheel events can arrive
    // between renders and each must build on the last.
    case "panBy": return { ...s, view: pan(s.view, a.dx, a.dy) };
    case "zoomAt": return { ...s, view: zoomAt(s.view, a.factor, a.at) };
    case "pointer":
      // Hovering with select clears it on every move; when already clear, keep the state so nothing re-renders.
      if (!a.cursor && !a.snap && !a.draw && !a.measure && !s.cursor && !s.snap && !s.draw && !s.measure) return s;
      return { ...s, cursor: a.cursor, snap: a.snap, draw: a.draw ?? null, measure: a.measure ?? null };
    case "dialog": return { ...s, dialog: a.dialog };
    case "keepLinked": return { ...s, keepLinked: a.on };
    case "linkPopup": return { ...s, linkPopup: a.popup };
    case "duplicate": return { ...s, duplicate: { ...s.duplicate, ...a.settings } };
  }
}

/**
 * Whether just hovering (no drag) shows the pointer position in the status
 * bar: with a drawing tool yes, with select no. A drag shows it in any tool.
 */
export function hoverShowsPosition(tool: Tool): boolean {
  return tool !== "select";
}

/**
 * Which floating panel the selection gets: one shape's fields with any tool,
 * so a just-drawn shape can be sized at once; the arrange panel for two or
 * more, only with the select tool. Ids no longer in `shapes` don't count.
 */
export function panelFor(tool: Tool, selection: EntityId[], shapes: Record<string, unknown>): "shape" | "arrange" | null {
  const n = selection.filter((id) => Object.hasOwn(shapes, id)).length;
  if (n === 0) return null;
  if (n === 1) return "shape";
  return tool === "select" ? "arrange" : null;
}

/** The layer new shapes go on: the chosen one while it exists, else the first (back) layer. */
export function currentLayer(r: Resolved, wanted: EntityId | null): EntityId {
  return wanted !== null && r.layers.some((l) => l.id === wanted) ? wanted : r.layers[0]!.id;
}

/**
 * The selected path node, while it can be edited: the select tool, its path
 * the whole selection, and the node still there (undo or a peer may have
 * taken it). `position` is its place among the drawn nodes, from 0.
 */
export function selectedPathNode(r: Resolved, e: Pick<EditorState, "tool" | "selection" | "node">): { shape: ResolvedPolyline; node: ResolvedPolyNode; position: number } | null {
  const ref = e.node;
  if (!ref || e.tool !== "select" || e.selection.length !== 1 || e.selection[0] !== ref.shape) return null;
  const shape = r.shapes[ref.shape];
  if (shape?.kind !== "polyline") return null;
  const position = shape.nodes.findIndex((n) => n.index === ref.index);
  return position < 0 ? null : { shape, node: shape.nodes[position]!, position };
}

/**
 * The selected path segment, while it can be edited (as selectedPathNode).
 * `position` is its place among the drawn segments, from 0, and `element`
 * the drawn segment or cubic.
 */
export function selectedPathSegment(
  r: Resolved, e: Pick<EditorState, "tool" | "selection" | "segment">,
): { shape: ResolvedPolyline; index: number; position: number; element: PathElement } | null {
  const ref = e.segment;
  if (!ref || e.tool !== "select" || e.selection.length !== 1 || e.selection[0] !== ref.shape) return null;
  const shape = r.shapes[ref.shape];
  if (shape?.kind !== "polyline") return null;
  const position = shape.nodes.findIndex((n) => n.index === ref.index);
  const element = position < 0 ? undefined : shape.path[position];
  return element ? { shape, index: ref.index, position, element } : null;
}

/** The ids a selection may keep: shapes that exist on a layer this viewer has neither hidden nor locked. */
export function selectableOnly(r: Resolved, ids: EntityId[], view: LayerView): EntityId[] {
  return ids.filter((id) => isSelectable(r, id, view));
}

export const EditorContext = createContext<{ editor: EditorState; dispatch: Dispatch<EditorAction> } | null>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("EditorContext missing");
  return ctx;
}
