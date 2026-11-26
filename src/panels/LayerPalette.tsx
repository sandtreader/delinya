// Floating layer palette: a numbered button per layer, 1 (the back) at the
// top, with a bar in the layer's colour if it has one. Clicking one makes it
// the current layer (new shapes go there) and opens its card: name, look
// (line colour, fill and pattern), hide/show, lock/unlock and delete.
// Dragging a button reorders, and the numbers follow. "+" adds a layer in
// front. The look is part of the drawing (an edit); hiding and locking are
// this viewer's own choice (editor state), not edits.

import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import type { Change } from "@sandtreader/collab/protocol";
import {
  FILL_OPACITY, HATCH_PATTERNS, LAYER_COLOURS, LAYER_FILLS, addLayer, deleteLayer, moveLayer, newId, setLayerColour, setLayerFill, setLayerHatch, setLayerName,
  type Bounds, type EntityId, type HatchPattern, type ResolvedLayer,
} from "../model";
import { hatchMarks } from "../output/hatch";
import { store, useDocument } from "../app/store";
import { currentLayer, useEditor } from "../app/editor";
import { ask, currentQuestion } from "../app/ask";
import type { Point } from "../app/floatPosition";
import { dropIndex } from "../view/reorder";
import { Grip, useFloating } from "./floating";
import { Text } from "./fields";
import { BinIcon, Icon } from "./icons";
import { tip } from "./tip";

const STORAGE_KEY = "delinya.layerPalette";
// Just below the tool palette at its home (10, 10), which is 259 px tall.
const HOME: Point = { x: 10, y: 279 };
/** Movement before a press on a layer button becomes a drag rather than a click. */
const DRAG_PX = 4;
/** Room the card needs to the right of the palette before it flips to the left. */
const CARD_ROOM = 320;

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
              {l.colour && <span className="layer-colour" style={{ background: l.colour }} />}
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
      <LookControl layer={layer} />
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
        <BinIcon />
      </button>
    </div>
  );
}

/** A palette colour's name, or the colour itself if it isn't one (a peer's, a hand-edited file's). */
function colourName(hex: string | null): string {
  return LAYER_COLOURS.find((c) => c.hex === hex)?.name ?? hex!;
}

/** A fill's name, or the colour itself if it isn't one of LAYER_FILLS. */
function fillName(hex: string): string {
  return LAYER_FILLS.find((f) => f.hex === hex)?.name ?? hex;
}

/** What a layer looks like, in words: "Layer look: Navy line, Sky fill, Lines pattern". */
function lookLabel({ colour, fill, hatch }: Pick<ResolvedLayer, "colour" | "fill" | "hatch">): string {
  const pattern = HATCH_PATTERNS.find((p) => p.id === hatch)?.name;
  return `Layer look: ${colourName(colour)} line, ${fill ? `${fillName(fill)} fill` : "no fill"}, ${pattern ? `${pattern} pattern` : "no pattern"}`;
}

/**
 * The layer's look: a button showing it in small (outline in the line
 * colour, filled as its shapes are) that opens a picker of line colour,
 * fill and pattern. A choice takes effect at once and the picker stays, so
 * all three can be set; Escape (only the picker: the card stays) and a press
 * anywhere else close it.
 */
function LookControl({ layer }: { layer: ResolvedLayer }) {
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const commit = (c: Change | undefined) => { if (c) store.commit(c); };

  const stop = (refocus: boolean) => {
    setPicking(false);
    if (refocus) button.current?.focus();
  };

  // Into the picker at the current line colour, so the keyboard can carry on there.
  useEffect(() => {
    if (picking) ref.current?.querySelector<HTMLElement>(".swatch[aria-pressed=true]")?.focus();
  }, [picking]);

  // A press outside the control closes the picker; outside the palette, the card's own handler closes the card too.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => { if (!currentQuestion() && !ref.current?.contains(e.target as Node)) setPicking(false); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [picking]);

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === "Escape" && picking) { e.stopPropagation(); stop(true); }
  };

  const label = lookLabel(layer);
  return (
    <span ref={ref} className="look-control" onKeyDown={onKeyDown}>
      <button
        ref={button} className="icon look-button" aria-label={label} aria-haspopup="true" aria-expanded={picking}
        // Not while the picker is open: it would cover it.
        {...(picking ? {} : tip(label, label))}
        onClick={() => setPicking(!picking)}
      >
        <LookChip colour={layer.colour} fill={layer.fill} hatch={layer.hatch} />
      </button>
      {picking && (
        <span className="look-picker">
          <span className="look-row">
            <span className="look-label" aria-hidden="true">Line colour</span>
            <span className="swatches" role="group" aria-label="Line colour">
              {LAYER_COLOURS.map((c) => (
                <button
                  key={c.name} className="icon swatch" aria-label={c.name} aria-pressed={c.hex === layer.colour}
                  {...tip(c.name, c.name)} data-tip-side="above"
                  onClick={() => commit(setLayerColour(store.state, layer.id, c.hex))}
                >
                  <Swatch colour={c.hex} />
                </button>
              ))}
            </span>
          </span>
          <FillPicker
            fill={layer.fill} hatch={layer.hatch} ink={layer.colour}
            onFill={(hex) => commit(setLayerFill(store.state, layer.id, hex))}
            onHatch={(h) => commit(setLayerHatch(store.state, layer.id, h))}
          />
        </span>
      )}
    </span>
  );
}

/** A small square of a layer colour; the default ink for null. */
function Swatch({ colour }: { colour: string | null }) {
  return <span className={`swatch-chip${colour ? "" : " default"}`} style={colour ? { background: colour } : undefined} />;
}

/**
 * The fill and pattern rows of the layer's look picker: the fills as they
 * look on paper, and the patterns drawn small in the layer's `ink` (null:
 * the default), each with none first.
 */
export function FillPicker({ fill, hatch, ink = null, onFill, onHatch }: {
  fill: string | null; hatch: HatchPattern | null; ink?: string | null; onFill: (hex: string | null) => void; onHatch: (h: HatchPattern | null) => void;
}) {
  const patterns = [{ id: null, name: "None" }, ...HATCH_PATTERNS];
  return (
    <>
      <span className="look-row">
        <span className="look-label" aria-hidden="true">Fill</span>
        <span className="swatches" role="group" aria-label="Fill">
          {LAYER_FILLS.map((f) => (
            <button
              key={f.name} className="icon swatch" aria-label={f.name} aria-pressed={f.hex === fill}
              {...tip(f.name, f.name)} data-tip-side="below" onClick={() => onFill(f.hex)}
            >
              <span className={`swatch-chip${f.hex ? "" : " none"}`} style={f.hex ? { background: onPaper(f.hex) } : undefined} />
            </button>
          ))}
        </span>
      </span>
      <span className="look-row">
        <span className="look-label" aria-hidden="true">Pattern</span>
        <span className="swatches" role="group" aria-label="Pattern">
          {patterns.map((p) => (
            <button
              key={p.name} className="icon swatch" aria-label={p.name} aria-pressed={p.id === hatch}
              {...tip(p.name, p.name)} data-tip-side="below" onClick={() => onHatch(p.id)}
            >
              {p.id ? <PatternChip pattern={p.id} ink={ink} /> : <span className="swatch-chip none" />}
            </button>
          ))}
        </span>
      </span>
    </>
  );
}

/** A fill colour as it shows on white paper, drawn at FILL_OPACITY: "rgb(…)". */
function onPaper(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * FILL_OPACITY + 255 * (1 - FILL_OPACITY)));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Chip size, px, and a pattern's spacing in it. */
const CHIP = 16, CHIP_SPACING = 4;

/** A pattern's marks over `bounds`, in chip px: lines and dots in `ink` (the default for null). */
function PatternMarks({ pattern, ink, bounds, opacity }: { pattern: HatchPattern; ink: string | null; bounds: Bounds; opacity: number }) {
  const { lines, dots } = hatchMarks(bounds, pattern, CHIP_SPACING);
  const paint = ink ?? "var(--shape)";
  return (
    <g opacity={opacity}>
      {lines.length > 0 && <path d={lines.map(([p, q]) => `M${p[0]} ${p[1]}L${q[0]} ${q[1]}`).join("")} style={{ stroke: paint }} strokeWidth={1} fill="none" />}
      {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.9} style={{ fill: paint }} />)}
    </g>
  );
}

/** A pattern swatch: its marks small, on paper. */
function PatternChip({ pattern, ink }: { pattern: HatchPattern; ink: string | null }) {
  return (
    <svg className="swatch-chip pattern" width={CHIP} height={CHIP} viewBox={`0 0 ${CHIP} ${CHIP}`} aria-hidden="true">
      <PatternMarks pattern={pattern} ink={ink} bounds={{ minX: 1, minY: 1, maxX: CHIP - 1, maxY: CHIP - 1 }} opacity={0.8} />
    </svg>
  );
}

/** The layer's look in small: a square outlined in its line colour, filled with its fill and pattern. */
function LookChip({ colour, fill, hatch }: Pick<ResolvedLayer, "colour" | "fill" | "hatch">) {
  const inner = { minX: 2, minY: 2, maxX: CHIP - 2, maxY: CHIP - 2 };
  return (
    <svg className="look-chip" width={CHIP} height={CHIP} viewBox={`0 0 ${CHIP} ${CHIP}`} aria-hidden="true">
      <rect x={1} y={1} width={CHIP - 2} height={CHIP - 2} rx={2} fill={fill ? onPaper(fill) : "#fff"} />
      {hatch && <PatternMarks pattern={hatch} ink={colour} bounds={inner} opacity={0.6} />}
      <rect x={1} y={1} width={CHIP - 2} height={CHIP - 2} rx={2} fill="none" strokeWidth={2} style={{ stroke: colour ?? "var(--shape)" }} />
    </svg>
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
