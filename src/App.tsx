import { useEffect, useReducer, type CSSProperties } from "react";
import { EditorContext, editorReducer, initialEditor, selectableOnly, useEditor, type Tool } from "./app/editor";
import { store, useDocument } from "./app/store";
import { Canvas } from "./canvas/Canvas";
import { StatusBar } from "./panels/StatusBar";
import { OutputDialog } from "./panels/OutputDialog";
import { PropertiesDialog } from "./panels/PropertiesDialog";
import { AskDialog } from "./panels/AskDialog";
import { Tooltip } from "./panels/Tooltip";
import { SelectionPanel, deleteSelection } from "./panels/SelectionPanel";
import { LinkButtons } from "./panels/LinkButtons";
import { ToolPalette } from "./panels/ToolPalette";
import { LayerPalette } from "./panels/LayerPalette";
import { Toolbar, useFileCommands } from "./panels/Toolbar";
import { useDirty, useFileName } from "./app/file";
import { STYLE } from "./output/style";
import "./styles.css";

// Dimensions look the same on screen as on paper: one colour, from the output style.
const APP_COLOURS = { "--dimension": STYLE.colour.dimension } as CSSProperties;

const TOOL_KEYS: Record<string, Tool> = { v: "select", l: "line", r: "rect", c: "circle" };

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, initialEditor);
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
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); store.redo(); return; }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (editor.selection.length) { deleteSelection(editor.selection); dispatch({ type: "select", ids: [] }); }
        return;
      }
      if (e.key === "Escape") { dispatch({ type: "tool", tool: "select" }); dispatch({ type: "select", ids: [] }); return; }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) dispatch({ type: "tool", tool });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor.selection, editor.dialog, dispatch, file]);

  return (
    <div className="app" style={APP_COLOURS}>
      <Toolbar />
      <div className="canvas-area">
        <Canvas />
        <SelectionPanel />
        <LinkButtons />
        <ToolPalette />
        <LayerPalette />
      </div>
      <StatusBar />
      {editor.dialog === "output" && <OutputDialog />}
      {editor.dialog === "properties" && <PropertiesDialog />}
      {/* Last: a question can come up over another dialog. */}
      <AskDialog />
      <Tooltip />
    </div>
  );
}
