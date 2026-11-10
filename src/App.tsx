import { useEffect, useReducer, type CSSProperties } from "react";
import {
  EditorContext, editorReducer, initialEditor, selectableOnly, selectedPathNode, selectedPathSegment, useEditor, type Tool,
} from "./app/editor";
import { store, useDocument } from "./app/store";
import { Canvas } from "./canvas/Canvas";
import { Rulers } from "./canvas/Rulers";
import { StatusBar } from "./panels/StatusBar";
import { OutputDialog } from "./panels/OutputDialog";
import { PropertiesDialog } from "./panels/PropertiesDialog";
import { AboutDialog } from "./panels/AboutDialog";
import { AskDialog } from "./panels/AskDialog";
import { Tooltip } from "./panels/Tooltip";
import { SelectionPanel, deleteSelection, duplicateSelection } from "./panels/SelectionPanel";
import { LinkButtons } from "./panels/LinkButtons";
import { NodeCard, deleteNode } from "./panels/NodeCard";
import { SegmentCard, deleteSegment } from "./panels/SegmentCard";
import { ToolPalette } from "./panels/ToolPalette";
import { LayerPalette } from "./panels/LayerPalette";
import { Toolbar, useFileCommands } from "./panels/Toolbar";
import { useDirty, useFileName } from "./app/file";
import { browserStorage } from "./app/floatPosition";
import { loadGridView, saveGridView } from "./app/gridView";
import { STYLE } from "./output/style";
import { RULER_PX } from "./view/rulers";
import "./styles.css";

// Dimensions look the same on screen as on paper: one colour, from the output style.
const APP_COLOURS = { "--dimension": STYLE.colour.dimension } as CSSProperties;
const RULER_SIZE = { "--ruler": `${RULER_PX}px` } as CSSProperties;

const TOOL_KEYS: Record<string, Tool> = { v: "select", l: "line", r: "rect", c: "circle", p: "polyline" };

export function App() {
  // Showing and snapping to the grid are this browser's choice, kept between visits.
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => ({ ...initialEditor, grid: loadGridView(browserStorage()) }));
  useEffect(() => { saveGridView(browserStorage(), editor.grid); }, [editor.grid]);
  return (
    <EditorContext.Provider value={{ editor, dispatch }}>
      <Shell />
    </EditorContext.Provider>
  );
}

/** Inside the editor context, so file commands can reset editor state. */
function Shell() {
  const { editor, dispatch } = useEditor();
  const file = useFileCommands();
  const name = useFileName();
  const dirty = useDirty();
  const state = useDocument();

  // Only shapes on shown, unlocked layers stay selected: hiding or locking a
  // layer, moving shapes onto one, undo and peers can all strand a selection.
  useEffect(() => {
    const keep = selectableOnly(store.resolved, editor.selection, editor.layerView);
    if (keep.length !== editor.selection.length) dispatch({ type: "select", ids: keep });
  }, [state, editor.selection, editor.layerView, dispatch]);

  useEffect(() => { document.title = `${dirty ? "• " : ""}${name} — Delinya`; }, [name, dirty]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (store.dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // An open dialog handles its own keys.
      if (editor.dialog) return;
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        dispatch({ type: "dialog", dialog: "output" });
        return;
      }
      // File keys work from inside a field too; blurring first commits its value.
      if (mod && (e.key.toLowerCase() === "s" || e.key.toLowerCase() === "o")) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (e.key.toLowerCase() === "o") file.open();
        else if (e.shiftKey) file.saveAs();
        else file.save();
        return;
      }
      // ⌘D: one copy of the selection, in the panel's Duplicate direction
      // and gap whatever its count, selected, so pressing again carries on.
      // Never the browser's bookmark.
      // From a field too, like ⌘S: blurring first commits its value.
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (!editor.selection.length) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        const copies = duplicateSelection(editor.selection, { ...editor.duplicate, count: 1 });
        if (copies) dispatch({ type: "select", ids: copies });
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); return; }
      if (mod) return;
      // A path's selected node or segment comes first: Delete takes it, not
      // the path, and Escape lets go of it. (While a path is being drawn, the
      // canvas has these keys.)
      const at = { tool: editor.tool, selection: editor.selection };
      const node = selectedPathNode(store.resolved, { ...at, node: editor.node });
      const segment = selectedPathSegment(store.resolved, { ...at, segment: editor.segment });
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (node) deleteNode(node.shape.id, node.node.index, dispatch);
        else if (segment) deleteSegment(segment.shape.id, segment.index, dispatch);
        else if (editor.selection.length) { deleteSelection(editor.selection); dispatch({ type: "select", ids: [] }); }
        return;
      }
      if (e.key === "Escape") {
        if (node) { dispatch({ type: "node", node: null }); return; }
        if (segment) { dispatch({ type: "segment", segment: null }); return; }
        dispatch({ type: "tool", tool: "select" });
        dispatch({ type: "select", ids: [] });
        return;
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) dispatch({ type: "tool", tool });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor.selection, editor.dialog, editor.duplicate, editor.tool, editor.node, editor.segment, dispatch, file]);

  return (
    <div className="app" style={APP_COLOURS}>
      <Toolbar />
      {/* The rulers frame the drawing area; everything floating over the
          drawing is placed in that area, so it starts inside them. */}
      <div className="canvas-frame" style={RULER_SIZE}>
        <Rulers />
        <div className="canvas-area">
          <Canvas />
          <SelectionPanel />
          <LinkButtons />
          <NodeCard />
          <SegmentCard />
          <ToolPalette />
          <LayerPalette />
        </div>
      </div>
      <StatusBar />
      {editor.dialog === "output" && <OutputDialog />}
      {editor.dialog === "properties" && <PropertiesDialog />}
      {editor.dialog === "about" && <AboutDialog />}
      {/* Last: a question can come up over another dialog. */}
      <AskDialog />
      <Tooltip />
    </div>
  );
}
