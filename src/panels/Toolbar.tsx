import { useMemo } from "react";
import { useDocument, store } from "../app/store";
import { useEditor } from "../app/editor";
import { newDrawing, openDrawing, saveDrawing, saveDrawingAs, useDirty, useFileName } from "../app/file";
import { tell } from "../app/ask";
import { DEFAULT_VIEW } from "../view/viewport";
import { sendPalettesHome } from "./floating";

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
      // Hidden and locked layers are this viewer's choice for the old drawing.
      dispatch({ type: "resetLayers" });
    };
    const fail = (e: unknown) => { void tell("Something went wrong", e instanceof Error ? e.message : String(e)); };
    return {
      newFile: () => { newDrawing().then(reset, fail); },
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
        <button onClick={() => dispatch({ type: "dialog", dialog: "properties" })} title="Title, author, revision, notes and variables">Properties…</button>
        <button onClick={() => dispatch({ type: "dialog", dialog: "output" })} title="Print and export (⌘P)">Print / Export…</button>
      </div>
      <div className="group">
        <button className="icon" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (⌘Z)" aria-label="Undo">
          <HistoryIcon />
        </button>
        <button className="icon" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (⇧⌘Z)" aria-label="Redo">
          <HistoryIcon redo />
        </button>
      </div>
      <div className="group">
        <span className="zoom">{Math.round(editor.view.scale * 100) / 100} px/mm</span>
        <button
          onClick={() => { dispatch({ type: "view", view: DEFAULT_VIEW }); sendPalettesHome(); }}
          title="Reset zoom and pan, and put the tool and layer palettes back top left"
        >
          Reset view
        </button>
      </div>
    </header>
  );
}

/** A curved arrow back (undo) or, mirrored, forward (redo). */
function HistoryIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={redo ? "matrix(-1 0 0 1 16 0)" : undefined}>
        <path d="M5.5 3.5 2.5 6.5l3 3" />
        <path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H6.5" />
      </g>
    </svg>
  );
}
