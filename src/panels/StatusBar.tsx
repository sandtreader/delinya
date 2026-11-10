import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { formatMm } from "../canvas/Canvas";
import { drawStatus } from "../view/format";
import { DEFAULT_VIEW } from "../view/viewport";
import { sendPalettesHome } from "./floating";
import { canFullscreen, toggleFullscreen, useFullscreen } from "../app/fullscreen";
import { FullscreenIcon, IconButton, ResetViewIcon } from "./icons";
import { tip } from "./tip";

export function StatusBar() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const issues = store.resolved.issues;
  const fullscreen = useFullscreen();
  return (
    <footer className="status">
      <span>
        {editor.cursor && editor.draw ? drawStatus(editor.draw.tool, editor.draw.start, editor.cursor)
          : editor.cursor ? `${formatMm(editor.cursor[0])}, ${formatMm(editor.cursor[1])} mm` : ""}
      </span>
      <span>{editor.snap ? `snap: ${editor.snap.type}` : ""}</span>
      <span className="grow" />
      {issues.length > 0 && <span className="warn" {...tip(issues.map((i) => `${i.entity}: ${i.message}`).join("\n"))}>{issues.length} issues</span>}
      <span className="zoom">{Math.round(editor.view.scale * 100) / 100} px/mm</span>
      <div className="group">
        <IconButton
          label="Reset view" tip="Reset view: zoom, pan and palettes" data-tip-side="above"
          onClick={() => { dispatch({ type: "view", view: DEFAULT_VIEW }); sendPalettesHome(); }}
        >
          <ResetViewIcon />
        </IconButton>
        {canFullscreen() && (
          <IconButton
            label={fullscreen ? "Exit full screen" : "Full screen"} data-tip-side="above"
            onClick={() => { toggleFullscreen(); }}
          >
            <FullscreenIcon exit={fullscreen} />
          </IconButton>
        )}
      </div>
    </footer>
  );
}
