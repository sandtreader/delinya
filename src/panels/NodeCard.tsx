// A small card beside a path's selected node (select tool): its number,
// Cusp / Curve, its drawn x and y, and delete. It floats over the canvas
// next to the node, follows it, and stays inside the drawing area.

import { useLayoutEffect, useRef, useState, type Dispatch } from "react";
import { deletePolyNode, drawnOffset, movePolyNode, setPolyNodeType, snapNumber, type EntityId, type Point, type PolyNodeType } from "../model";
import { store, useDocument } from "../app/store";
import { selectedPathNode, useEditor, type EditorAction } from "../app/editor";
import { toScreen } from "../view/viewport";
import { placeNear } from "../view/placeNear";
import { Num } from "./fields";
import { Icon, IconButton } from "./icons";
import { tip } from "./tip";

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

const TYPES: Array<{ type: PolyNodeType; label: string; tip: string }> = [
  { type: "cusp", label: "Cusp", tip: "Cusp: a sharp corner, straight to straight neighbours" },
  { type: "curve", label: "Curve", tip: "Curve: smooth through the node; drag its handles to shape it" },
];

export function NodeCard() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const sel = selectedPathNode(store.resolved, editor);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const at = sel ? toScreen(editor.view, sel.node.point) : null;

  // Beside the node, inside the drawing area: measured after each render, before paint.
  useLayoutEffect(() => {
    const el = ref.current, area = el?.offsetParent;
    if (!el || !(area instanceof HTMLElement) || !at) return;
    const p = placeNear(at, [el.offsetWidth, el.offsetHeight], [area.clientWidth, area.clientHeight]);
    setPlace((old) => (old && old.left === p.left && old.top === p.top ? old : p));
  });

  if (!sel || !at) return null;
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
  const name = `Node ${position + 1} of ${shape.nodes.length}`;

  return (
    <div
      ref={ref} className="node-card" role="group" aria-label={name}
      style={place ? { left: place.left, top: place.top } : { left: at[0] + 16, top: at[1] + 16 }}
      // Not a press on the canvas below.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="node-card-number" {...tip(name)}>{position + 1}</span>
      <div className="node-type" role="group" aria-label="Node type">
        {TYPES.map((t) => (
          <button
            key={t.type} type="button" className={node.type === t.type ? "on" : ""} aria-pressed={node.type === t.type}
            {...tip(t.tip, t.label)} onClick={() => setType(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label className="node-xy"><span className="hint">x</span><Num value={node.point[0]} onCommit={(v) => move(0, v)} /></label>
      <label className="node-xy"><span className="hint">y</span><Num value={node.point[1]} onCommit={(v) => move(1, v)} /></label>
      <IconButton label="Delete node" tip="Delete node (Del)" className="icon danger" onClick={() => deleteNode(id, index, dispatch)}>
        <Icon size={16}><path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M3.8 4.5l.8 9h6.8l.8-9M6.6 7v4.5M9.4 7v4.5" /></Icon>
      </IconButton>
    </div>
  );
}
