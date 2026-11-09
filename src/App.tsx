import { useEffect, useReducer, type CSSProperties } from "react";
import { EditorContext, editorReducer, initialEditor, useEditor, type Tool } from "./app/editor";
import { store } from "./app/store";
import { Canvas } from "./canvas/Canvas";
import { Inspector, deleteSelection } from "./panels/Inspector";
import { StatusBar } from "./panels/StatusBar";
import { OutputDialog } from "./panels/OutputDialog";
import { SelectionPanel } from "./panels/SelectionPanel";
import { ToolPalette } from "./panels/ToolPalette";
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
        <ToolPalette />
      </div>
      <Inspector />
      <StatusBar />
      {editor.dialog === "output" && <OutputDialog />}
    </div>
  );
}
