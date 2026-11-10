// Duplicating shapes: copies placed by an offset, each with its own copies
// of the original's dimensions and radius labels. A copy is drawn where the
// original is drawn (plus the offset), so a position a link derives is taken
// as drawn and stored as a plain number; links themselves are never copied.
// Everything else, including lengths linked to variables, is copied as stored.

import type { Change, DocState, Entity, Props } from "@sandtreader/collab/protocol";
import { type Bounds, boundsSize, snapNumber } from "./geometry";
import { type ResolvedShape, isGridSpacing, resolve } from "./resolve";
import { batch } from "./actions";
import { type EntityId, DEFAULT_GRID_SPACING, KINDS, SHAPE_KINDS } from "./types";

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

/** How far ⌘D steps a copy, mm, before rounding up to the grid. */
export const DUPLICATE_STEP = 10;

/**
 * The ⌘D offset: about DUPLICATE_STEP down and to the right, rounded up to a
 * whole number of grid spacings so a shape on the grid stays on it.
 */
export function duplicateStep(gridSpacing: number): [number, number] {
  const s = isGridSpacing(gridSpacing) ? gridSpacing : DEFAULT_GRID_SPACING;
  // Rounded before ceil so float noise can't add a step, and after so 0.15 × 67 is 10.05.
  const step = snapNumber(s * Math.ceil(snapNumber(DUPLICATE_STEP / s)));
  return [step, step];
}
