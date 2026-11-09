import { useMemo } from "react";
import { useDocument, store } from "../app/store";
import { useEditor, type Tool } from "../app/editor";
import { newDrawing, openDrawing, saveDrawing, saveDrawingAs, useDirty, useFileName } from "../app/file";
import { DEFAULT_VIEW } from "../view/viewport";

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "line", label: "Line", key: "L" },
  { tool: "rect", label: "Rectangle", key: "R" },
  { tool: "circle", label: "Circle", key: "C" },
];

/**
 * File commands that also reset editor state when a drawing is replaced:
 * the old selection names entities that no longer exist.
 */
export function useFileCommands() {
  const { dispatch } = useEditor();
  return useMemo(() => {
    const reset = (replaced: boolean) => {
      if (!replaced) return;
      dispatch({ type: "select", ids: [] });
      dispatch({ type: "tool", tool: "select" });
      dispatch({ type: "view", view: DEFAULT_VIEW });
    };
    const fail = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));
    return {
      newFile: () => reset(newDrawing()),
      open: () => { openDrawing().then(reset, fail); },
      save: () => { saveDrawing().catch(fail); },
      saveAs: () => { saveDrawingAs().catch(fail); },
    };
  }, [dispatch]);
}

export function Toolbar() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const file = useFileCommands();
  const name = useFileName();
  const dirty = useDirty();
  return (
    <header className="toolbar">
      <span className="brand">Delinya</span>
      <span className="filename" title={dirty ? "Unsaved changes" : "Saved"}>
        {name}{dirty && <span className="dirty"> •</span>}
      </span>
      <div className="group">
        <button onClick={file.newFile} title="New drawing">New</button>
        <button onClick={file.open} title="Open (⌘O)">Open…</button>
        <button onClick={file.save} title="Save (⌘S)">Save</button>
        <button onClick={file.saveAs} title="Save as (⇧⌘S)">Save as…</button>
      </div>
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={editor.tool === t.tool ? "active" : ""}
            onClick={() => dispatch({ type: "tool", tool: t.tool })}
            title={`${t.label} (${t.key})`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="group">
        <button disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (⌘Z)">Undo</button>
        <button disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (⇧⌘Z)">Redo</button>
      </div>
      <div className="group">
        <span className="zoom">{Math.round(editor.view.scale * 100) / 100} px/mm</span>
        <button onClick={() => dispatch({ type: "view", view: DEFAULT_VIEW })} title="Reset view">Reset view</button>
      </div>
    </header>
  );
}
