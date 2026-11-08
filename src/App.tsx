import { useEffect, useReducer } from "react";
import { EditorContext, editorReducer, initialEditor, type Tool } from "./app/editor";
import { store } from "./app/store";
import { Canvas } from "./canvas/Canvas";
import { Inspector, deleteSelection } from "./panels/Inspector";
import { StatusBar } from "./panels/StatusBar";
import { Toolbar } from "./panels/Toolbar";
import "./styles.css";

const TOOL_KEYS: Record<string, Tool> = { v: "select", l: "line", r: "rect", c: "circle" };

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, initialEditor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
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
  }, [editor.selection]);

  return (
    <EditorContext.Provider value={{ editor, dispatch }}>
      <div className="app">
        <Toolbar />
        <Canvas />
        <Inspector />
        <StatusBar />
      </div>
    </EditorContext.Provider>
  );
}
