// Exact values for one selected shape, in the floating panel. Typing into a
// linked field edits the shared variable; the panel says so and offers to
// unlink. A text box's text is typed here too, live on the canvas.

import {
  KINDS, derivedAxes, entitiesOfKind, entityAs, isRef, lengthValue, propsChanged,
  setCornerRadius, setLength, setPolyClosed, setRotation, setTextSize, setTextStyle, setTextWidth, unlinkAlign, unlinkLength, unlinkSpacing,
  type EntityId, type FontFamily, type Length, type ResolvedRect, type ResolvedText, type TextAlign, type TextStyle,
} from "../model";
import type { Change } from "@sandtreader/collab/protocol";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { useLiveText } from "../app/liveText";
import { ALIGN_LABELS } from "../view/linkButtons";
import { formatMm } from "../view/format";
import { Num, Row } from "./fields";
import { IconButton, TextAlignIcon } from "./icons";
import { LayerSelect, hasLayerChoice } from "./LayerSelect";
import { tip } from "./tip";

export function ShapeFields({ id }: { id: EntityId }) {
  const state = useDocument();
  const e = state.entities[id]!;
  const p = e.props as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const commit = (props: Record<string, number>) => store.commit(propsChanged(id, props));
  const derived = derivedAxes(store.resolved, id);
  /** Position fields show where the shape is; a link's derived value wins over the stored one. */
  const at = (k: "x" | "y" | "cx" | "cy") => {
    const i = k.endsWith("x") ? 0 : 1;
    const s = store.resolved.shapes[id];
    if (!s || !derived.has(i === 0 ? "x" : "y")) return num(k);
    if (s.kind === "rect" || s.kind === "text") return i === 0 ? s.x : s.y;
    if (s.kind === "circle") return s.centre[i];
    if (s.kind === "line") return s.from[i];
    return num(k);
  };

  return (
    <section>
      <h2>{kindLabel(e.kind)} <small>{id}</small></h2>
      {hasLayerChoice() && <Row label="layer"><LayerSelect ids={[id]} /></Row>}
      {e.kind === KINDS.rect && (
        <>
          <Row label="x"><Num value={at("x")} onCommit={(v) => commit({ x: v })} disabled={derived.has("x")} /></Row>
          <Row label="y"><Num value={at("y")} onCommit={(v) => commit({ y: v })} disabled={derived.has("y")} /></Row>
          <LengthRow id={id} prop="width" label="width" />
          <LengthRow id={id} prop="height" label="height" />
          <Row label="rotation">
            <Num
              value={(store.resolved.shapes[id] as ResolvedRect | undefined)?.rotation ?? 0} unit="°"
              onCommit={(v) => { const c = setRotation(store.state, id, v); if (c) store.commit(c); }}
            />
          </Row>
          <Corners id={id} />
        </>
      )}
      {e.kind === KINDS.circle && (
        <>
          <Row label="cx"><Num value={at("cx")} onCommit={(v) => commit({ cx: v })} disabled={derived.has("x")} /></Row>
          <Row label="cy"><Num value={at("cy")} onCommit={(v) => commit({ cy: v })} disabled={derived.has("y")} /></Row>
          <LengthRow id={id} prop="diameter" label="diameter" />
        </>
      )}
      {e.kind === KINDS.line && (
        <>
          <Row label="x"><Num value={at("x")} onCommit={(v) => commit({ x: v })} disabled={derived.has("x")} /></Row>
          <Row label="y"><Num value={at("y")} onCommit={(v) => commit({ y: v })} disabled={derived.has("y")} /></Row>
          <LengthRow id={id} prop="length" label="length" />
          <Row label="angle"><Num value={num("angle")} onCommit={(v) => commit({ angle: v })} unit="°" /></Row>
        </>
      )}
      {e.kind === KINDS.polyline && <PathFields id={id} />}
      {e.kind === KINDS.text && (
        <>
          <TextFields id={id} />
          <Row label="x"><Num value={at("x")} onCommit={(v) => commit({ x: v })} disabled={derived.has("x")} /></Row>
          <Row label="y"><Num value={at("y")} onCommit={(v) => commit({ y: v })} disabled={derived.has("y")} /></Row>
          {/* Never narrower than the longest word, keeping the font size. */}
          <LengthRow id={id} prop="width" label="width" set={(v) => setTextWidth(store.state, id, v)} />
          <LengthRow id={id} prop="height" label="height" />
          <Row label="rotation">
            <Num
              value={(store.resolved.shapes[id] as ResolvedText | undefined)?.rotation ?? 0} unit="°"
              onCommit={(v) => { const c = setRotation(store.state, id, v); if (c) store.commit(c); }}
            />
          </Row>
          <label className="row check" {...tip("Reads backwards: as flipping it horizontally does, but in place")}>
            <span className="label">mirrored</span>
            <input
              type="checkbox" checked={(store.resolved.shapes[id] as ResolvedText | undefined)?.mirror ?? false}
              onChange={(ev) => store.commit(propsChanged(id, { mirror: ev.target.checked }))}
            />
          </label>
        </>
      )}
      {derived.size > 0 && <p className="hint">Position along {[...derived].sort().join(" and ")} is set by a link.</p>}
      <SpacingMembership id={id} />
      <AlignMembership id={id} />
    </section>
  );
}

/** A path: how many nodes, open or closed. Its shape is edited on the canvas, node by node. */
function PathFields({ id }: { id: EntityId }) {
  useDocument();
  const { editor } = useEditor();
  const s = store.resolved.shapes[id];
  if (s?.kind !== "polyline") return null;
  const n = s.nodes.length;
  return (
    <>
      <Row label="nodes"><span>{n}</span></Row>
      <label className="row check" {...tip(n < 3 ? "A closed path needs at least 3 nodes" : "Join the last node back to the first")}>
        <span className="label">closed</span>
        <input
          type="checkbox" checked={s.closed} disabled={n < 3}
          onChange={(ev) => { const c = setPolyClosed(store.state, id, ev.target.checked); if (c) store.commit(c); }}
        />
      </label>
      {editor.tool === "select" && <p className="hint">Drag a node to move it (Alt-drag a corner to pull out a handle); click a node or a segment to edit it; double-click the path to add a node.</p>}
    </>
  );
}

const FAMILIES: Array<{ family: FontFamily; label: string; hint: string }> = [
  { family: "sans", label: "Sans", hint: "Sans serif: Helvetica, or Arial" },
  { family: "serif", label: "Serif", hint: "Serif: Times" },
  { family: "mono", label: "Mono", hint: "Monospaced: Courier" },
];

const ALIGNS: Array<{ align: TextAlign; label: string; hint: string }> = [
  { align: "left", label: "Left", hint: "Align left: each line starts at the box's left side" },
  { align: "centre", label: "Centre", hint: "Centre: each line centred across the box" },
  { align: "right", label: "Right", hint: "Align right: each line ends at the box's right side" },
];

/**
 * A text box's text, font, size, bold, italic and alignment. Its size is
 * what fits the box, so setting it, or changing the text or style, sets the
 * height.
 */
function TextFields({ id }: { id: EntityId }) {
  useDocument();
  const s = store.resolved.shapes[id];
  if (s?.kind !== "text") return null;
  const style = (st: TextStyle) => { const c = setTextStyle(store.state, id, st); if (c) store.commit(c); };
  return (
    <>
      <label className="row stacked">
        <span className="label">text</span>
        <TextArea key={id} id={id} text={s.text} />
      </label>
      <div className="row" role="group" aria-label="Font">
        <span className="label" aria-hidden="true">font</span>
        <span className="icon-toggle">
          {FAMILIES.map((f) => (
            <button key={f.family} className={s.font.family === f.family ? "on" : ""} aria-pressed={s.font.family === f.family} onClick={() => style({ font: f.family })} {...tip(f.hint, f.label)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>
      <Row label="size">
        <Num
          value={Math.round(s.size * 100) / 100} valid={(v) => v > 0}
          onCommit={(v) => { const c = setTextSize(store.state, id, v); if (c) store.commit(c); }}
        />
      </Row>
      <div className="row" role="group" aria-label="Style">
        <span className="label" aria-hidden="true">style</span>
        <span className="icon-toggle text-style">
          <button className={s.font.bold ? "on" : ""} aria-pressed={s.font.bold} onClick={() => style({ bold: !s.font.bold })} {...tip("Bold", "Bold")} aria-label="Bold">
            <b>B</b>
          </button>
          <button className={s.font.italic ? "on" : ""} aria-pressed={s.font.italic} onClick={() => style({ italic: !s.font.italic })} {...tip("Italic", "Italic")} aria-label="Italic">
            <i>I</i>
          </button>
        </span>
      </div>
      <div className="row" role="group" aria-label="Align">
        <span className="label" aria-hidden="true">align</span>
        <span className="icon-toggle">
          {ALIGNS.map((a) => (
            <IconButton
              key={a.align} label={a.label} tip={a.hint} className={s.align === a.align ? "icon on" : "icon"}
              aria-pressed={s.align === a.align} onClick={() => style({ align: a.align })}
            >
              <TextAlignIcon align={a.align} />
            </IconButton>
          ))}
        </span>
      </div>
    </>
  );
}

/**
 * A text box's text, committed as you type so the canvas follows: the first
 * change opens a gesture and leaving the field closes it, so the whole edit
 * is one undo step (useLiveText, shared with the field on the drawing).
 * Escape puts back the text it had when you came in.
 */
function TextArea({ id, text }: { id: EntityId; text: string }) {
  const live = useLiveText(id);
  return (
    <textarea
      className="text" rows={3} value={text} spellCheck={false}
      onFocus={live.start}
      onChange={(ev) => live.change(ev.target.value)}
      onBlur={live.end}
      onKeyDown={(ev) => {
        if (ev.key !== "Escape") return;
        live.revert();
        ev.currentTarget.blur();
      }}
    />
  );
}

/** A length field; `set` builds the change in place of plain setLength. */
function LengthRow({ id, prop, label, set }: { id: EntityId; prop: string; label: string; set?: (v: number) => Change | undefined }) {
  const state = useDocument();
  const raw = state.entities[id]!.props[prop] as Length;
  const value = lengthValue(state, raw) ?? 0;
  const linked = isRef(raw) ? entityAs(state, raw.ref, KINDS.variable) : undefined;
  return (
    <Row label={label}>
      <Num value={value} onCommit={(v) => { const c = set ? set(v) : setLength(state, id, prop, v); if (c) store.commit(c); }} />
      {isRef(raw) && (
        <span className="linked" {...tip(`Linked to variable ${raw.ref}`)}>
          = {linked?.name ?? raw.ref}
          <button className="small" onClick={() => { const c = unlinkLength(store.state, id, prop); if (c) store.commit(c); }}>unlink</button>
        </span>
      )}
    </Row>
  );
}

function Corners({ id }: { id: EntityId }) {
  const state = useDocument();
  const rect = entityAs(state, id, KINDS.rect)!;
  const r = rect.r ?? [0, 0, 0, 0];
  const resolved = store.resolved.shapes[id] as ResolvedRect | undefined;
  const names = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;
  return (
    <fieldset>
      <legend>corner radii</legend>
      {names.map((name, i) => {
        const corner = i as 0 | 1 | 2 | 3;
        const raw = r[corner]!;
        const value = lengthValue(state, raw) ?? 0;
        const effective = resolved?.r[corner];
        return (
          <Row key={name} label={name}>
            <Num value={value} onCommit={(v) => { const c = setCornerRadius(store.state, id, corner, v); if (c) store.commit(c); }} />
            {isRef(raw) && <span className="linked">= {entityAs(state, raw.ref, KINDS.variable)?.name ?? raw.ref}</span>}
            {effective !== undefined && effective !== value && <span className="warn" {...tip("Clamped to fit")}>→ {formatMm(effective)}</span>}
          </Row>
        );
      })}
    </fieldset>
  );
}

function SpacingMembership({ id }: { id: EntityId }) {
  const state = useDocument();
  const links = Object.entries(state.entities).filter(([, e]) => e.kind === KINDS.spacing && ((e.props.items as string[]).includes(id) || e.props.anchorA === id || e.props.anchorB === id));
  if (links.length === 0) return null;
  return (
    <fieldset>
      <legend>equal spacing</legend>
      {links.map(([lid, e]) => (
        <Row key={lid} label={`${e.props.axis as string} · ${e.props.mode as string}`}>
          <span className="hint">{(e.props.items as string[]).length} items</span>
          <button className="small" onClick={() => { const c = unlinkSpacing(store.state, lid); if (c) store.commit(c); }}>remove</button>
        </Row>
      ))}
    </fieldset>
  );
}

function AlignMembership({ id }: { id: EntityId }) {
  const state = useDocument();
  const links = entitiesOfKind(state, KINDS.align).filter(([, l]) => l.anchor === id || (Array.isArray(l.items) && l.items.includes(id)));
  if (links.length === 0) return null;
  return (
    <fieldset>
      <legend>aligned</legend>
      {links.map(([lid, l]) => (
        <Row key={lid} label={ALIGN_LABELS[l.axis]?.[l.mode] ?? "aligned"}>
          <span className="hint">{l.anchor === id ? `reference for ${l.items.length}` : `to ${kindLabel(state.entities[l.anchor]?.kind ?? "")}`}</span>
          <button className="small" onClick={() => { const c = unlinkAlign(store.state, lid); if (c) store.commit(c); }}>remove</button>
        </Row>
      ))}
    </fieldset>
  );
}

export function kindLabel(kind: string): string {
  return { rect: "Rectangle", circle: "Circle", line: "Line", polyline: "Path", text: "Text" }[kind] ?? kind;
}
