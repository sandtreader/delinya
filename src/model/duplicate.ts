// Duplicating shapes: copies placed by an offset, each with its own copies
// of the original's dimensions and radius labels. A copy is drawn where the
// original is drawn (plus the offset), so a position a link derives is taken
// as drawn and stored as a plain number; links themselves are never copied.
// Everything else, including lengths linked to variables, is copied as stored.

import type { Change, DocState, Entity, Props } from "@sandtreader/collab/protocol";
import { type Bounds, boundsSize, snapNumber, unionBounds } from "./geometry";
import { type ResolvedShape, resolve } from "./resolve";
import { batch } from "./actions";
import { type EntityId, KINDS, SHAPE_KINDS } from "./types";

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
    changes.push({ type: "entity_added", id: copy, kind: e.kind, props: { ...structuredClone(e.props), ...movedPosition(s, delta) } });
    for (const label of labels.get(id) ?? []) {
      changes.push({ type: "entity_added", id: makeId(ATTACHED[label.kind]!), kind: label.kind, props: { ...structuredClone(label.props), target: copy } });
    }
  }
  return copies.length ? { change: batch(changes), ids: copies } : undefined;
}

/** The stored position props that put a shape where it is drawn now, moved by `delta`. */
function movedPosition(s: ResolvedShape, [dx, dy]: readonly [number, number]): Props {
  const at = (v: number, d: number) => snapNumber(v + d);
  switch (s.kind) {
    case "rect": return { x: at(s.x, dx), y: at(s.y, dy) };
    case "circle": return { cx: at(s.centre[0], dx), cy: at(s.centre[1], dy) };
    case "line": return { x: at(s.from[0], dx), y: at(s.from[1], dy) };
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

/**
 * Copy the shapes beside the bounds they make together, `spacing` mm clear
 * in `direction`: the selection panel's Duplicate and ⌘D. Undefined when
 * none of `ids` are shapes.
 */
export function duplicateBeside(
  state: DocState, ids: EntityId[], placement: { direction: DuplicateDirection; spacing: number }, makeId: (prefix: string) => EntityId,
): { change: Change; ids: EntityId[] } | undefined {
  const r = resolve(state);
  const shapes = ids.filter((id) => Object.hasOwn(r.shapes, id));
  if (shapes.length === 0) return undefined;
  const bounds = unionBounds(shapes.map((id) => r.shapes[id]!.bounds));
  return duplicateShapes(state, shapes, duplicateOffset(bounds, placement.direction, placement.spacing), makeId);
}
