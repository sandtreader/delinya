// A small card beside a path's selected segment (select tool), at its
// middle: straight or curved, and delete, on one row. Floats and follows
// as the node card does (PathCard).

import type { Dispatch, ReactNode } from "react";
import { arcMid, cubicPoint, deletePolySegment, midpoint, newId, setPolySegmentCurved, type EntityId, type Point } from "../model";
import { store, useDocument } from "../app/store";
import { selectedPathSegment, useEditor, type EditorAction } from "../app/editor";
import { toScreen } from "../view/viewport";
import { Icon, IconButton } from "./icons";
import { BinIcon, PathCard } from "./PathCard";

/**
 * Delete a path's segment (the card's bin and the Delete key): a closed
 * path opens there, an open one splits in two. Selects what is left of the
 * path (both parts after a split; nothing if it went).
 */
export function deleteSegment(id: EntityId, index: number, dispatch: Dispatch<EditorAction>) {
  const out = deletePolySegment(store.state, id, index, newId);
  if (!out) return;
  store.commit(out.change);
  dispatch({ type: "select", ids: out.ids });
  dispatch({ type: "segment", segment: null });
}

const KINDS: Array<{ curved: boolean; label: string; tip: string; icon: ReactNode }> = [
  {
    curved: false, label: "Straight", tip: "Straight: a straight line between its nodes",
    // A straight line between two square nodes.
    icon: (
      <>
        <path d="M3.5 12.5l9-9" />
        <rect x="1.7" y="10.7" width="3.6" height="3.6" fill="currentColor" stroke="none" />
        <rect x="10.7" y="1.7" width="3.6" height="3.6" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    curved: true, label: "Curve", tip: "Curve: bent by the handles at its ends; drag the segment to bend it",
    // An arc between two nodes, each with a handle.
    icon: (
      <>
        <path d="M2.5 13.5C4.5 4 11.5 4 13.5 13.5" />
        <path d="M2.5 13.5L4.5 4M13.5 13.5L11.5 4" strokeWidth={0.9} />
        <circle cx="4.5" cy="4" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="11.5" cy="4" r="1.1" fill="currentColor" stroke="none" />
        <rect x="0.9" y="11.9" width="3.2" height="3.2" fill="currentColor" stroke="none" />
        <rect x="11.9" y="11.9" width="3.2" height="3.2" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

export function SegmentCard() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const sel = selectedPathSegment(store.resolved, editor);
  if (!sel) return null;
  const { shape, index, position, element } = sel;
  const curved = element.kind === "cubic";
  const middle: Point = element.kind === "cubic" ? cubicPoint(element, 0.5) : element.kind === "segment" ? midpoint(element.from, element.to) : arcMid(element);
  const setCurved = (on: boolean) => { const c = setPolySegmentCurved(store.state, shape.id, index, on); if (c) store.commit(c); };

  return (
    <PathCard at={toScreen(editor.view, middle)} name={`Segment ${position + 1} of ${shape.path.length}`}>
      <div className="path-card-row">
        <div className="icon-toggle" role="group" aria-label="Segment type">
          {KINDS.map((k) => (
            <IconButton
              key={k.label} label={k.label} tip={k.tip} className={curved === k.curved ? "icon on" : "icon"}
              aria-pressed={curved === k.curved} onClick={() => setCurved(k.curved)}
            >
              <Icon size={16}>{k.icon}</Icon>
            </IconButton>
          ))}
        </div>
        <IconButton label="Delete segment" tip="Delete segment (Del)" className="icon danger" onClick={() => deleteSegment(shape.id, index, dispatch)}>
          <BinIcon />
        </IconButton>
      </div>
    </PathCard>
  );
}
