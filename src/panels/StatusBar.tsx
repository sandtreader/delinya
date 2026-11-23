import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { positionStatus } from "../view/format";
import { DEFAULT_VIEW } from "../view/viewport";
import { sendPalettesHome } from "./floating";
import { canFullscreen, toggleFullscreen, useFullscreen } from "../app/fullscreen";
import { DimensionsIcon, FitViewIcon, FullscreenIcon, IconButton, ResetViewIcon } from "./icons";
import { tip } from "./tip";

export function StatusBar() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const issues = store.resolved.issues;
  const fullscreen = useFullscreen();
  return (
    <footer className="status">
      <span>{positionStatus(editor, store.resolved)}</span>
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
        <IconButton label="Fit to drawing" tip="Fit to drawing (F)" data-tip-side="above" onClick={() => dispatch({ type: "fit" })}>
          <FitViewIcon />
        </IconButton>
        {/* This viewer's choice; printing has its own. */}
        <IconButton
          label="Show dimensions" data-tip-side="above"
          tip={`Show dimensions: ${editor.labels.show ? "on" : "off"}. Dimensions and radius labels on screen; printing has its own option`}
          className={editor.labels.show ? "icon on" : "icon"} aria-pressed={editor.labels.show}
          onClick={() => dispatch({ type: "labels", labels: { show: !editor.labels.show } })}
        >
          <DimensionsIcon off={!editor.labels.show} />
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
