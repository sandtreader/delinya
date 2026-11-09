// Exact values for the selection. Typing into a linked field edits the
// shared variable; the panel says so and offers to unlink.

import { useEffect, useState } from "react";
import { applyChange } from "@sandtreader/collab/protocol";
import {
  KINDS, batch, deleteEntity, entityAs, isRef, lengthValue, linkLengths, linkSpacing, newId, propsChanged,
  setCornerRadius, setDocumentProps, setLength, unlinkLength, unlinkSpacing,
  type Axis, type DocumentField, type EntityId, type Length, type ResolvedRect, type SpacingMode,
} from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { useFileName } from "../app/file";
import { formatMm } from "../canvas/Canvas";

export function Inspector() {
  const state = useDocument();
  const { editor } = useEditor();
  const ids = editor.selection.filter((id) => state.entities[id]);
  if (ids.length === 0) {
    return <aside className="inspector"><p className="hint">Select a shape, or draw one.</p><Properties /><Variables /></aside>;
  }
  if (ids.length === 1) return <aside className="inspector"><Single id={ids[0]!} /><Variables /></aside>;
  return <aside className="inspector"><Multi ids={ids} /><Variables /></aside>;
}

// ---- One shape ----

function Single({ id }: { id: EntityId }) {
  const state = useDocument();
  const e = state.entities[id]!;
  const p = e.props as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const commit = (props: Record<string, number>) => store.commit(propsChanged(id, props));
  const spacing = spacingsHolding(id);

  return (
    <section>
      <h2>{kindLabel(e.kind)} <small>{id}</small></h2>
      {e.kind === KINDS.rect && (
        <>
          <Row label="x"><Num value={num("x")} onCommit={(v) => commit({ x: v })} disabled={spacing.has("x")} /></Row>
          <Row label="y"><Num value={num("y")} onCommit={(v) => commit({ y: v })} disabled={spacing.has("y")} /></Row>
          <LengthRow id={id} prop="width" label="width" />
          <LengthRow id={id} prop="height" label="height" />
          <Corners id={id} />
        </>
      )}
      {e.kind === KINDS.circle && (
        <>
          <Row label="cx"><Num value={num("cx")} onCommit={(v) => commit({ cx: v })} disabled={spacing.has("x")} /></Row>
          <Row label="cy"><Num value={num("cy")} onCommit={(v) => commit({ cy: v })} disabled={spacing.has("y")} /></Row>
          <LengthRow id={id} prop="diameter" label="diameter" />
        </>
      )}
      {e.kind === KINDS.line && (
        <>
          <Row label="x"><Num value={num("x")} onCommit={(v) => commit({ x: v })} disabled={spacing.has("x")} /></Row>
          <Row label="y"><Num value={num("y")} onCommit={(v) => commit({ y: v })} disabled={spacing.has("y")} /></Row>
          <LengthRow id={id} prop="length" label="length" />
          <Row label="angle"><Num value={num("angle")} onCommit={(v) => commit({ angle: v })} unit="°" /></Row>
        </>
      )}
      {spacing.size > 0 && <p className="hint">Position along {[...spacing].join("/")} is set by an equal-spacing link.</p>}
      <SpacingMembership id={id} />
    </section>
  );
}

function LengthRow({ id, prop, label }: { id: EntityId; prop: string; label: string }) {
  const state = useDocument();
  const raw = state.entities[id]!.props[prop] as Length;
  const value = lengthValue(state, raw) ?? 0;
  const linked = isRef(raw) ? entityAs(state, raw.ref, KINDS.variable) : undefined;
  return (
    <Row label={label}>
      <Num value={value} onCommit={(v) => { const c = setLength(state, id, prop, v); if (c) store.commit(c); }} />
      {isRef(raw) && (
        <span className="linked" title={`Linked to variable ${raw.ref}`}>
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
            {effective !== undefined && effective !== value && <span className="warn" title="Clamped to fit">→ {formatMm(effective)}</span>}
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

/** Axes along which this shape's position is derived by a spacing link. */
function spacingsHolding(id: EntityId): Set<Axis> {
  const out = new Set<Axis>();
  for (const sp of store.resolved.spacings) {
    if (sp.active && sp.positions[id] !== undefined) out.add(sp.axis);
  }
  return out;
}

// ---- Several shapes ----

function Multi({ ids }: { ids: EntityId[] }) {
  const state = useDocument();
  const kinds = new Set(ids.map((id) => state.entities[id]!.kind));
  const shapes = ids.filter((id) => [KINDS.rect, KINDS.circle, KINDS.line].includes(state.entities[id]!.kind as never));

  const linkable: Array<{ prop: string; label: string }> = [];
  if (kinds.size === 1) {
    const [kind] = kinds;
    if (kind === KINDS.rect) linkable.push({ prop: "width", label: "Link widths" }, { prop: "height", label: "Link heights" });
    if (kind === KINDS.circle) linkable.push({ prop: "diameter", label: "Link diameters" });
    if (kind === KINDS.line) linkable.push({ prop: "length", label: "Link lengths" });
  }

  const link = (prop: string) => {
    const name = window.prompt("Variable name", prop) ?? undefined;
    const c = linkLengths(store.state, ids.map((id) => ({ id, prop })), newId("var"), name || undefined);
    if (c) store.commit(c);
  };

  const space = (axis: Axis, mode: SpacingMode) => {
    // The two outermost shapes along the axis are the anchors; the rest are spaced between them.
    const r = store.resolved;
    const sorted = [...shapes].sort((a, b) => (axis === "x" ? r.shapes[a]!.bounds.minX - r.shapes[b]!.bounds.minX : r.shapes[a]!.bounds.minY - r.shapes[b]!.bounds.minY));
    const anchorA = sorted[0]!, anchorB = sorted[sorted.length - 1]!;
    const items = sorted.slice(1, -1);
    store.commit(linkSpacing(newId("spacing"), anchorA, anchorB, items, axis, mode));
  };

  return (
    <section>
      <h2>{ids.length} selected</h2>
      {linkable.length > 0 && (
        <fieldset>
          <legend>equal values</legend>
          {linkable.map((l) => <button key={l.prop} onClick={() => link(l.prop)}>{l.label}</button>)}
        </fieldset>
      )}
      {shapes.length >= 3 && (
        <fieldset>
          <legend>equal spacing (outer two are the anchors)</legend>
          <button onClick={() => space("x", "gaps")}>Gaps along x</button>
          <button onClick={() => space("y", "gaps")}>Gaps along y</button>
          <button onClick={() => space("x", "centres")}>Centres along x</button>
          <button onClick={() => space("y", "centres")}>Centres along y</button>
        </fieldset>
      )}
      <button className="danger" onClick={() => deleteSelection(ids)}>Delete</button>
    </section>
  );
}

export function deleteSelection(ids: EntityId[]) {
  const changes = [];
  let state = store.state;
  for (const id of ids) {
    const c = deleteEntity(state, id);
    if (c) { changes.push(c); state = applyChange(state, c); }
  }
  if (changes.length === 1) store.commit(changes[0]!);
  else if (changes.length > 1) store.commit(batch(changes));
}

// ---- Document properties ----

/** Shown with nothing selected; printed in the title block. */
function Properties() {
  useDocument();
  const fileName = useFileName();
  const d = store.resolved.document;
  const set = (field: DocumentField) => (v: string) => {
    const c = setDocumentProps(store.state, { [field]: v });
    if (c) store.commit(c);
  };
  return (
    <section className="properties">
      <h2>Properties</h2>
      <Row label="Title"><Text value={d.title} placeholder={fileName} onCommit={set("title")} /></Row>
      <Row label="Author"><Text value={d.author} onCommit={set("author")} /></Row>
      <Row label="Revision"><Text value={d.revision} onCommit={set("revision")} /></Row>
      <label className="row stacked">
        <span className="label">Notes</span>
        <Text value={d.notes} onCommit={set("notes")} multiline />
      </label>
    </section>
  );
}

// ---- Variables ----

function Variables() {
  const state = useDocument();
  const vars = Object.entries(state.entities).filter(([, e]) => e.kind === KINDS.variable);
  if (vars.length === 0) return null;
  return (
    <section>
      <h2>Variables</h2>
      {vars.map(([id, e]) => (
        <Row key={id} label={(e.props.name as string | undefined) ?? id}>
          <Num value={e.props.value as number} onCommit={(v) => store.commit(propsChanged(id, { value: v }))} />
        </Row>
      ))}
    </section>
  );
}

// ---- Widgets ----

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="row"><span className="label">{label}</span>{children}</label>;
}

function Num({ value, onCommit, disabled, unit = "mm" }: { value: number; onCommit: (v: number) => void; disabled?: boolean; unit?: string }) {
  const [text, setText] = useState(formatMm(value));
  useEffect(() => { setText(formatMm(value)); }, [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(formatMm(value));
  };
  return (
    <span className="num">
      <input
        type="text" inputMode="decimal" value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setText(formatMm(value)); }}
      />
      <span className="unit">{unit}</span>
    </span>
  );
}

/** Free text, committed on blur or Enter (⌘Enter in a multi-line field). */
function Text({ value, onCommit, placeholder, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const props = {
    className: "text", value: text, placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => { if (text !== value) onCommit(text); },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") { setText(value); e.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />;
}

function kindLabel(kind: string): string {
  return { rect: "Rectangle", circle: "Circle", line: "Line" }[kind] ?? kind;
}
