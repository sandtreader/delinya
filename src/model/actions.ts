// User-level operations, each a pure function from the current document to
// the Change that performs it. The store applies the Change locally and
// hands the same Change to the collab client, so what the user did and what
// the other clients see are one object. See "What each local action sends"
// in plans/collab.md.

import type { Change, DocState, Props } from "@sandtreader/collab/protocol";
import { lengthValue, resolve } from "./resolve";
import {
  type Axis, type CircleProps, type DimensionProp, type EntityId, type Length, type LineProps,
  type RectProps, type SpacingMode, type SpacingProps,
  KINDS, entitiesOfKind, entityAs, isRef, kindOf, toProps,
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
    default:
      return undefined;
  }
  return propsChanged(id, props, gesture);
}

/** Set a shape's position outright (x,y for lines and rects, centre for circles). */
export function moveTo(state: DocState, id: EntityId, x: number, y: number, gesture: Gesture = {}): Change | undefined {
  const kind = kindOf(state, id);
  if (kind === KINDS.circle) return propsChanged(id, { cx: x, cy: y }, gesture);
  if (kind === KINDS.line || kind === KINDS.rect) return propsChanged(id, { x, y }, gesture);
  return undefined;
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
  const link = entityAs(state, id, KINDS.spacing);
  if (!link) return undefined;
  const changes: Change[] = [];
  const resolved = resolve(state);
  for (const item of link.items) {
    const s = resolved.shapes[item];
    if (!s) continue;
    const c = moveTo(state, item, ...authoredPosition(s));
    if (c) changes.push(c);
  }
  changes.push({ type: "entity_removed", id });
  return batch(changes);
}

// ---- Deleting ----

/**
 * Delete an entity and everything that only makes sense with it: its
 * dimensions and radius labels, and its membership of spacing links (a
 * link loses an anchor, it goes too). Variables are left; an unused one is
 * harmless and may be relinked.
 */
export function deleteEntity(state: DocState, id: EntityId): Change | undefined {
  if (!state.entities[id]) return undefined;
  const changes: Change[] = [];
  for (const [dimId, d] of entitiesOfKind(state, KINDS.dimension)) {
    if (d.target === id) changes.push({ type: "entity_removed", id: dimId });
  }
  for (const [labelId, l] of entitiesOfKind(state, KINDS.radiusLabel)) {
    if (l.target === id) changes.push({ type: "entity_removed", id: labelId });
  }
  for (const [linkId, l] of entitiesOfKind(state, KINDS.spacing)) {
    if (l.anchorA === id || l.anchorB === id) changes.push({ type: "entity_removed", id: linkId });
    else if (l.items.includes(id)) changes.push(propsChanged(linkId, { items: l.items.filter((i) => i !== id) }));
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

/** The stored position a resolved shape would need to sit where it is. */
function authoredPosition(s: ReturnType<typeof resolve>["shapes"][string]): [number, number] {
  switch (s.kind) {
    case "line": return s.from;
    case "rect": return [s.x, s.y];
    case "circle": return s.centre;
  }
}
