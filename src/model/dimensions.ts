// Dimensions and radius labels by hand: what the Dimension tool would
// measure under the pointer, where the pointer puts a dimension's line, and
// the changes that add, move and remove them. Pure, like the rest of the model.
//
// A dimension's offset is signed (see `measure` in resolve.ts): positive
// stands off the shape's near side (a rect's top or left edge, a circle's
// top, a line's left as it runs), negative off the far side.

import type { Change, DocState } from "@sandtreader/collab/protocol";
import { distanceToArc, distanceToSegment, rotatePoint, snapNumber, type Point } from "./geometry";
import { type Resolved, type ResolvedShape, lineNormal } from "./resolve";
import { DIMENSION_OFFSET, addDimension, addRadiusLabel, batch, propsChanged } from "./actions";
import { type DimensionProp, type EntityId, KINDS, entitiesOfKind, entityAs } from "./types";

/** What a dimension can measure on each kind of shape; none on paths and text boxes. */
const MEASURES: Readonly<Record<string, readonly DimensionProp[]>> = {
  [KINDS.rect]: ["width", "height"],
  [KINDS.circle]: ["diameter"],
  [KINDS.line]: ["length"],
};

/** The props a dimension can measure on a shape of `kind`, in panel order; empty for paths, text and non-shapes. */
export function dimensionProps(kind: string | undefined): readonly DimensionProp[] {
  return (kind !== undefined && Object.hasOwn(MEASURES, kind) ? MEASURES[kind] : undefined) ?? [];
}

/** Round `v`'s magnitude to `step` (bad steps are 0.01 mm), snapped to drop float noise, never -0. */
function roundOffset(v: number, step: number): number {
  const s = Number.isFinite(step) && step > 0 ? step : 0.01;
  const m = snapNumber(Math.round(Math.abs(v) / s) * s);
  return (v < 0 ? -m : m) + 0;
}

/**
 * The signed offset a dimension of `prop` on `target` takes for a pointer at
 * `point` (model mm), its magnitude rounded to `step` (the grid when
 * snapping, else 0.01 mm). A rect (in its own frame, if turned): from the
 * near edge with the pointer in its near half (top for width, left for
 * height), at least 0; from the far edge in the far half, negative, at least
 * one step out so it still says "far". A circle likewise from its top or
 * bottom; a line, the signed distance along its dimension normal.
 * Undefined if there is no such shape or it doesn't measure that way.
 */
export function dimensionOffsetAt(r: Resolved, target: EntityId, prop: DimensionProp, point: Point, step = 0.01): number | undefined {
  const s = Object.hasOwn(r.shapes, target) ? r.shapes[target]! : undefined;
  if (!s || !dimensionProps(s.kind).includes(prop)) return undefined;
  const s1 = Number.isFinite(step) && step > 0 ? step : 0.01;
  // Near side: the distance out, never inside; far side: negative, at least a step.
  const side = (near: number, far: number, inNearHalf: boolean) =>
    roundOffset(inNearHalf ? Math.max(near, 0) : -Math.max(far, s1), s1);
  switch (s.kind) {
    case "rect": {
      const [x, y] = rotatePoint(point, -s.rotation, [s.x, s.y]);
      if (prop === "width") return side(s.y - y, y - (s.y + s.height), y <= s.y + s.height / 2);
      return side(s.x - x, x - (s.x + s.width), x <= s.x + s.width / 2);
    }
    case "circle": {
      const [cx, cy] = s.centre;
      return side(cy - s.radius - point[1], point[1] - (cy + s.radius), point[1] <= cy);
    }
    case "line": {
      const n = lineNormal(s.angle);
      return roundOffset((point[0] - s.from[0]) * n[0] + (point[1] - s.from[1]) * n[1], s1);
    }
    default:
      return undefined;
  }
}

/** What the Dimension tool would measure: a shape's dimension of a prop, or a rect's corner radius. */
export type DimensionTarget =
  | { kind: "dimension"; target: EntityId; prop: DimensionProp }
  | { kind: "radius"; target: EntityId; corner: 0 | 1 | 2 | 3 };

const NONE: ReadonlySet<EntityId> = new Set();
const CORNERS = [0, 1, 2, 3] as const;

/**
 * What the Dimension tool would measure for a pointer at `point` (model mm),
 * within `tolerance` mm: on the topmost shape it is near, leaving out those
 * on `hidden` or `locked` layers. A rect: a rounded corner's arc gives its
 * radius label; else its top or bottom straight edge its width, its left or
 * right its height (in its own frame, if turned). A circle's outline: its
 * diameter. A line: its length. Paths and text boxes: nothing. Null if nothing.
 */
export function dimensionTargetAt(
  r: Resolved, point: Point, tolerance: number,
  { hidden = NONE, locked = NONE }: { hidden?: ReadonlySet<EntityId>; locked?: ReadonlySet<EntityId> } = {},
): DimensionTarget | null {
  for (let i = r.order.length - 1; i >= 0; i--) {
    const s = r.shapes[r.order[i]!];
    if (!s || hidden.has(s.layer) || locked.has(s.layer)) continue;
    const hit = targetOn(s, point, tolerance);
    if (hit) return hit;
  }
  return null;
}

function targetOn(s: ResolvedShape, p: Point, tol: number): DimensionTarget | null {
  switch (s.kind) {
    case "rect": {
      for (const corner of CORNERS) {
        const a = s.arcs[corner];
        if (a && distanceToArc(p, a) <= tol) return { kind: "radius", target: s.id, corner };
      }
      // The straight edges, upright in the rect's own frame.
      const l = rotatePoint(p, -s.rotation, [s.x, s.y]);
      const { x, y, width: w, height: h } = s, [tl, tr, br, bl] = s.r;
      const across = Math.min(
        distanceToSegment(l, [x + tl, y], [x + w - tr, y]),
        distanceToSegment(l, [x + bl, y + h], [x + w - br, y + h]),
      );
      const down = Math.min(
        distanceToSegment(l, [x, y + tl], [x, y + h - bl]),
        distanceToSegment(l, [x + w, y + tr], [x + w, y + h - br]),
      );
      if (Math.min(across, down) > tol) return null;
      return { kind: "dimension", target: s.id, prop: across <= down ? "width" : "height" };
    }
    case "circle":
      return Math.abs(Math.hypot(p[0] - s.centre[0], p[1] - s.centre[1]) - s.radius) <= tol
        ? { kind: "dimension", target: s.id, prop: "diameter" } : null;
    case "line":
      return distanceToSegment(p, s.from, s.to) <= tol ? { kind: "dimension", target: s.id, prop: "length" } : null;
    default:
      return null;
  }
}

/** The dimensions of `target`'s `prop`, by ID, in document order. */
export function dimensionsOf(state: DocState, target: EntityId, prop: DimensionProp): EntityId[] {
  return entitiesOfKind(state, KINDS.dimension).filter(([, d]) => d.target === target && d.prop === prop).map(([id]) => id);
}

/** The radius labels on `target`'s `corner`, by ID, in document order. */
export function radiusLabelsOf(state: DocState, target: EntityId, corner: 0 | 1 | 2 | 3): EntityId[] {
  return entitiesOfKind(state, KINDS.radiusLabel).filter(([, l]) => l.target === target && l.corner === corner).map(([id]) => id);
}

/** All of `ids` removed, as one change. */
function removeAll(ids: EntityId[]): Change {
  const changes: Change[] = ids.map((id) => ({ type: "entity_removed", id }));
  return changes.length === 1 ? changes[0]! : batch(changes);
}

/**
 * Turn a shape's dimension of `prop` off or on: every one it has goes, or,
 * with none, one is added as `newId` at `offset`. Undefined if the shape
 * doesn't measure that way (or isn't there).
 */
export function toggleDimension(state: DocState, target: EntityId, prop: DimensionProp, newId: EntityId, offset = DIMENSION_OFFSET): Change | undefined {
  if (!dimensionProps(state.entities[target]?.kind).includes(prop)) return undefined;
  const existing = dimensionsOf(state, target, prop);
  return existing.length > 0 ? removeAll(existing) : addDimension(newId, target, prop, offset);
}

/** Turn a rect corner's radius label off or on, as toggleDimension. Undefined for anything but a rect. */
export function toggleRadiusLabel(state: DocState, target: EntityId, corner: 0 | 1 | 2 | 3, newId: EntityId): Change | undefined {
  if (!entityAs(state, target, KINDS.rect)) return undefined;
  const existing = radiusLabelsOf(state, target, corner);
  return existing.length > 0 ? removeAll(existing) : addRadiusLabel(newId, target, corner);
}

/** Move a dimension to `offset` (signed: see the top of this file). Undefined if `id` isn't a dimension or it's already there. */
export function setDimensionOffset(state: DocState, id: EntityId, offset: number): Change | undefined {
  const d = entityAs(state, id, KINDS.dimension);
  if (!d || !Number.isFinite(offset) || d.offset === offset) return undefined;
  return propsChanged(id, { offset });
}
