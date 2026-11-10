// User-level operations, each a pure function from the current document to
// the Change that performs it. The store applies the Change locally and
// hands the same Change to the collab client, so what the user did and what
// the other clients see are one object. See "What each local action sends"
// in plans/collab.md.

import type { Change, DocState, Props, PropValue } from "@sandtreader/collab/protocol";
import { EPS, boundsMin, snapNumber } from "./geometry";
import {
  type Resolved, type ResolvedShape,
  alignedPosition, derivedAxes, isGridSpacing, lengthValue, placeAlong, resolve, spacedPositions,
} from "./resolve";
import {
  type AlignMode, type AlignProps, type Axis, type CircleProps, type DimensionProp, type DocumentField,
  type EntityId, type Length, type LineProps, type PolyProps, type RectProps, type SpacingMode, type SpacingProps,
  DEFAULT_GRID_SPACING, DOCUMENT_FIELDS, DOCUMENT_ID, KINDS, entitiesOfKind, entityAs, isRef, kindOf, toProps,
} from "./types";

export interface Gesture {
  start?: boolean;
  end?: boolean;
}

// ---- Adding ----

export function addLine(id: EntityId, props: LineProps): Change {
  return { type: "entity_added", id, kind: KINDS.line, props: toProps(props) };
}

export function addRect(id: EntityId, props: RectProps): Change {
  return { type: "entity_added", id, kind: KINDS.rect, props: toProps(props) };
}

export function addCircle(id: EntityId, props: CircleProps): Change {
  return { type: "entity_added", id, kind: KINDS.circle, props: toProps(props) };
}

export function addPolyline(id: EntityId, props: PolyProps): Change {
  return { type: "entity_added", id, kind: KINDS.polyline, props: toProps(props) };
}

export function addDimension(id: EntityId, target: EntityId, prop: DimensionProp, offset = 10): Change {
  return { type: "entity_added", id, kind: KINDS.dimension, props: { target, prop, offset } };
}

export function addRadiusLabel(id: EntityId, target: EntityId, corner: 0 | 1 | 2 | 3): Change {
  return { type: "entity_added", id, kind: KINDS.radiusLabel, props: { target, corner } };
}

export function addVariable(id: EntityId, value: number, name?: string): Change {
  const props: Props = { value };
  if (name !== undefined) props.name = name;
  return { type: "entity_added", id, kind: KINDS.variable, props };
}

export function addSpacing(id: EntityId, props: SpacingProps): Change {
  return { type: "entity_added", id, kind: KINDS.spacing, props: toProps(props) };
}

/** A shape plus its standard dimensions, as one unit. */
export function addRectWithDimensions(ids: { rect: EntityId; width: EntityId; height: EntityId }, props: RectProps, offset = 10): Change {
  return batch([
    addRect(ids.rect, props),
    addDimension(ids.width, ids.rect, "width", offset),
    addDimension(ids.height, ids.rect, "height", offset),
  ]);
}

// ---- Moving ----

/** Move a shape by a delta. Pass gesture flags while dragging. */
export function moveBy(state: DocState, id: EntityId, dx: number, dy: number, gesture: Gesture = {}): Change | undefined {
  const e = state.entities[id];
  if (!e) return undefined;
  const p = e.props;
  let props: Props;
  switch (e.kind) {
    case KINDS.line:
    case KINDS.rect:
      props = { x: (p.x as number) + dx, y: (p.y as number) + dy };
      break;
    case KINDS.circle:
      props = { cx: (p.cx as number) + dx, cy: (p.cy as number) + dy };
      break;
    case KINDS.polyline:
      if (!Array.isArray(p.nodes)) return undefined;
      props = { nodes: shiftNodes(p.nodes, dx, dy) };
      break;
    default:
      return undefined;
  }
  return propsChanged(id, props, gesture);
}

/**
 * Set a shape's position outright: x,y for lines and rects, centre for
 * circles, the first node for paths (the rest move with it).
 */
export function moveTo(state: DocState, id: EntityId, x: number, y: number, gesture: Gesture = {}): Change | undefined {
  const kind = kindOf(state, id);
  if (kind === KINDS.circle) return propsChanged(id, { cx: x, cy: y }, gesture);
  if (kind === KINDS.line || kind === KINDS.rect) return propsChanged(id, { x, y }, gesture);
  if (kind === KINDS.polyline) {
    const nodes = state.entities[id]!.props.nodes;
    const first = Array.isArray(nodes) ? nodes.find(hasPosition) : undefined;
    if (!first) return undefined;
    return propsChanged(id, { nodes: shiftNodes(nodes as PropValue[], x - first.x, y - first.y) }, gesture);
  }
  return undefined;
}

/** A stored path node with a usable position (other props unchecked). */
function hasPosition(n: unknown): n is { x: number; y: number } {
  if (n === null || typeof n !== "object" || Array.isArray(n)) return false;
  const { x, y } = n as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

/**
 * Stored path nodes moved by (dx, dy), carrying their handles (offsets).
 * Nodes without a usable position are kept as they are. New objects
 * throughout, so the original state is never shared or touched.
 */
export function shiftNodes(nodes: readonly unknown[], dx: number, dy: number, round = false): PropValue[] {
  const at = (v: number, d: number) => (round ? snapNumber(v + d) : v + d);
  return nodes.map((n) => {
    const copy = structuredClone(n) as PropValue;
    if (!hasPosition(n)) return copy;
    return { ...(copy as Record<string, PropValue>), x: at(n.x, dx), y: at(n.y, dy) };
  });
}

// ---- Lengths and equal-value links ----

/**
 * Set a length prop. If the prop is linked to a variable, the variable is
 * edited instead, so every linked shape follows.
 */
export function setLength(state: DocState, id: EntityId, prop: string, value: number, gesture: Gesture = {}): Change | undefined {
  const e = state.entities[id];
  if (!e) return undefined;
  const current = e.props[prop];
  if (isRef(current)) return propsChanged(current.ref, { value }, gesture);
  return propsChanged(id, { [prop]: value }, gesture);
}

/** Set one corner radius; same linked-variable rule as setLength. */
export function setCornerRadius(state: DocState, id: EntityId, corner: 0 | 1 | 2 | 3, value: number): Change | undefined {
  const rect = entityAs(state, id, KINDS.rect);
  if (!rect) return undefined;
  const r: [Length, Length, Length, Length] = rect.r ? [...rect.r] : [0, 0, 0, 0];
  const current = r[corner];
  if (isRef(current)) return propsChanged(current.ref, { value });
  r[corner] = value;
  return propsChanged(id, { r: toProps(r) as unknown as Props["r"] });
}

export interface LengthRef {
  id: EntityId;
  prop: string;
}

/**
 * Make several length props share one variable. If `variableId` names an
 * existing variable it is reused; otherwise a new one is created holding
 * the first member's current value.
 */
export function linkLengths(state: DocState, members: LengthRef[], variableId: EntityId, name?: string): Change | undefined {
  if (members.length === 0) return undefined;
  const changes: Change[] = [];
  const existing = entityAs(state, variableId, KINDS.variable);
  if (!existing) {
    const first = members[0]!;
    const e = state.entities[first.id];
    const value = e ? lengthValue(state, e.props[first.prop] as Length) ?? 0 : 0;
    changes.push(addVariable(variableId, value, name));
  }
  for (const m of members) {
    if (!state.entities[m.id]) continue;
    changes.push(propsChanged(m.id, { [m.prop]: { ref: variableId } }));
  }
  return batch(changes);
}

/** Replace a reference with its current number. The variable is left alone. */
export function unlinkLength(state: DocState, id: EntityId, prop: string): Change | undefined {
  const e = state.entities[id];
  if (!e) return undefined;
  const current = e.props[prop];
  if (!isRef(current)) return undefined;
  const value = lengthValue(state, current) ?? 0;
  return propsChanged(id, { [prop]: value });
}

// ---- Equal spacing ----

export function linkSpacing(id: EntityId, anchorA: EntityId, anchorB: EntityId, items: EntityId[], axis: Axis, mode: SpacingMode = "gaps"): Change {
  return addSpacing(id, { anchorA, anchorB, items, axis, mode });
}

/**
 * Remove a spacing link, writing each item's derived position back into
 * the shape so nothing moves on screen.
 */
export function unlinkSpacing(state: DocState, id: EntityId): Change | undefined {
  if (!entityAs(state, id, KINDS.spacing)) return undefined;
  const r = resolve(state);
  return batch(writeBackAndRemove(state, id, r, r.spacings.find((l) => l.id === id)));
}

/**
 * Space shapes once, where a live spacing link would put them (the outer
 * two along the axis are the anchors), leaving no link. Items a live link
 * already places on that axis can't move, so they are left out. Undefined
 * with fewer than three shapes or if nothing moves.
 */
export function spaceOnce(state: DocState, ids: EntityId[], axis: Axis, mode: SpacingMode): Change | undefined {
  const r = resolve(state);
  const { anchorA, anchorB, items } = outerAnchors(r, ids, axis);
  const free = items.filter((i) => !derivedAxes(r, i).has(axis));
  if (free.length === 0) return undefined;
  const { positions } = spacedPositions(r.shapes[anchorA]!.bounds, r.shapes[anchorB]!.bounds, free.map((i) => r.shapes[i]!.bounds), axis, mode);
  return placeOnce(state, r, axis, free.map((i, k) => [i, positions[k]!]));
}

/**
 * The outermost two shapes along an axis (by their minimum there) as
 * spacing anchors, and the rest in order between them. IDs that are not
 * shapes are dropped and ties keep the given order. Needs two shapes; a
 * missing anchor is "".
 */
export function outerAnchors(r: Resolved, ids: EntityId[], axis: Axis): { anchorA: EntityId; anchorB: EntityId; items: EntityId[] } {
  const sorted = [...new Set(ids)]
    .filter((id) => Object.hasOwn(r.shapes, id))
    .sort((a, b) => boundsMin(r.shapes[a]!.bounds, axis) - boundsMin(r.shapes[b]!.bounds, axis));
  return { anchorA: sorted[0] ?? "", anchorB: sorted.length > 1 ? sorted[sorted.length - 1]! : "", items: sorted.slice(1, -1) };
}

// ---- Alignment ----

export function linkAlign(id: EntityId, anchor: EntityId, items: EntityId[], axis: Axis, mode: AlignMode): Change {
  return { type: "entity_added", id, kind: KINDS.align, props: toProps<AlignProps>({ anchor, items, axis, mode }) };
}

/** Remove an align link, writing each item's derived position back so nothing moves. */
export function unlinkAlign(state: DocState, id: EntityId): Change | undefined {
  if (!entityAs(state, id, KINDS.align)) return undefined;
  const r = resolve(state);
  return batch(writeBackAndRemove(state, id, r, r.aligns.find((l) => l.id === id)));
}

/** Align links on `axis` whose anchor and at least one item are in `ids`, in ID order. */
export function alignLinksAmong(state: DocState, ids: EntityId[], axis: Axis): Array<[EntityId, AlignProps]> {
  const sel = new Set<unknown>(ids);
  return entitiesOfKind(state, KINDS.align)
    .filter(([, l]) => l.axis === axis && sel.has(l.anchor) && idList(l.items).some((i) => i !== l.anchor && sel.has(i)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Change an align link's mode; undefined if it already has it or isn't an align link. */
export function setAlignMode(state: DocState, linkId: EntityId, mode: AlignMode): Change | undefined {
  const l = entityAs(state, linkId, KINDS.align);
  if (!l || l.mode === mode) return undefined;
  return propsChanged(linkId, { mode });
}

/**
 * Move items once so their start, centre or end on an axis meets the
 * reference's, leaving no link. Items a live link places on that axis are
 * skipped: their stored position there is ignored. Undefined if nothing moves.
 */
export function alignOnce(state: DocState, reference: EntityId, items: EntityId[], axis: Axis, mode: AlignMode): Change | undefined {
  const r = resolve(state);
  const ref = r.shapes[reference];
  if (!ref) return undefined;
  const free = items.filter((i) => i !== reference && r.shapes[i] && !derivedAxes(r, i).has(axis));
  return placeOnce(state, r, axis, free.map((i) => [i, alignedPosition(ref.bounds, r.shapes[i]!.bounds, axis, mode)]));
}

/**
 * Give each item the reference's current width, height, diameter or length,
 * once. Goes through setLength, so a linked prop edits its variable. Items
 * whose kind lacks the prop are skipped. Undefined if nothing changes.
 */
export function equaliseOnce(state: DocState, reference: EntityId, items: EntityId[], prop: string): Change | undefined {
  const r = resolve(state);
  const ref = r.shapes[reference];
  const value = ref && sizeOf(ref, prop);
  if (value === undefined) return undefined;
  const changes: Change[] = [];
  const edited = new Set<EntityId>();
  for (const id of items) {
    const s = r.shapes[id];
    const current = s && id !== reference ? sizeOf(s, prop) : undefined;
    if (current === undefined || current === value) continue;
    const c = setLength(state, id, prop, value);
    // Items sharing a variable would each edit it; once is enough.
    if (!c || c.type !== "props_changed" || edited.has(c.id)) continue;
    edited.add(c.id);
    changes.push(c);
  }
  return single(changes);
}

// ---- Removing any link ----

/**
 * Something removable that ties shapes together: an align or spacing link,
 * or one shape's length (or one corner of a rect's `r`) tied to a variable.
 */
export type LinkTarget =
  | { kind: "link"; id: EntityId }
  | { kind: "value"; shape: EntityId; prop: string; corner?: 0 | 1 | 2 | 3 };

/** The variable a value target refers to; undefined for a plain number or a link. */
export function targetVariable(state: DocState, target: LinkTarget): EntityId | undefined {
  if (target.kind !== "value") return undefined;
  const v = state.entities[target.shape]?.props[target.prop];
  const current = target.corner === undefined ? v : Array.isArray(v) ? v[target.corner] : undefined;
  return isRef(current) ? current.ref : undefined;
}

/** Remove a link as its own unlink does; undefined if there's nothing to unlink. */
export function unlinkTarget(state: DocState, target: LinkTarget): Change | undefined {
  if (target.kind === "link") {
    const kind = kindOf(state, target.id);
    return kind === KINDS.align ? unlinkAlign(state, target.id) : kind === KINDS.spacing ? unlinkSpacing(state, target.id) : undefined;
  }
  if (target.corner === undefined) return unlinkLength(state, target.shape, target.prop);
  const ref = targetVariable(state, target);
  const r = state.entities[target.shape]?.props[target.prop];
  if (ref === undefined || !Array.isArray(r)) return undefined;
  const next = [...r];
  next[target.corner] = lengthValue(state, { ref }) ?? 0;
  return propsChanged(target.shape, { [target.prop]: next });
}

// ---- Document properties ----

/**
 * Set title-block text. Adds the singleton entity on first use, otherwise
 * sends only the props that differ; undefined if none do. Absent counts as "".
 */
export function setDocumentProps(state: DocState, props: Partial<Record<DocumentField, string>>): Change | undefined {
  const e = state.entities[DOCUMENT_ID];
  const changed: Props = {};
  for (const k of DOCUMENT_FIELDS) {
    const v = props[k];
    if (v !== undefined && v !== (e?.props[k] ?? "")) changed[k] = v;
  }
  if (Object.keys(changed).length === 0) return undefined;
  if (!e) return { type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: changed };
  return propsChanged(DOCUMENT_ID, changed);
}

/**
 * Set the drawing's grid spacing, mm. Undefined unless `mm` is a positive
 * number different from the stored one (absent counts as the 1 mm default).
 */
export function setGridSpacing(state: DocState, mm: number): Change | undefined {
  if (!isGridSpacing(mm)) return undefined;
  const e = state.entities[DOCUMENT_ID];
  if (mm === (e?.props.gridSpacing ?? DEFAULT_GRID_SPACING)) return undefined;
  if (!e) return { type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: { gridSpacing: mm } };
  return propsChanged(DOCUMENT_ID, { gridSpacing: mm });
}

// ---- Deleting ----

/**
 * Delete an entity and everything that only makes sense with it: its
 * dimensions and radius labels, and its membership of spacing and align
 * links. A link that loses an anchor goes too, its items' derived positions
 * written back first (as unlinking does) so nothing that hung off the
 * deleted shape moves; an align link left with no items just goes.
 * Variables are left; an unused one is harmless and may be relinked. One
 * batch, so it undoes in one step.
 */
export function deleteEntity(state: DocState, id: EntityId): Change | undefined {
  if (!state.entities[id]) return undefined;
  const changes: Change[] = [];
  // Positions as they stand before the delete; resolved only if a link loses an anchor.
  let r: Resolved | undefined;
  const before = () => (r ??= resolve(state));
  for (const [dimId, d] of entitiesOfKind(state, KINDS.dimension)) {
    if (d.target === id) changes.push({ type: "entity_removed", id: dimId });
  }
  for (const [labelId, l] of entitiesOfKind(state, KINDS.radiusLabel)) {
    if (l.target === id) changes.push({ type: "entity_removed", id: labelId });
  }
  for (const [linkId, l] of entitiesOfKind(state, KINDS.spacing)) {
    const items = idList(l.items);
    if (l.anchorA === id || l.anchorB === id) changes.push(...writeBackAndRemove(state, linkId, before(), before().spacings.find((s) => s.id === linkId)));
    else if (items.includes(id)) changes.push(propsChanged(linkId, { items: items.filter((i) => i !== id) }));
  }
  for (const [linkId, l] of entitiesOfKind(state, KINDS.align)) {
    const items = idList(l.items);
    const rest = items.filter((i) => i !== id);
    if (l.anchor === id) changes.push(...writeBackAndRemove(state, linkId, before(), before().aligns.find((a) => a.id === linkId)));
    else if (rest.length === 0 && items.length > 0) changes.push({ type: "entity_removed", id: linkId });
    else if (rest.length < items.length) changes.push(propsChanged(linkId, { items: rest }));
  }
  changes.push({ type: "entity_removed", id });
  return changes.length === 1 ? changes[0]! : batch(changes);
}

// ---- Helpers ----

export function propsChanged(id: EntityId, props: Props, gesture: Gesture = {}): Change {
  const c: Change = { type: "props_changed", id, props };
  if (gesture.start) c.gestureStart = true;
  if (gesture.end) c.gestureEnd = true;
  return c;
}

export function batch(changes: Change[]): Change {
  return { type: "batch", changes };
}

function single(changes: Change[]): Change | undefined {
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/** A link's items as stored, tolerating a malformed list. */
function idList(v: unknown): EntityId[] {
  return Array.isArray(v) ? v.filter((i): i is EntityId => typeof i === "string") : [];
}

/**
 * The stored prop holding a shape's position on one axis, set to where it
 * now resolves. A path's nodes hold both axes, so only this one moves.
 */
function storedAlong(state: DocState, s: ResolvedShape, axis: Axis): Props {
  const at = axis === "x" ? 0 : 1;
  switch (s.kind) {
    case "line": return { [axis]: s.from[at] };
    case "rect": return { [axis]: axis === "x" ? s.x : s.y };
    case "circle": return { [axis === "x" ? "cx" : "cy"]: s.centre[at] };
    case "polyline": {
      const [dx, dy] = drawnOffset(state, s);
      return { nodes: shiftNodes(state.entities[s.id]!.props.nodes as PropValue[], axis === "x" ? dx : 0, axis === "y" ? dy : 0) };
    }
  }
}

/**
 * How far a resolved path is drawn from its stored nodes (links translate
 * it whole). Zero if it can't tell.
 */
export function drawnOffset(state: DocState, s: { id: EntityId; nodes: ReadonlyArray<{ index: number; point: readonly [number, number] }> }): [number, number] {
  const nodes = state.entities[s.id]?.props.nodes;
  const first = s.nodes[0];
  const stored = first && Array.isArray(nodes) ? nodes[first.index] : undefined;
  if (!first || !hasPosition(stored)) return [0, 0];
  return [first.point[0] - stored.x, first.point[1] - stored.y];
}

/**
 * Remove a link after storing its items' derived positions, so nothing
 * moves. Only the link's own axis is written: the other may belong to
 * another link, and an inactive link derived nothing.
 */
function writeBackAndRemove(state: DocState, id: EntityId, r: Resolved, link: { axis: Axis; positions: Record<EntityId, number> } | undefined): Change[] {
  const changes: Change[] = [];
  if (link) for (const item of Object.keys(link.positions)) {
    const s = r.shapes[item];
    if (s) changes.push(propsChanged(item, storedAlong(state, s, link.axis)));
  }
  changes.push({ type: "entity_removed", id });
  return changes;
}

/**
 * Store new along-axis minimums, moving each shape the way resolve() would
 * so a one-off lands exactly where a live link puts it. Shapes already in
 * place are skipped; undefined if none move.
 */
function placeOnce(state: DocState, r: Resolved, axis: Axis, targets: Array<[EntityId, number]>): Change | undefined {
  const changes: Change[] = [];
  for (const [id, at] of targets) {
    const s = r.shapes[id]!;
    if (Math.abs(at - boundsMin(s.bounds, axis)) < EPS) continue;
    changes.push(propsChanged(id, storedAlong(state, placeAlong(s, axis, at), axis)));
  }
  return single(changes);
}

/** A shape's resolved size by prop name, or undefined if its kind has none. */
function sizeOf(s: ResolvedShape, prop: string): number | undefined {
  switch (s.kind) {
    case "rect": return prop === "width" ? s.width : prop === "height" ? s.height : undefined;
    case "circle": return prop === "diameter" ? s.diameter : undefined;
    case "line": return prop === "length" ? s.length : undefined;
    case "polyline": return undefined;
  }
}
