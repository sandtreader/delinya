import { useDocument, store } from "../app/store";
import { useEditor, type Tool } from "../app/editor";
import { DEFAULT_VIEW } from "../view/viewport";

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "line", label: "Line", key: "L" },
  { tool: "rect", label: "Rectangle", key: "R" },
  { tool: "circle", label: "Circle", key: "C" },
];

export function Toolbar() {
  useDocument();
  const { editor, dispatch } = useEditor();
  return (
    <header className="toolbar">
      <span className="brand">Delinya</span>
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
