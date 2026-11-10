import { useMemo } from "react";
import { useDocument, store } from "../app/store";
import { useEditor } from "../app/editor";
import { newDrawing, openDrawing, saveDrawing, saveDrawingAs, useDirty, useFileName } from "../app/file";
import { tell } from "../app/ask";
import { DEFAULT_VIEW } from "../view/viewport";
import { HistoryIcon, IconButton, NewIcon, OpenIcon, PrintIcon, PropertiesIcon, SaveAsIcon, SaveIcon } from "./icons";

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
  const { dispatch } = useEditor();
  const file = useFileCommands();
  const name = useFileName();
  const dirty = useDirty();
  return (
    <header className="toolbar">
      <span className="brand">Delinya</span>
      <span className="filename" data-tip={dirty ? "Unsaved changes" : "Saved"}>
        {name}{dirty && <span className="dirty"> •</span>}
      </span>
      <div className="group">
        <IconButton label="New" tip="New drawing" onClick={file.newFile}><NewIcon /></IconButton>
        <IconButton label="Open…" tip="Open… (⌘O)" onClick={file.open}><OpenIcon /></IconButton>
        <IconButton label="Save" tip="Save (⌘S)" onClick={file.save}><SaveIcon /></IconButton>
        <IconButton label="Save as…" tip="Save as… (⇧⌘S)" onClick={file.saveAs}><SaveAsIcon /></IconButton>
      </div>
      <div className="group">
        <IconButton label="Properties…" tip="Properties: title, author, notes, variables" onClick={() => dispatch({ type: "dialog", dialog: "properties" })}>
          <PropertiesIcon />
        </IconButton>
        <IconButton label="Print / Export…" tip="Print / Export… (⌘P)" onClick={() => dispatch({ type: "dialog", dialog: "output" })}>
          <PrintIcon />
        </IconButton>
      </div>
      <div className="group">
        <IconButton label="Undo" tip="Undo (⌘Z)" disabled={!store.canUndo} onClick={() => store.undo()}><HistoryIcon /></IconButton>
        <IconButton label="Redo" tip="Redo (⇧⌘Z)" disabled={!store.canRedo} onClick={() => store.redo()}><HistoryIcon redo /></IconButton>
      </div>
    </header>
  );
}
