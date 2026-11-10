// Editor (non-document) state: tool, selection, current layer, hidden and
// locked layers, grid show/snap, view, open dialog, duplicate settings.
// Never synced, saved or undoable.

import { createContext, useContext, type Dispatch } from "react";
import { isSelectable, type DuplicateDirection, type EntityId, type LayerView, type LinkTarget, type Resolved, type SnapPoint } from "../model";
import { DEFAULT_VIEW, pan, zoomAt, type View } from "../view/viewport";
import type { DrawTool } from "../view/format";
import { DEFAULT_GRID_VIEW, type GridView } from "./gridView";

export type Tool = "select" | "line" | "rect" | "circle";
export type Dialog = "output" | "properties" | "about";

/** The selection panel's Duplicate: which way the copy goes and how far clear of the original, mm. */
export interface DuplicateSettings {
  direction: DuplicateDirection;
  spacing: number;
}

export interface EditorState {
  tool: Tool;
  selection: EntityId[];
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
  layer: null,
  layerView: { hidden: new Set(), locked: new Set() },
  grid: DEFAULT_GRID_VIEW,
  view: DEFAULT_VIEW,
  cursor: null,
  snap: null,
  draw: null,
  dialog: null,
  keepLinked: false,
  linkPopup: null,
  duplicate: { direction: "right", spacing: 10 },
};

export type EditorAction =
  | { type: "tool"; tool: Tool }
  | { type: "select"; ids: EntityId[] }
  | { type: "toggleSelect"; id: EntityId }
  | { type: "layer"; id: EntityId }
  | { type: "toggleLayer"; id: EntityId; flag: "hidden" | "locked" }
  | { type: "resetLayers" }
  | { type: "grid"; grid: Partial<GridView> }
  | { type: "view"; view: View }
  | { type: "panBy"; dx: number; dy: number }
  | { type: "zoomAt"; factor: number; at: [number, number] }
  | { type: "pointer"; cursor: [number, number] | null; snap: SnapPoint | null; draw?: EditorState["draw"] }
  | { type: "dialog"; dialog: Dialog | null }
  | { type: "keepLinked"; on: boolean }
  | { type: "linkPopup"; popup: EditorState["linkPopup"] }
  | { type: "duplicate"; settings: Partial<DuplicateSettings> };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    // A link popup belongs to the moment it was opened: any other choice closes it.
    // Hovering with select shows no position, so arriving at it clears the readout.
    case "tool": return { ...s, tool: a.tool, linkPopup: null, ...(hoverShowsPosition(a.tool) ? {} : { cursor: null, snap: null, draw: null }) };
    case "select": return { ...s, selection: a.ids, linkPopup: null };
    case "toggleSelect":
      return { ...s, linkPopup: null, selection: s.selection.includes(a.id) ? s.selection.filter((i) => i !== a.id) : [...s.selection, a.id] };
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
      if (!a.cursor && !a.snap && !a.draw && !s.cursor && !s.snap && !s.draw) return s;
      return { ...s, cursor: a.cursor, snap: a.snap, draw: a.draw ?? null };
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
