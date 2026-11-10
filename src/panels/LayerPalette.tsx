// Floating layer palette: a numbered button per layer, 1 (the back) at the
// top. Clicking one makes it the current layer (new shapes go there) and
// opens its card: name, hide/show, lock/unlock and delete. Dragging a
// button reorders, and the numbers follow. "+" adds a layer in front.
// Hiding and locking are this viewer's own choice (editor state), not edits.

import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import type { Change } from "@sandtreader/collab/protocol";
import { addLayer, deleteLayer, moveLayer, newId, setLayerName, type EntityId, type ResolvedLayer } from "../model";
import { store, useDocument } from "../app/store";
import { currentLayer, useEditor } from "../app/editor";
import { ask, currentQuestion } from "../app/ask";
import type { Point } from "../app/floatPosition";
import { dropIndex } from "../view/reorder";
import { Grip, useFloating } from "./floating";
import { Text } from "./fields";
import { Icon } from "./icons";
import { tip } from "./tip";

const STORAGE_KEY = "delinya.layerPalette";
// Just below the tool palette at its home (10, 10), which is 157 px tall.
const HOME: Point = { x: 10, y: 177 };
/** Movement before a press on a layer button becomes a drag rather than a click. */
const DRAG_PX = 4;
/** Room the card needs to the right of the palette before it flips to the left. */
const CARD_ROOM = 290;

interface Drag { id: EntityId; from: number; startY: number; centres: number[]; active: boolean }

export function LayerPalette() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const { ref, style, grip, shown, bounds } = useFloating(STORAGE_KEY, HOME);
  const { layers } = store.resolved;
  const { hidden, locked } = editor.layerView;
  const current = currentLayer(store.resolved, editor.layer);
  const [open, setOpen] = useState<EntityId | null>(null);
  const openLayer = layers.find((l) => l.id === open);
  const drag = useRef<Drag | null>(null);
  const [dragged, setDragged] = useState<{ from: number; dy: number; to: number; pitch: number } | null>(null);
  const suppressClick = useRef(false);

  const close = () => {
    // Fields commit on blur, so blur before the card unmounts.
    const active = document.activeElement as HTMLElement | null;
    if (active && ref.current?.querySelector(".layer-card")?.contains(active)) active.blur();
    setOpen(null);
  };

  // The layer went away (deleted, undone, a peer): so does its card.
  useEffect(() => { if (open && !openLayer) setOpen(null); }, [open, openLayer]);

  // Click outside or Escape closes the card. Escape closes only the card:
  // it stops there, so the selection and tool survive.
  useEffect(() => {
    if (!open) return;
    // Not while a question is up: answering it is a click outside too.
    const onDown = (e: PointerEvent) => { if (!currentQuestion() && !ref.current?.contains(e.target as Node)) close(); };
    // Keys from inside the palette go through onKeyDown, after any field has had them.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ref.current?.contains(e.target as Node)) { e.stopPropagation(); close(); }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  // A field with an edit takes Escape first, to revert it.
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
  };

  const choose = (id: EntityId) => {
    dispatch({ type: "layer", id });
    if (open === id) close(); else setOpen(id);
  };

  const add = () => {
    const id = newId("layer");
    store.commit(addLayer(store.state, id));
    dispatch({ type: "layer", id });
    close();
  };

  // ---- Drag to reorder ----

  const onButtonDown = (e: RPointerEvent<HTMLButtonElement>, id: EntityId, from: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const buttons = ref.current?.querySelectorAll<HTMLElement>("[data-layer-button]") ?? [];
    const centres = [...buttons].map((b) => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; });
    drag.current = { id, from, startY: e.clientY, centres, active: false };
  };
  const onButtonMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.active && Math.abs(dy) < DRAG_PX) return;
    if (!d.active) { d.active = true; close(); }
    const pitch = d.centres.length > 1 ? d.centres[1]! - d.centres[0]! : 0;
    setDragged({ from: d.from, dy, to: dropIndex(d.centres, d.from, d.centres[d.from]! + dy), pitch });
  };
  const onButtonUp = (e: RPointerEvent<HTMLButtonElement>, commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    setDragged(null);
    // The click that follows the release is part of the drag, not a choice.
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    if (!commit) return;
    const to = dropIndex(d.centres, d.from, d.centres[d.from]! + e.clientY - d.startY);
    const c = moveLayer(store.state, d.id, to);
    if (!c) return;
    // Pin the current layer: left unset it means "the first", which moves.
    if (editor.layer !== current) dispatch({ type: "layer", id: current });
    store.commit(c);
  };

  /** While dragging: the dragged button follows the pointer and the others make room. */
  const shift = (i: number): number => {
    if (!dragged) return 0;
    if (i === dragged.from) return dragged.dy;
    const k = i < dragged.from ? i : i - 1;   // index among the others
    const after = k >= dragged.to ? k + 1 : k;
    return (after - i) * dragged.pitch;
  };

  const flip = !!bounds && shown.x + bounds.size.w + CARD_ROOM > bounds.area.w;

  return (
    <div
      ref={ref}
      className={`palette layer-palette${dragged ? " dragging" : ""}`}
      role="toolbar"
      aria-label="Layers"
      aria-orientation="vertical"
      style={style}
      // The canvas underneath would deselect or start drawing.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <Grip {...grip} />
      {layers.map((l, i) => {
        const name = layerName(l);
        const isHidden = hidden.has(l.id), isLocked = locked.has(l.id);
        const state = [isHidden && "hidden", isLocked && "locked"].filter(Boolean).join(", ");
        const offset = shift(i);
        return (
          <div
            key={l.id}
            className={`layer-item${dragged?.from === i ? " lifted" : ""}`}
            style={offset ? { transform: `translateY(${offset}px)` } : undefined}
          >
            <button
              data-layer-button
              className={`layer-button${l.id === current ? " active" : ""}${isHidden ? " is-hidden" : ""}`}
              aria-label={`Layer ${l.number}${l.name ? `: ${l.name}` : ""}${state ? ` (${state})` : ""}`}
              aria-pressed={l.id === current}
              aria-expanded={open === l.id}
              // Not while its card is open: the card says it all.
              data-tip={open === l.id ? undefined : `${name}${state ? ` · ${state}` : ""}`}
              data-tip-side="right"
              onPointerDown={(e) => onButtonDown(e, l.id, i)}
              onPointerMove={onButtonMove}
              onPointerUp={(e) => onButtonUp(e, true)}
              onPointerCancel={(e) => onButtonUp(e, false)}
              onClick={() => { if (!suppressClick.current) choose(l.id); }}
            >
              <span className="layer-number">{l.number}</span>
              {isHidden && <Icon className="mark mark-hidden" size={9}><EyeOff /></Icon>}
              {isLocked && <Icon className="mark mark-locked" size={9}><LockShape /></Icon>}
            </button>
            {open === l.id && <LayerCard layer={l} only={layers.length === 1} flip={flip} onDeleted={() => setOpen(null)} />}
          </div>
        );
      })}
      <button className="layer-add" {...tip("Add a layer in front", "Add a layer")} data-tip-side="right" aria-label="Add a layer" onClick={add}>
        <Icon size={18}><path d="M9 4v10M4 9h10" /></Icon>
      </button>
    </div>
  );
}

function layerName(l: ResolvedLayer): string {
  return l.name || `Layer ${l.number}`;
}

function LayerCard({ layer, only, flip, onDeleted }: { layer: ResolvedLayer; only: boolean; flip: boolean; onDeleted: () => void }) {
  const { editor, dispatch } = useEditor();
  const hidden = editor.layerView.hidden.has(layer.id), locked = editor.layerView.locked.has(layer.id);
  const commit = (c: Change | undefined) => { if (c) store.commit(c); };
  const remove = async () => {
    const r = store.resolved;
    const count = r.order.filter((id) => r.shapes[id]!.layer === layer.id).length;
    const what = `layer ${layer.number}${layer.name ? ` "${layer.name}"` : ""}`;
    const message = `Delete ${what} and the ${count} shape${count === 1 ? "" : "s"} on it?`;
    if (count > 0 && !(await ask({ title: "Delete layer", message, confirm: "Delete", danger: true }))) return;
    // A peer may have deleted it meanwhile: deleteLayer then gives no change.
    commit(deleteLayer(store.state, layer.id));
    onDeleted();
  };
  const hideTitle = hidden ? "Show layer" : "Hide layer";
  const lockTitle = locked ? "Unlock layer" : "Lock layer (still visible and snapped to, but not selectable)";
  const deleteTitle = only ? "The only layer can't be deleted" : "Delete layer and its shapes";
  return (
    <div className={`layer-card${flip ? " flip" : ""}`} role="group" aria-label={`Layer ${layer.number}`}>
      <span className="layer-card-number">{layer.number}</span>
      <Text value={layer.name} placeholder={`Layer ${layer.number}`} onCommit={(name) => commit(setLayerName(store.state, layer.id, name))} />
      <button
        className={`icon${hidden ? " on" : ""}`} data-tip={hideTitle} aria-label={hideTitle} aria-pressed={hidden}
        onClick={() => dispatch({ type: "toggleLayer", id: layer.id, flag: "hidden" })}
      >
        <Icon size={16}>{hidden ? <EyeOff /> : <Eye />}</Icon>
      </button>
      <button
        className={`icon${locked ? " on" : ""}`} data-tip={lockTitle} aria-label={lockTitle} aria-pressed={locked}
        onClick={() => dispatch({ type: "toggleLayer", id: layer.id, flag: "locked" })}
      >
        <Icon size={16}>{locked ? <LockShape /> : <UnlockShape />}</Icon>
      </button>
      <button className="icon danger" data-tip={deleteTitle} aria-label={deleteTitle} disabled={only} onClick={remove}>
        <Icon size={16}><path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M3.8 4.5l.8 9h6.8l.8-9M6.6 7v4.5M9.4 7v4.5" /></Icon>
      </button>
    </div>
  );
}

// ---- Icons (see icons.tsx) ----

function Eye() {
  return <><path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>;
}

function EyeOff() {
  return <><path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><path d="M2.5 13.5 13.5 2.5" /></>;
}

function LockShape() {
  return <><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>;
}

function UnlockShape() {
  return <><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" /></>;
}
