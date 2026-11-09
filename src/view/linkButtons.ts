// Delink buttons: where to offer removing each link among the selection, in
// model mm. Pure; the canvas draws them. Align and spacing buttons sit on
// the guides linkGuides draws; a shared length's sits on its dimension.

import {
  type AlignMode, type Axis, type DocState, type EntityId, type LinkTarget, type Point, type Resolved,
  KINDS, entityAs, isRef, isShape, midpoint, targetVariable,
} from "../model";
import { linkGuides } from "./linkGuides";

export interface LinkButton {
  target: LinkTarget;
  at: Point;
  label: string;
}

export const ALIGN_LABELS: Record<Axis, Record<AlignMode, string>> = {
  x: { start: "left edges", centre: "centres across", end: "right edges" },
  y: { start: "top edges", centre: "centres down", end: "bottom edges" },
};

type ValueTarget = Extract<LinkTarget, { kind: "value" }>;

const LENGTH_PROPS = ["width", "height", "diameter", "length"] as const;
const CORNERS = [0, 1, 2, 3] as const;

/**
 * A button for each link joining two or more of `ids`: align and spacing
 * links in ID order (at the guide's start or first "=" mark), then each
 * selected shape's lengths whose variable another selected shape also uses
 * (at its dimension line's midpoint or radius label). Lengths with nowhere
 * to put a button are skipped.
 */
export function linkButtons(
  state: DocState, resolved: Resolved, ids: EntityId[], pad: number, hidden: ReadonlySet<EntityId> = new Set(),
): LinkButton[] {
  const sel = new Set<unknown>(ids);
  const out: LinkButton[] = [];
  for (const g of linkGuides(state, resolved, ids, pad, hidden)) {
    const at = g.kind === "align" ? g.path[0]?.from : g.marks[0];
    const target: LinkTarget = { kind: "link", id: g.link };
    if (at && joins(state, g.link, sel)) out.push({ target, at, label: describeLink(state, target) });
  }
  const lengths = [...new Set(ids)].map((id) => linkedLengths(state, id));
  lengths.forEach((own, k) => {
    for (const [target, ref] of own) {
      if (!lengths.some((other, j) => j !== k && other.some(([, r]) => r === ref))) continue;
      const at = valueAt(resolved, target);
      if (at) out.push({ target, at, label: describeLink(state, target) });
    }
  });
  return out;
}

/** A short description of a link, for a button or popup. */
export function describeLink(state: DocState, target: LinkTarget): string {
  if (target.kind === "value") {
    const ref = targetVariable(state, target);
    if (ref === undefined) return "Link";
    const name = entityAs(state, ref, KINDS.variable)?.name;
    return `= ${typeof name === "string" && name !== "" ? name : ref}`;
  }
  const e = state.entities[target.id];
  if (e?.kind === KINDS.align) {
    const axis: Axis = e.props.axis === "y" ? "y" : "x";
    const mode: AlignMode = e.props.mode === "centre" || e.props.mode === "end" ? e.props.mode : "start";
    return `Aligned: ${ALIGN_LABELS[axis][mode]}`;
  }
  if (e?.kind === KINDS.spacing) return `Equal spacing: ${e.props.mode === "centres" ? "centres" : "gaps"}`;
  return "Link";
}

/** An align link's anchor and an item are selected, or any two of a spacing link's shapes. */
function joins(state: DocState, id: EntityId, sel: Set<unknown>): boolean {
  const e = state.entities[id];
  if (!e) return false;
  const p: Record<string, unknown> = e.props;
  const items: unknown[] = Array.isArray(p.items) ? p.items : [];
  if (e.kind === KINDS.align) return sel.has(p.anchor) && items.some((i) => i !== p.anchor && sel.has(i));
  return [...new Set([p.anchorA, p.anchorB, ...items])].filter((m) => sel.has(m)).length >= 2;
}

/** A shape's lengths tied to a variable, each with the variable's ID. */
function linkedLengths(state: DocState, id: EntityId): Array<[ValueTarget, EntityId]> {
  const e = state.entities[id];
  if (!e || !isShape(e)) return [];
  const out: Array<[ValueTarget, EntityId]> = [];
  for (const prop of LENGTH_PROPS) {
    const v = e.props[prop];
    if (isRef(v)) out.push([{ kind: "value", shape: id, prop }, v.ref]);
  }
  const r = e.props.r;
  if (Array.isArray(r)) for (const corner of CORNERS) {
    const v = r[corner];
    if (isRef(v)) out.push([{ kind: "value", shape: id, prop: "r", corner }, v.ref]);
  }
  return out;
}

/** The radius label for a corner, else the midpoint of the prop's dimension line. */
function valueAt(r: Resolved, t: ValueTarget): Point | undefined {
  if (t.corner !== undefined) return r.radiusLabels.find((l) => l.target === t.shape && l.corner === t.corner)?.at;
  const d = r.dimensions.find((d) => d.target === t.shape && d.prop === t.prop);
  return d && midpoint(d.line.from, d.line.to);
}
