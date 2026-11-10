// Duplicating shapes: copies placed by an offset, each with its own copies
// of the original's dimensions and radius labels. A copy is drawn where the
// original is drawn (plus the offset), so a position a link derives is taken
// as drawn and stored as a plain number; links themselves are never copied.
// Everything else, including lengths linked to variables, is copied as stored.
// A row of copies can be linked to its original: equal gaps, shared sizes,
// lined up across the row.

import { applyChange, type Change, type DocState, type Entity, type Props } from "@sandtreader/collab/protocol";
import { type Bounds, boundsSize, snapNumber, unionBounds } from "./geometry";
import { type ResolvedShape, resolve } from "./resolve";
import { EQUAL_PROPS, batch, drawnOffset, linkAlign, linkLengths, linkSpacing, shiftNodes } from "./actions";
import { type Axis, type EntityId, KINDS, SHAPE_KINDS, entitiesOfKind } from "./types";

export type DuplicateDirection = "right" | "down" | "left" | "up";
export const DUPLICATE_DIRECTIONS: readonly DuplicateDirection[] = ["right", "down", "left", "up"];

/** Labels that hang off one shape and are copied with it, and the ID prefix for their copies. */
const ATTACHED: Record<string, string> = { [KINDS.dimension]: "dim", [KINDS.radiusLabel]: "radius" };

/**
 * Copy the shapes among `ids` (others are ignored), each moved by `delta`,
 * as one batch so it undoes in one step. `makeId(prefix)` names each new
 * entity: a shape copy by its kind, in the order of `ids`, each followed by
 * its labels' copies. Returns the copies' IDs in that order, or undefined if
 * there is no shape to copy.
 */
export function duplicateShapes(
  state: DocState, ids: EntityId[], delta: readonly [number, number], makeId: (prefix: string) => EntityId,
): { change: Change; ids: EntityId[] } | undefined {
  const r = resolve(state);
  const labels = new Map<EntityId, Array<Entity>>();
  for (const e of Object.values(state.entities)) {
    const target = Object.hasOwn(ATTACHED, e.kind) ? e.props.target : undefined;
    if (typeof target === "string") labels.set(target, [...(labels.get(target) ?? []), e]);
  }

  const changes: Change[] = [];
  const copies: EntityId[] = [];
  for (const id of new Set(ids)) {
    const e = state.entities[id];
    const s = r.shapes[id];
    if (!e || !s || !SHAPE_KINDS.has(e.kind)) continue;
    const copy = makeId(e.kind);
    copies.push(copy);
    changes.push({ type: "entity_added", id: copy, kind: e.kind, props: { ...structuredClone(e.props), ...movedPosition(state, s, delta) } });
    for (const label of labels.get(id) ?? []) {
      changes.push({ type: "entity_added", id: makeId(ATTACHED[label.kind]!), kind: label.kind, props: { ...structuredClone(label.props), target: copy } });
    }
  }
  return copies.length ? { change: batch(changes), ids: copies } : undefined;
}

/** The stored position props that put a shape where it is drawn now, moved by `delta`. */
function movedPosition(state: DocState, s: ResolvedShape, [dx, dy]: readonly [number, number]): Props {
  const at = (v: number, d: number) => snapNumber(v + d);
  switch (s.kind) {
    case "rect": return { x: at(s.x, dx), y: at(s.y, dy) };
    case "circle": return { cx: at(s.centre[0], dx), cy: at(s.centre[1], dy) };
    case "line": return { x: at(s.from[0], dx), y: at(s.from[1], dy) };
    case "polyline": {
      const [ox, oy] = drawnOffset(state, s);
      return { nodes: shiftNodes(state.entities[s.id]!.props.nodes as unknown[], ox + dx, oy + dy, true) };
    }
  }
}

/** The offset that puts a copy of `bounds` beside it in `direction`, `spacing` mm clear of it. */
export function duplicateOffset(bounds: Bounds, direction: DuplicateDirection, spacing: number): [number, number] {
  const across = snapNumber(boundsSize(bounds, "x") + spacing);
  const down = snapNumber(boundsSize(bounds, "y") + spacing);
  // 0 - v, not -v, so a zero offset is never -0.
  switch (direction) {
    case "right": return [across, 0];
    case "left": return [0 - across, 0];
    case "down": return [0, down];
    case "up": return [0, 0 - down];
  }
}

/** Where Duplicate puts the copies, how many, and how they are linked to the original. */
export interface DuplicatePlacement {
  direction: DuplicateDirection;
  /** Gap between the shapes' bounds and the first copy's, and between copies, mm. */
  spacing: number;
  /** A whole number, at least one; default one. */
  count?: number;
  /** Keep each shape's copies equally spaced between it and its last copy; needs two or more copies. */
  linkGaps?: boolean;
  /** Give each shape's sizes and its copies' one variable per size. */
  linkSize?: boolean;
  /** Keep each shape's copies lined up with it across the row: tops for a row, left edges for a column. */
  linkAlign?: boolean;
}

/**
 * Copy the shapes beside the bounds they make together, `spacing` mm clear
 * in `direction`: the selection panel's Duplicate and ⌘D. `count` copies
 * make a row, each one step on from the last. With `linkGaps` each shape
 * gets a spacing link (see gapLinks), with `linkSize` variables for its
 * sizes (see sizeLinks), with `linkAlign` an align link (see alignLinks);
 * ⌘D asks for one copy and no links. One batch, so
 * one undo step; the IDs come copy by copy, in the order of `ids` within
 * each. Undefined when none of `ids` are shapes.
 */
export function duplicateBeside(
  state: DocState, ids: EntityId[], placement: DuplicatePlacement, makeId: (prefix: string) => EntityId,
): { change: Change; ids: EntityId[] } | undefined {
  const r = resolve(state);
  // Once each, so the copies of each step line up with `shapes`.
  const shapes = [...new Set(ids)].filter((id) => Object.hasOwn(r.shapes, id));
  if (shapes.length === 0) return undefined;
  const bounds = unionBounds(shapes.map((id) => r.shapes[id]!.bounds));
  const [dx, dy] = duplicateOffset(bounds, placement.direction, placement.spacing);
  const whole = Math.floor(placement.count ?? 1);
  const count = Number.isFinite(whole) && whole > 1 ? whole : 1;
  const changes: Change[] = [];
  const copies: EntityId[] = [];
  const rows = new Map<EntityId, EntityId[]>(shapes.map((id) => [id, []]));
  for (let k = 1; k <= count; k++) {
    const out = duplicateShapes(state, shapes, [snapNumber(k * dx), snapNumber(k * dy)], makeId)!;
    changes.push(...parts(out.change));
    copies.push(...out.ids);
    out.ids.forEach((copy, i) => rows.get(shapes[i]!)!.push(copy));
  }
  if (placement.linkGaps && count >= 2) changes.push(...gapLinks(rows, placement.direction, makeId));
  if (placement.linkAlign) changes.push(...alignLinks(rows, placement.direction, makeId));
  // linkLengths only links shapes already in the document, so it works on one with the copies in.
  if (placement.linkSize) changes.push(...sizeLinks(applyChange(state, batch(changes)), rows, makeId));
  return { change: batch(changes), ids: copies };
}

/**
 * Per shape, a spacing link (equal gaps) with the shape and its last copy
 * as anchors and the copies between as items. The copies are already
 * evenly placed, so nothing moves; spacing lays items out from the lower
 * anchor, so a row going left or up lists them last copy first.
 */
function gapLinks(rows: Map<EntityId, EntityId[]>, direction: DuplicateDirection, makeId: (prefix: string) => EntityId): Change[] {
  const axis: Axis = direction === "right" || direction === "left" ? "x" : "y";
  const backwards = direction === "left" || direction === "up";
  return [...rows].map(([id, row]) => {
    const between = row.slice(0, -1);
    return linkSpacing(makeId("spacing"), id, row[row.length - 1]!, backwards ? between.reverse() : between, axis, "gaps");
  });
}

/**
 * Per shape, an align link with the shape as anchor and its copies as
 * items, across the row (tops for a row, left edges for a column). The
 * copies already line up, so nothing moves, and it is on the other axis
 * from the gaps' spacing link, so the two never clash.
 */
function alignLinks(rows: Map<EntityId, EntityId[]>, direction: DuplicateDirection, makeId: (prefix: string) => EntityId): Change[] {
  const axis: Axis = direction === "right" || direction === "left" ? "y" : "x";
  return [...rows].map(([id, row]) => linkAlign(makeId("align"), id, row, axis, "start"));
}

/**
 * Per shape and size (EQUAL_PROPS), a new variable holding the shape's
 * value, shared by it and its copies. A size already held by a variable is
 * left alone: the copies share it already. Each is named for its size,
 * apart from the drawing's other variables: "width", "width 2"…
 */
function sizeLinks(state: DocState, rows: Map<EntityId, EntityId[]>, makeId: (prefix: string) => EntityId): Change[] {
  const taken = new Set(entitiesOfKind(state, KINDS.variable).map(([, v]) => v.name));
  const changes: Change[] = [];
  for (const [id, row] of rows) {
    const e = state.entities[id]!;
    for (const { prop } of EQUAL_PROPS[e.kind] ?? []) {
      if (typeof e.props[prop] !== "number") continue;
      let name = prop;
      for (let n = 2; taken.has(name); n++) name = `${prop} ${n}`;
      taken.add(name);
      // The shape first, so the variable takes its value.
      const c = linkLengths(state, [id, ...row].map((m) => ({ id: m, prop })), makeId("var"), name);
      if (c) changes.push(...parts(c));
    }
  }
  return changes;
}

/** A change as a list, a batch's flattened one level. */
function parts(c: Change): Change[] {
  return c.type === "batch" ? c.changes : [c];
}
