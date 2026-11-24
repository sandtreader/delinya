// Rotate and Duplicate: small cards dropped below their buttons in the top
// bar, acting on the selection. One is open at a time (editor.card); it
// stays open while there is a selection, so you can turn or copy again or
// pick other shapes on the drawing, and closes on Escape, on its button,
// when the selection empties, or on a press anywhere else but the drawing.
// PopCard is the button and card alone, which Collaborate shares.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";
import type { Change } from "@sandtreader/collab/protocol";
import {
  DUPLICATE_DIRECTIONS, duplicateBeside, flipShapes, newId, rotateShapes,
  type Axis, type DuplicateDirection, type EntityId,
} from "../model";
import { store } from "../app/store";
import { useEditor, type ActionCard, type DuplicateSettings } from "../app/editor";
import { currentQuestion } from "../app/ask";
import { formatMm } from "../view/format";
import { Num } from "./fields";
import { ArrowIcon, FlipIcon, IconButton, RotateIcon } from "./icons";
import { tip } from "./tip";

/** Clear space kept between a card and the window's edge, px. */
const EDGE = 8;

/**
 * A toolbar button that opens a card below it, holding `children`; pressed
 * while it is open. The card stays inside the window, and closes on its
 * button, on Escape, and on a press anywhere but the button, the card, the
 * drawing (picking shapes to act on) or a dialog over it (a question, or an
 * MUI dialog the card opened). `className` is the card's.
 */
export function PopCard({ open, onOpen, onClose, label, tip: tipText, icon, disabled, badge, className = "action-card", children }: {
  open: boolean; onOpen: () => void; onClose: () => void; label: string; tip: string; icon: ReactNode;
  disabled?: boolean; badge?: ReactNode; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Left shift that keeps the card inside the window.
  const [shift, setShift] = useState(0);

  const close = () => {
    // Fields commit on blur, so blur before the card goes.
    const active = document.activeElement as HTMLElement | null;
    if (active && cardRef.current?.contains(active)) active.blur();
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Measured as it opens, unshifted (shift is 0 while closed).
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const r = cardRef.current?.getBoundingClientRect();
    if (!r) return;
    const over = r.right - (window.innerWidth - EDGE);
    setShift(over > 0 ? Math.max(0, Math.min(over, r.left - EDGE)) : 0);
  }, [open]);

  // A press outside the button and card closes it, except on the drawing
  // (picking other shapes to act on). Escape from outside closes only the
  // card: it stops there, so the selection and tool survive.
  useEffect(() => {
    if (!open) return;
    const over = (target: EventTarget | null) => {
      const t = target instanceof Element ? target : null;
      return currentQuestion() || ref.current?.contains(t) || t?.closest("svg.canvas, .MuiModal-root");
    };
    const onDown = (e: PointerEvent) => {
      if (!over(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !over(e.target)) { e.stopPropagation(); closeRef.current(); }
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  // Keys from inside the card: a field with an edit takes Escape first, to revert it.
  // (An MUI dialog the card opened is portalled, but its keys still bubble
  // here through React: it handles its own Escape.)
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === "Escape" && !(e.target as Element).closest?.(".MuiModal-root")) { e.stopPropagation(); close(); }
  };

  return (
    <div className="card-anchor" ref={ref}>
      <IconButton
        label={label} tip={tipText} disabled={disabled}
        className={open ? "icon on" : "icon"} aria-pressed={open} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => (open ? close() : onOpen())}
      >
        {icon}
      </IconButton>
      {badge}
      {open && (
        <div
          ref={cardRef} className={`pop-card ${className}`} role="dialog" aria-label={label.replace(/…$/, "")}
          style={shift ? { left: -shift } : undefined} onKeyDown={onKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A card acting on the selection (Rotate, Duplicate): one at a time
 * (editor.card), disabled with no shapes selected.
 */
export function CardButton({ card, label, tip, icon, shapes, children }: {
  card: ActionCard; label: string; tip: string; icon: ReactNode; shapes: EntityId[]; children: ReactNode;
}) {
  const { editor, dispatch } = useEditor();
  return (
    <PopCard
      open={editor.card === card && shapes.length > 0} disabled={shapes.length === 0}
      onOpen={() => dispatch({ type: "card", card })} onClose={() => dispatch({ type: "card", card: null })}
      label={label} tip={tip} icon={icon}
    >
      {children}
    </PopCard>
  );
}

/**
 * Copies the shapes beside themselves, as the Duplicate settings say, with
 * their dimensions and radius labels, as one undo step: the card's button
 * and ⌘D. Returns the copies' IDs, copy by copy, in the same order.
 */
export function duplicateSelection(ids: EntityId[], settings: DuplicateSettings): EntityId[] | undefined {
  const out = duplicateBeside(store.state, ids, settings, newId);
  if (out) store.commit(out.change);
  return out?.ids;
}

/** The angle Rotate turns by: kept while the app is open, not saved. */
let rotateBy = 15;

/**
 * Rotate: turn the selection by a typed angle, or a quarter turn or a flip
 * at a click, each about the centre of the selection's bounds, as one undo
 * step. The angle is the card's own, not saved.
 */
export function RotateCard({ shapes }: { shapes: EntityId[] }) {
  const [by, setByState] = useState(rotateBy);
  const setBy = (v: number) => { rotateBy = v; setByState(v); };
  const commit = (c: Change | undefined) => { if (c) store.commit(c); };
  const turn = (degrees: number) => commit(rotateShapes(store.state, shapes, degrees));
  const flip = (axis: Axis) => commit(flipShapes(store.state, shapes, axis));
  const way = by < 0 ? `${formatMm(-by)}° anticlockwise` : `${formatMm(by)}° clockwise`;
  return (
    <div className="rotate">
      <button onClick={() => turn(by)} {...tip(`Rotate ${way} about the centre`)}>Rotate</button>
      <label className="by" {...tip("Angle to rotate by: clockwise, or anticlockwise if negative")}>
        <span className="hint">by</span>
        <Num value={by} unit="°" onCommit={setBy} />
      </label>
      <div className="icons" role="group" aria-label="Quarter turns and flips">
        <IconButton label="Rotate 90° anticlockwise" onClick={() => turn(-90)}><RotateIcon /></IconButton>
        <IconButton label="Rotate 90° clockwise" onClick={() => turn(90)}><RotateIcon clockwise /></IconButton>
        <IconButton label="Flip horizontally" tip="Flip horizontally: mirror left to right" onClick={() => flip("x")}><FlipIcon axis="x" /></IconButton>
        <IconButton label="Flip vertically" tip="Flip vertically: mirror top to bottom" onClick={() => flip("y")}><FlipIcon axis="y" /></IconButton>
      </div>
    </div>
  );
}

/** Where each direction puts the copy, for tooltips. */
const BESIDE: Record<DuplicateDirection, string> = { right: "to the right", down: "below", left: "to the left", up: "above" };

/** Whole numbers 1–100: how many copies Duplicate makes. */
const validCount = (v: number) => Number.isInteger(v) && v >= 1 && v <= 100;

/**
 * Duplicate: the button, how many copies, which way they go, how far apart
 * and whether they are linked to the original. The copies become the
 * selection, so pressing again carries on the row. ⌘D always makes one
 * unlinked copy, so the button's tooltip says where it differs.
 */
export function DuplicateCard({ shapes }: { shapes: EntityId[] }) {
  const { editor, dispatch } = useEditor();
  const { direction, spacing, count, linkGaps, linkSize, linkAlign } = editor.duplicate;
  const run = () => {
    const copies = duplicateSelection(shapes, editor.duplicate);
    if (copies) dispatch({ type: "select", ids: copies });
  };
  // Gaps need two copies to space anything.
  const links = [...(linkGaps && count >= 2 ? ["gaps"] : []), ...(linkSize ? ["size"] : []), ...(linkAlign ? ["align"] : [])];
  const listed = links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}` : links[0];
  const linked = listed ? `, linked: ${listed}` : "";
  const what = count === 1
    ? `Copy ${BESIDE[direction]}, ${formatMm(spacing)} mm clear${linked}, and select the copy (${linked ? "⌘D makes it unlinked" : "⌘D"})`
    : `Copy ${count} times ${BESIDE[direction]}, ${formatMm(spacing)} mm apart${linked}, and select the copies (⌘D makes one${linked ? ", unlinked" : ""})`;
  return (
    <div className="duplicate">
      <button onClick={run} {...tip(what)}>Duplicate</button>
      <div className="icons" role="group" aria-label="Duplicate direction">
        {DUPLICATE_DIRECTIONS.map((d) => (
          <IconButton
            key={d} label={`Duplicate ${BESIDE[d]}`} className={d === direction ? "icon on" : "icon"} aria-pressed={d === direction}
            onClick={() => dispatch({ type: "duplicate", settings: { direction: d } })}
          >
            <ArrowIcon direction={d} />
          </IconButton>
        ))}
      </div>
      <label className="count" {...tip("Number of copies")}>
        {/* Read as "copies"; × is just the look. */}
        <span className="hint"><span aria-hidden="true">×</span><span className="sr-only">copies</span></span>
        <Num value={count} unit="" valid={validCount} onCommit={(v) => dispatch({ type: "duplicate", settings: { count: v } })} />
      </label>
      <label className="spacing" {...tip("Gap between the selection and its copy, and between copies")}>
        <span className="hint">gap</span>
        <Num value={spacing} valid={(v) => v >= 0} onCommit={(v) => dispatch({ type: "duplicate", settings: { spacing: v } })} />
      </label>
      <div className="links" role="group" aria-label="Link the copies">
        <span className="hint" aria-hidden="true">link</span>
        <label
          className="link-gaps"
          {...tip("Keep the copies equally spaced between the original and the last copy (needs 2 or more copies)")}
        >
          <input
            type="checkbox" checked={linkGaps} disabled={count < 2}
            onChange={(e) => dispatch({ type: "duplicate", settings: { linkGaps: e.target.checked } })}
          />
          <span className="sr-only">link </span>gaps
        </label>
        <label
          className="link-size"
          {...tip("Link the copies' sizes to the original's through shared variables (width and height, diameter for circles, length for lines)")}
        >
          <input type="checkbox" checked={linkSize} onChange={(e) => dispatch({ type: "duplicate", settings: { linkSize: e.target.checked } })} />
          <span className="sr-only">link </span>size
        </label>
        <label
          className="link-align"
          {...tip("Keep the copies lined up with the original: tops for a row across, left edges for a column down")}
        >
          <input type="checkbox" checked={linkAlign} onChange={(e) => dispatch({ type: "duplicate", settings: { linkAlign: e.target.checked } })} />
          <span className="sr-only">link </span>align
        </label>
      </div>
    </div>
  );
}
