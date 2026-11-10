import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { formatMm } from "../canvas/Canvas";
import { DEFAULT_VIEW } from "../view/viewport";
import { sendPalettesHome } from "./floating";

export function StatusBar() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const issues = store.resolved.issues;
  return (
    <footer className="status">
      <span>{editor.cursor ? `${formatMm(editor.cursor[0])}, ${formatMm(editor.cursor[1])} mm` : ""}</span>
      <span>{editor.snap ? `snap: ${editor.snap.type}` : ""}</span>
      <span className="grow" />
      {issues.length > 0 && <span className="warn" title={issues.map((i) => `${i.entity}: ${i.message}`).join("\n")}>{issues.length} issues</span>}
      <span className="zoom">{Math.round(editor.view.scale * 100) / 100} px/mm</span>
      <button
        onClick={() => { dispatch({ type: "view", view: DEFAULT_VIEW }); sendPalettesHome(); }}
        title="Reset zoom and pan, and put the tool and layer palettes back top left"
      >
        Reset view
      </button>
    </footer>
  );
}
