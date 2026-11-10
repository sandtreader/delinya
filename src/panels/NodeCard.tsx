// A small card beside a path's selected node (select tool): its type
// (corner or smooth) and delete on one row, then its drawn x and y on a
// row each. It floats over the canvas next to the node, follows it, and
// stays inside the drawing area (PathCard).

import type { Dispatch, ReactNode } from "react";
import { deletePolyNode, drawnOffset, movePolyNode, setPolyNodeType, snapNumber, type EntityId, type Point, type PolyNodeType } from "../model";
import { store, useDocument } from "../app/store";
import { selectedPathNode, useEditor, type EditorAction } from "../app/editor";
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
