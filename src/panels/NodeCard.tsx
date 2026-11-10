// A small card beside a path's selected node (select tool): its type
// (corner or smooth), join or break apart, and delete on one row, then its
// drawn x and y on a row each. It floats over the canvas next to the node,
// follows it, and stays inside the drawing area (PathCard).

import type { Dispatch, ReactNode } from "react";
import {
  breakPolyNode, deletePolyNode, drawnOffset, joinPolyEnds, movePolyNode, newId, setPolyNodeType, snapNumber,
  type EntityId, type Point, type PolyNodeType,
} from "../model";
import { store, useDocument } from "../app/store";
import { selectedPathNode, useEditor, type EditorAction } from "../app/editor";
import { joinTarget } from "../canvas/polyEdit";
import { toScreen } from "../view/viewport";
import { Num } from "./fields";
import { Icon, IconButton } from "./icons";
import { BinIcon, PathCard } from "./PathCard";

/**
 * Delete a path's node (the card's bin and the Delete key). A path left
 * with one node goes altogether, and so does the selection; otherwise just
 * the selected node.
 */
export function deleteNode(id: EntityId, index: number, dispatch: Dispatch<EditorAction>) {
  const c = deletePolyNode(store.state, id, index);
  if (!c) return;
  store.commit(c);
  dispatch(store.resolved.shapes[id] ? { type: "node", node: null } : { type: "select", ids: [] });
}

const TYPES: Array<{ type: PolyNodeType; label: string; tip: string; icon: ReactNode }> = [
  {
    type: "cusp", label: "Corner", tip: "Corner: a sharp point; its handles, if any, move independently",
    // Two straight lines meeting at a square node.
    icon: <><path d="M2.5 14L8 4.5l5.5 9.5" /><rect x="6.2" y="2.7" width="3.6" height="3.6" fill="currentColor" stroke="none" /></>,
  },
  {
    type: "curve", label: "Smooth", tip: "Smooth: the curve runs smoothly through; its handles stay in line (Alt-drag one to break them)",
    // A smooth hump through a round node, its handles along the tangent.
    icon: (
      <>
        <path d="M2.5 14.5C2.5 8 5 5.5 8 5.5s5.5 2.5 5.5 9" />
        <path d="M2.5 5.5h11" strokeWidth={0.9} />
        <circle cx="8" cy="5.5" r="2" fill="currentColor" stroke="none" />
        <circle cx="2.5" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="13.5" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
      </>
    ),
  },
];

/** Two links of a chain, joined. */
const JoinIcon = () => (
  <Icon size={16}>
    <path d="M6.7 8.7a3.3 3.3 0 0 0 5 .4l2-2a3.3 3.3 0 0 0-4.7-4.7L7.9 3.5" />
    <path d="M9.3 7.3a3.3 3.3 0 0 0-5-.4l-2 2a3.3 3.3 0 0 0 4.7 4.7l1.1-1.1" />
  </Icon>
);

/** A chain broken in two (as the canvas's remove-link button). */
const BreakIcon = () => (
  <Icon size={16}>
    <path d="M6.6 9.4 4.8 11.2a2.1 2.1 0 0 1-3-3L3.6 6.4" />
    <path d="M9.4 6.6 11.2 4.8a2.1 2.1 0 0 1 3 3L12.4 9.6" />
    <path d="M5.6 1.8v1.8M1.8 5.6h1.8M10.4 14.2v-1.8M14.2 10.4h-1.8" />
  </Icon>
);

export function NodeCard() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const sel = selectedPathNode(store.resolved, editor);
  if (!sel) return null;
  const { shape, node, position } = sel;
  const id = shape.id, index = node.index;

  /** Fields show where the node is drawn; a link may draw the path away from its stored nodes. */
  const move = (axis: 0 | 1, v: number) => {
    const [dx, dy] = drawnOffset(store.state, shape);
    const stored: Point = [node.point[0] - dx, node.point[1] - dy];
    stored[axis] = v - (axis === 0 ? dx : dy);
    const c = movePolyNode(store.state, id, index, [snapNumber(stored[0]), snapNumber(stored[1])]);
    if (c) store.commit(c);
  };
  const setType = (type: PolyNodeType) => { const c = setPolyNodeType(store.state, id, index, type); if (c) store.commit(c); };

  // An end on another end (on a layer this viewer can edit) joins it; any
  // other node breaks apart, the end left on this path staying selected,
  // so the one undoes the other.
  const { hidden, locked } = editor.layerView;
  const target = joinTarget(store.resolved, { shape: id, index }, hidden, locked);
  const breakable = shape.closed || (position > 0 && position < shape.nodes.length - 1);
  const pick = (path: EntityId, node: number) => {
    dispatch({ type: "select", ids: [path] });
    dispatch({ type: "node", node: { shape: path, index: node } });
  };
  const join = () => {
    const out = target && joinPolyEnds(store.state, { shape: id, index }, target);
    if (!out) return;
    store.commit(out.change);
    pick(id, out.node);
  };
  const breakApart = () => {
    const out = breakPolyNode(store.state, id, index, newId);
    if (!out) return;
    store.commit(out.change);
    pick(out.ids[0]!, out.node);
  };

  return (
    <PathCard at={toScreen(editor.view, node.point)} name={`Node ${position + 1} of ${shape.nodes.length}`}>
      <div className="node-card-row">
        <div className="icon-toggle" role="group" aria-label="Node type">
          {TYPES.map((t) => (
            <IconButton
              key={t.type} label={t.label} tip={t.tip} className={node.type === t.type ? "icon on" : "icon"}
              aria-pressed={node.type === t.type} onClick={() => setType(t.type)}
            >
              <Icon size={16}>{t.icon}</Icon>
            </IconButton>
          ))}
        </div>
        {target && (
          <IconButton
            label="Join"
            tip={target.shape === id ? "Join: merge with the path's other end on this spot, closing the path" : "Join: merge with the end of the path on this spot, making one path"}
            onClick={join}
          >
            <JoinIcon />
          </IconButton>
        )}
        {breakable && (
          <IconButton
            label="Break apart"
            tip={shape.closed ? "Break apart: open the path here, leaving two end nodes on top of each other" : "Break apart: split the path here, leaving two end nodes on top of each other"}
            onClick={breakApart}
          >
            <BreakIcon />
          </IconButton>
        )}
        <IconButton label="Delete node" tip="Delete node (Del)" className="icon danger" onClick={() => deleteNode(id, index, dispatch)}>
          <BinIcon />
        </IconButton>
      </div>
      <div className="node-card-row">
        <label className="node-xy"><span className="hint">x</span><Num value={node.point[0]} onCommit={(v) => move(0, v)} /></label>
      </div>
      <div className="node-card-row">
        <label className="node-xy"><span className="hint">y</span><Num value={node.point[1]} onCommit={(v) => move(1, v)} /></label>
      </div>
    </PathCard>
  );
}
