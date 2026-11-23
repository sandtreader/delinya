// Turning and mirroring shapes: the selection panel's Rotate group and a
// rect's rotation field. Each shape is turned as drawn (a link may place it
// away from its stored position) and written back as stored props: a line's
// start and angle, a circle's centre, a path's nodes and handles, a rect's or
// text box's (x, y) corner and rotation (and a text box's mirror flag when
// flipped). Sizes are never touched, so linked lengths stay linked. Numbers
// are snapped, so quarter turns come out exact, and angles are stored in
// [0, 360). One Change per call, so it undoes in one step.

import type { Change, DocState, PropValue } from "@sandtreader/collab/protocol";
import { type Point, midpoint, normaliseAngle, rotatePoint, snapXY, unionBounds } from "./geometry";
import { type Resolved, type ResolvedPolyline, type ResolvedShape, resolve } from "./resolve";
import { batch, drawnOffset, propsChanged } from "./actions";
import { type Axis, type EntityId, KINDS, entitiesOfKind } from "./types";

/**
 * Turn the shapes among `ids` (others are ignored) by `degrees`, clockwise
 * on screen, about `pivot`: by default the centre of the bounds they make
 * together. Undefined with no shapes or for a whole number of turns.
 */
export function rotateShapes(state: DocState, ids: EntityId[], degrees: number, pivot?: Point): Change | undefined {
  if (!Number.isFinite(degrees)) return undefined;
  const turn = normaliseAngle(degrees);
  if (turn === 0) return undefined;
  const r = resolve(state);
  const shapes = shapesAmong(r, ids);
  if (shapes.length === 0) return undefined;
  const about = pivot ?? centreOf(shapes);
  const point = (p: Point) => snapXY(rotatePoint(p, turn, about));
  const vector = (v: Point) => snapXY(rotatePoint(v, turn));
  return one(shapes.map((s) => {
    switch (s.kind) {
      case "line": {
        const [x, y] = point(s.from);
        return propsChanged(s.id, { x, y, angle: normaliseAngle(s.angle + turn) });
      }
      case "circle": {
        const [cx, cy] = point(s.centre);
        return propsChanged(s.id, { cx, cy });
      }
      case "rect":
      case "text": {
        const [x, y] = point([s.x, s.y]);
        return propsChanged(s.id, { x, y, rotation: normaliseAngle(s.rotation + turn) });
      }
      case "polyline":
        return propsChanged(s.id, { nodes: mapNodes(state, s, point, vector) });
    }
  }));
}

/** The stored props rotateShapes writes for each kind of shape. */
const TURNED_PROPS: Record<ResolvedShape["kind"], readonly string[]> = {
  line: ["x", "y", "angle"],
  circle: ["cx", "cy"],
  rect: ["x", "y", "rotation"],
  polyline: ["nodes"],
  text: ["x", "y", "rotation"],
};

/**
 * The change that puts the shapes among `ids` where `base` has them, turned
 * by `degrees` about `pivot`: for a live drag, committed over wherever the
 * last move left them. As rotateShapes, except that no turn writes the
 * props it would turn back as `base` stores them (an absent one removed),
 * so a drag can return to where it began. Every prop is absolute. Undefined
 * with no shapes.
 */
export function turnTo(base: DocState, ids: EntityId[], degrees: number, pivot: Point): Change | undefined {
  if (!Number.isFinite(degrees)) return undefined;
  if (normaliseAngle(degrees) !== 0) return rotateShapes(base, ids, degrees, pivot);
  const shapes = shapesAmong(resolve(base), ids);
  if (shapes.length === 0) return undefined;
  return one(shapes.map((s) => {
    const stored = base.entities[s.id]!.props;
    const props: Record<string, PropValue> = {};
    for (const k of TURNED_PROPS[s.kind]) props[k] = Object.hasOwn(stored, k) ? structuredClone(stored[k]!) : null;
    return propsChanged(s.id, props);
  }));
}

/** Old corner index -> new, for a rect mirrored on each axis. Each is its own inverse. */
const MIRRORED_CORNER: Record<Axis, readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3]> = {
  // Left and right swap: tl <-> tr, br <-> bl.
  x: [1, 0, 3, 2],
  // Top and bottom swap: tl <-> bl, tr <-> br.
  y: [3, 2, 1, 0],
};

/**
 * Mirror the shapes among `ids` (others are ignored) about `pivot`, by
 * default the centre of their bounds together: axis "x" flips left to right
 * across the vertical line through it, "y" top to bottom across the
 * horizontal one. A rect stays a rect, turned the other way, so its (x, y)
 * corner and its corner radii change places; radius labels follow their
 * corner. A text box mirrors its text: see the "text" case. Undefined with no
 * shapes.
 */
export function flipShapes(state: DocState, ids: EntityId[], axis: Axis, pivot?: Point): Change | undefined {
  const r = resolve(state);
  const shapes = shapesAmong(r, ids);
  if (shapes.length === 0) return undefined;
  const about = pivot ?? centreOf(shapes);
  const point = (p: Point): Point => snapXY(axis === "x" ? [2 * about[0] - p[0], p[1]] : [p[0], 2 * about[1] - p[1]]);
  // 0 - v, not -v, so a zero is never -0.
  const vector = (v: Point): Point => snapXY(axis === "x" ? [0 - v[0], v[1]] : [v[0], 0 - v[1]]);
  const changes: Change[] = [];
  for (const s of shapes) {
    switch (s.kind) {
      case "line": {
        const [x, y] = point(s.from);
        changes.push(propsChanged(s.id, { x, y, angle: normaliseAngle(axis === "x" ? 180 - s.angle : 0 - s.angle) }));
        break;
      }
      case "circle": {
        const [cx, cy] = point(s.centre);
        changes.push(propsChanged(s.id, { cx, cy }));
        break;
      }
      case "polyline":
        changes.push(propsChanged(s.id, { nodes: mapNodes(state, s, point, vector) }));
        break;
      case "rect": {
        // The mirror image turns the other way; its new (x, y) corner is the
        // mirror of the old top-right (x flip) or bottom-left (y flip).
        const map = MIRRORED_CORNER[axis];
        const [x, y] = point(s.corners[axis === "x" ? 1 : 3]);
        const props: Record<string, PropValue> = { x, y, rotation: normaliseAngle(0 - s.rotation) };
        const stored = state.entities[s.id]!.props.r;
        // Moved as stored: a linked radius stays linked.
        if (Array.isArray(stored) && stored.length === 4) props.r = map.map((k) => structuredClone(stored[k]!));
        changes.push(propsChanged(s.id, props));
        for (const [labelId, label] of entitiesOfKind(state, KINDS.radiusLabel)) {
          if (label.target !== s.id) continue;
          // Read as resolve reads it: anything but a corner index is the top left.
          const corner = map[([0, 1, 2, 3] as const).includes(label.corner) ? label.corner : 0];
          if (corner !== label.corner) changes.push(propsChanged(labelId, { corner }));
        }
        break;
      }
      case "text": {
        // Its frame flips the way a rect's does across the vertical, from the
        // mirror of its old top-right corner turned −r, and its text reads
        // backwards in it. A flip top to bottom is that flip followed by a
        // half turn about the pivot (two reflections across perpendicular
        // lines make one), which puts the corner at the old top-right's
        // mirror across the horizontal and turns it a further 180°.
        const [x, y] = point(s.corners[1]);
        const rotation = normaliseAngle((axis === "x" ? 0 : 180) - s.rotation);
        changes.push(propsChanged(s.id, { x, y, rotation, mirror: !s.mirror }));
        break;
      }
    }
  }
  return one(changes);
}

/**
 * Turn a rect or text box to `degrees` (clockwise on screen) about its own
 * centre, so it spins in place. Undefined if `id` is neither or it is
 * already at that angle.
 */
export function setRotation(state: DocState, id: EntityId, degrees: number): Change | undefined {
  const kind = state.entities[id]?.kind;
  if ((kind !== KINDS.rect && kind !== KINDS.text) || !Number.isFinite(degrees)) return undefined;
  const s = resolve(state).shapes[id];
  if (s?.kind !== "rect" && s?.kind !== "text") return undefined;
  const rotation = normaliseAngle(degrees);
  if (rotation === s.rotation) return undefined;
  const [x, y] = snapXY(rotatePoint([s.x, s.y], rotation - s.rotation, midpoint(s.corners[0], s.corners[2])));
  return propsChanged(id, { x, y, rotation });
}

/** The shapes among `ids`, each once, in order. */
function shapesAmong(r: Resolved, ids: EntityId[]): ResolvedShape[] {
  return [...new Set(ids)].filter((id) => Object.hasOwn(r.shapes, id)).map((id) => r.shapes[id]!);
}

function centreOf(shapes: ResolvedShape[]): Point {
  const b = unionBounds(shapes.map((s) => s.bounds));
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** One change as itself, several as a batch. */
function one(changes: Change[]): Change {
  return changes.length === 1 ? changes[0]! : batch(changes);
}

/**
 * A path's stored nodes, each moved from where it is drawn by `point`, its
 * handles (offsets) by `vector`. Other fields are kept, absent handles stay
 * absent, and nodes or handles resolve can't read are left as they are.
 */
function mapNodes(state: DocState, s: ResolvedPolyline, point: (p: Point) => Point, vector: (v: Point) => Point): PropValue[] {
  const [ox, oy] = drawnOffset(state, s);
  const nodes = state.entities[s.id]!.props.nodes;
  return (Array.isArray(nodes) ? nodes : []).map((n) => {
    const copy = structuredClone(n);
    if (!isRecord(copy) || !isNum(copy.x) || !isNum(copy.y)) return copy;
    [copy.x, copy.y] = point([copy.x + ox, copy.y + oy]);
    for (const k of ["in", "out"] as const) {
      const h = copy[k];
      if (Array.isArray(h) && h.length === 2 && isNum(h[0]) && isNum(h[1])) copy[k] = vector([h[0], h[1]]);
    }
    return copy;
  });
}

function isRecord(v: unknown): v is Record<string, PropValue> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
