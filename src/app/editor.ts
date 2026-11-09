// Editor (non-document) state: tool, selection, view, open dialog. Never synced.

import { createContext, useContext, type Dispatch } from "react";
import type { EntityId, SnapPoint } from "../model";
import { DEFAULT_VIEW, pan, zoomAt, type View } from "../view/viewport";

export type Tool = "select" | "line" | "rect" | "circle";
export type Dialog = "output";

export interface EditorState {
  tool: Tool;
  selection: EntityId[];
  view: View;
  /** Current pointer position in model mm, for the status bar. */
  cursor: [number, number] | null;
  /** Snap point the pointer is currently locked to. */
  snap: SnapPoint | null;
  dialog: Dialog | null;
}

export const initialEditor: EditorState = {
  tool: "select",
  selection: [],
  view: DEFAULT_VIEW,
  cursor: null,
  snap: null,
  dialog: null,
};

export type EditorAction =
  | { type: "tool"; tool: Tool }
  | { type: "select"; ids: EntityId[] }
  | { type: "toggleSelect"; id: EntityId }
  | { type: "view"; view: View }
  | { type: "panBy"; dx: number; dy: number }
  | { type: "zoomAt"; factor: number; at: [number, number] }
  | { type: "pointer"; cursor: [number, number] | null; snap: SnapPoint | null }
  | { type: "dialog"; dialog: Dialog | null };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "tool": return { ...s, tool: a.tool };
    case "select": return { ...s, selection: a.ids };
    case "toggleSelect":
      return { ...s, selection: s.selection.includes(a.id) ? s.selection.filter((i) => i !== a.id) : [...s.selection, a.id] };
    case "view": return { ...s, view: a.view };
    // Deltas, not absolute views: several pointer or wheel events can arrive
    // between renders and each must build on the last.
    case "panBy": return { ...s, view: pan(s.view, a.dx, a.dy) };
    case "zoomAt": return { ...s, view: zoomAt(s.view, a.factor, a.at) };
    case "pointer": return { ...s, cursor: a.cursor, snap: a.snap };
    case "dialog": return { ...s, dialog: a.dialog };
  }
}

export const EditorContext = createContext<{ editor: EditorState; dispatch: Dispatch<EditorAction> } | null>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("EditorContext missing");
  return ctx;
}
