// Broken-chain buttons over the canvas that remove a link, leaving shapes
// where the link put them: one in a popup where a link (guide or "= name")
// was clicked, and one on every link joining a multi-selection.

import { isRef, unlinkTarget, type LinkTarget } from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { describeLink, linkButtons } from "../view/linkButtons";
import { GUIDE_OVERHANG_PX } from "../view/linkGuides";
import { toScreen } from "../view/viewport";

export function LinkButtons() {
  const state = useDocument();
  const { editor, dispatch } = useEditor();
  const { view, selection, tool, linkPopup } = editor;

  const remove = (target: LinkTarget) => {
    const c = unlinkTarget(store.state, target);
    if (c) store.commit(c);
    dispatch({ type: "linkPopup", popup: null });
  };

  const shapes = selection.filter((id) => store.resolved.shapes[id]);
  const onSelection = tool === "select" && shapes.length >= 2
    ? linkButtons(state, store.resolved, shapes, GUIDE_OVERHANG_PX / view.scale, editor.layerView.hidden)
    : [];
  const popup = linkPopup && stillLinked(linkPopup.target) ? linkPopup : null;

  return (
    <>
      {onSelection.map((b, i) => {
        const [x, y] = toScreen(view, b.at);
        return (
          <button
            key={i} className="delink icon-only" style={{ left: x, top: y }}
            title={`Remove link: ${b.label}`} aria-label={`Remove link: ${b.label}`}
            onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(b.target)}
          >
            <BrokenChain />
          </button>
        );
      })}
      {popup && (
        <button
          className="delink popup" style={{ left: popup.at[0], top: popup.at[1] }}
          title="Remove this link; the shapes stay where they are"
          onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(popup.target)}
        >
          <BrokenChain /> <span>{describeLink(state, popup.target)}</span>
        </button>
      )}
    </>
  );

  /** A popup outlives its link if something else (undo, a peer) removed it. */
  function stillLinked(t: LinkTarget): boolean {
    if (t.kind === "link") return state.entities[t.id] !== undefined;
    const v = state.entities[t.shape]?.props[t.prop];
    return isRef(t.corner === undefined ? v : Array.isArray(v) ? v[t.corner] : undefined);
  }
}

function BrokenChain() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6.6 9.4 4.8 11.2a2.1 2.1 0 0 1-3-3L3.6 6.4" />
      <path d="M9.4 6.6 11.2 4.8a2.1 2.1 0 0 1 3 3L12.4 9.6" />
      <path d="M5.6 1.8v1.8M1.8 5.6h1.8M10.4 14.2v-1.8M14.2 10.4h-1.8" />
    </svg>
  );
}
