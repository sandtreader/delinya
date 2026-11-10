// Exact values for one selected shape, in the floating panel. Typing into a
// linked field edits the shared variable; the panel says so and offers to
// unlink.

import {
  KINDS, derivedAxes, entitiesOfKind, entityAs, isRef, lengthValue, propsChanged,
  setCornerRadius, setLength, setPolyClosed, unlinkAlign, unlinkLength, unlinkSpacing,
  type EntityId, type Length, type ResolvedRect,
} from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { ALIGN_LABELS } from "../view/linkButtons";
import { formatMm } from "../view/format";
import { Num, Row } from "./fields";
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
    if (s.kind === "rect") return i === 0 ? s.x : s.y;
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
      {editor.tool === "select" && <p className="hint">Drag a node to move it, click one to edit it; double-click the path to add one.</p>}
    </>
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
  return { rect: "Rectangle", circle: "Circle", line: "Line", polyline: "Path" }[kind] ?? kind;
}
