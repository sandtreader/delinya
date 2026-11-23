import { useMemo, useRef } from "react";
import { useDocument, store } from "../app/store";
import { useEditor } from "../app/editor";
import { newDrawing, openDrawing, saveDrawing, saveDrawingAs, useDirty, useFileName } from "../app/file";
import { tell } from "../app/ask";
import { DEFAULT_VIEW } from "../view/viewport";
import { AutoDimensionIcon, HistoryIcon, IconButton, NewIcon, OpenIcon, PrintIcon, PropertiesIcon, SaveAsIcon, SaveIcon } from "./icons";
import { tip } from "./tip";
import { quotedTitle } from "../view/format";
import { discardPathDraft } from "../canvas/Canvas";

/**
 * File commands that also reset editor state when a drawing is replaced:
 * the old selection names entities that no longer exist. A new drawing
 * gets the default view; an opened one is fitted, once the old drawing's
 * hidden layers are cleared.
 */
export function useFileCommands() {
  const { dispatch } = useEditor();
  return useMemo(() => {
    const reset = (fit: boolean) => (replaced: boolean) => {
      if (!replaced) return;
      // A path half drawn on the old drawing goes with it, rather than being finished onto the new one.
      discardPathDraft();
      dispatch({ type: "select", ids: [] });
      dispatch({ type: "tool", tool: "select" });
      // Hidden and locked layers are this viewer's choice for the old drawing.
      dispatch({ type: "resetLayers" });
      dispatch(fit ? { type: "fit" } : { type: "view", view: DEFAULT_VIEW });
    };
    const fail = (e: unknown) => { void tell("Something went wrong", e instanceof Error ? e.message : String(e)); };
    return {
      newFile: () => { newDrawing().then(reset(false), fail); },
      open: () => { openDrawing().then(reset(true), fail); },
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
  const title = quotedTitle(store.resolved.document.title, name);
  // Pressing Undo blurs a field first: on the drawing, a box just drawn and
  // left empty is then taken back (abandonGesture), which is the undoing
  // wanted, so that click undoes nothing more. A key press has no pointer press.
  const undoPress = useRef(0);
  return (
    <header className="toolbar">
      <button type="button" className="brand" onClick={() => dispatch({ type: "dialog", dialog: "about" })} {...tip("About Delinya")}>
        Delinya
      </button>
      <div className="group">
        <IconButton label="New" tip="New drawing" onClick={file.newFile}><NewIcon /></IconButton>
        <IconButton label="Open…" tip="Open… (⌘O)" onClick={file.open}><OpenIcon /></IconButton>
        <IconButton label="Save" tip="Save (⌘S)" onClick={file.save}><SaveIcon /></IconButton>
        <IconButton label="Save as…" tip="Save as… (⇧⌘S)" onClick={file.saveAs}><SaveAsIcon /></IconButton>
      </div>
      <div className="group">
        <IconButton label="Properties…" tip="Properties: title block, grid, variables" onClick={() => dispatch({ type: "dialog", dialog: "properties" })}>
          <PropertiesIcon />
        </IconButton>
        <IconButton label="Print / Export…" tip="Print / Export… (⌘P)" onClick={() => dispatch({ type: "dialog", dialog: "output" })}>
          <PrintIcon />
        </IconButton>
      </div>
      <div className="group">
        <IconButton
          label="Undo" tip="Undo (⌘Z)" disabled={!store.canUndo}
          onPointerDown={() => { undoPress.current = store.abandoned; }}
          onClick={(e) => { if (e.detail === 0 || store.abandoned === undoPress.current) store.undo(); }}
        >
          <HistoryIcon />
        </IconButton>
        <IconButton label="Redo" tip="Redo (⇧⌘Z)" disabled={!store.canRedo} onClick={() => store.redo()}><HistoryIcon redo /></IconButton>
      </div>
      {/* Drawing settings: this viewer's own, remembered per browser. */}
      <div className="group">
        <AutoDimensionToggle />
      </div>
      {/* File name and the drawing's title; opens Properties on its Drawing tab. */}
      <button
        type="button" className="filename" onClick={() => dispatch({ type: "dialog", dialog: "properties" })}
        {...tip(`${dirty ? "Unsaved changes" : "Saved"} · click for the drawing's properties`)}
      >
        {name}{dirty && <span className="dirty"> •</span>}
        {title && <span className="title">{title}</span>}
      </button>
    </header>
  );
}

/** Whether drawing a rect, circle or line adds its dimensions (this viewer's choice). */
function AutoDimensionToggle() {
  const { editor, dispatch } = useEditor();
  const on = editor.labels.autoDimension;
  return (
    <IconButton
      label="Dimension new shapes"
      tip={`Dimension new shapes: ${on ? "on" : "off"}. Drawing a rectangle, circle or line adds its dimensions`}
      className={on ? "icon on" : "icon"} aria-pressed={on}
      onClick={() => dispatch({ type: "labels", labels: { autoDimension: !on } })}
    >
      <AutoDimensionIcon off={!on} />
    </IconButton>
  );
}
