// Resize handles: where they sit on a resolved shape, and the Change that
// drags one to a new point. Pure, so the canvas only has to snap the
// pointer and commit.

import type { Change, DocState, Props } from "@sandtreader/collab/protocol";
import { batch, propsChanged, setLength } from "./actions";
import { snapNumber, type Point } from "./geometry";
import type { LinkLock, LinkLocks, ResolvedShape } from "./resolve";
import type { EntityId } from "./types";

export type Handle =
  | { kind: "rect-corner"; corner: 0 | 1 | 2 | 3 }
  | { kind: "circle-centre" }
  | { kind: "circle-radius" }
  | { kind: "line-end"; end: 0 | 1 };

export interface HandleSpot {
  handle: Handle;
  point: Point;
  /** The point that stays put while this handle is dragged, if any. */
  anchor?: Point;
  /** CSS cursor hint. */
  cursor: string;
}

type Side = "min" | "max";

/**
 * Whether a rect corner on the `side` of an axis can move along it: a held
 * edge can't, since moving it would move the point the link holds.
 */
function cornerMoves(lock: LinkLock | undefined, side: Side): boolean {
  if (!lock || lock.mode === "centre") return true;
  return lock.mode === "start" ? side === "max" : side === "min";
}

const xSide = (corner: 0 | 1 | 2 | 3): Side => (corner === 1 || corner === 2 ? "max" : "min");
const ySide = (corner: 0 | 1 | 2 | 3): Side => (corner >= 2 ? "max" : "min");

/** The cursor for a handle that can move on x, y, both (`both`) or neither. */
function cursorFor(both: string, x: boolean, y: boolean): string {
  return x && y ? both : x ? "ew-resize" : y ? "ns-resize" : "not-allowed";
}

/**
 * Handles for a shape, with cursors saying which way each can go given the
 * points its links hold (see linkLocks).
 */
export function handlesFor(shape: ResolvedShape, locks: LinkLocks = {}): HandleSpot[] {
  switch (shape.kind) {
    case "rect": {
      const cursors = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"];
      return ([0, 1, 2, 3] as const).map((corner) => ({
        handle: { kind: "rect-corner", corner },
        point: shape.corners[corner],
        anchor: shape.corners[(corner + 2) % 4 as 0 | 1 | 2 | 3],
        cursor: cursorFor(cursors[corner]!, cornerMoves(locks.x, xSide(corner)), cornerMoves(locks.y, ySide(corner))),
      }));
    }
    case "circle": {
      const [cx, cy] = shape.centre;
      // Held at the right, only the left can follow the pointer.
      const rx = locks.x?.mode === "end" ? cx - shape.radius : cx + shape.radius;
      return [
        { handle: { kind: "circle-centre" }, point: shape.centre, cursor: cursorFor("move", !locks.x, !locks.y) },
        { handle: { kind: "circle-radius" }, point: [rx, cy], anchor: shape.centre, cursor: "ew-resize" },
      ];
    }
    case "line": {
      const cursor = cursorFor("move", !locks.x, !locks.y);
      return [
        { handle: { kind: "line-end", end: 0 }, point: shape.from, anchor: shape.to, cursor },
        { handle: { kind: "line-end", end: 1 }, point: shape.to, anchor: shape.from, cursor },
      ];
    }
    // Paths are edited by their nodes, not resized.
    case "polyline":
      return [];
  }
}

/**
 * The change that puts `handle` of shape `id` at `p`, with `anchor` the
 * point captured from the resolved shape when the drag began. Returns
 * undefined when the result would be degenerate (zero size).
 */
export function resizeTo(state: DocState, id: EntityId, handle: Handle, p: Point, anchor: Point | undefined): Change | undefined {
  const e = state.entities[id];
  if (!e) return undefined;
  switch (handle.kind) {
    case "rect-corner": {
      if (!anchor) return undefined;
      const width = snapNumber(Math.abs(p[0] - anchor[0]));
      const height = snapNumber(Math.abs(p[1] - anchor[1]));
      if (width === 0 || height === 0) return undefined;
      const changes: Change[] = [propsChanged(id, { x: Math.min(p[0], anchor[0]), y: Math.min(p[1], anchor[1]) })];
      const w = setLength(state, id, "width", width);
      const h = setLength(state, id, "height", height);
      if (w) changes.push(w);
      if (h) changes.push(h);
      return batch(changes);
    }
    case "circle-centre":
      return propsChanged(id, { cx: p[0], cy: p[1] });
    case "circle-radius": {
      const centre = anchor ?? [e.props.cx as number, e.props.cy as number];
      const diameter = snapNumber(2 * Math.hypot(p[0] - centre[0], p[1] - centre[1]));
      if (diameter === 0) return undefined;
      return setLength(state, id, "diameter", diameter);
    }
    case "line-end": {
      if (!anchor) return undefined;
      // Dragging the end: start stays. Dragging the start: end (the anchor) stays.
      const [from, to] = handle.end === 1 ? [anchor, p] : [p, anchor];
      const length = snapNumber(Math.hypot(to[0] - from[0], to[1] - from[1]));
      if (length === 0) return undefined;
      const angle = snapNumber((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
      const changes: Change[] = [];
      if (handle.end === 0) changes.push(propsChanged(id, { x: from[0], y: from[1], angle }));
      else changes.push(propsChanged(id, { angle }));
      const l = setLength(state, id, "length", length);
      if (l) changes.push(l);
      return batch(changes);
    }
  }
}

/** One axis of a rect corner drag: the new minimum (unlocked only) and size, "still", or undefined if degenerate. */
function rectAxis(lock: LinkLock | undefined, side: Side, p: number, anchor: number): { min?: number; size: number } | "still" | undefined {
  let size: number;
  if (!lock) {
    size = snapNumber(Math.abs(p - anchor));
    return size > 0 ? { min: Math.min(p, anchor), size } : undefined;
  }
  switch (lock.mode) {
    case "start": if (side === "min") return "still"; size = p - lock.at; break;
    case "end": if (side === "max") return "still"; size = lock.at - p; break;
    case "centre": size = 2 * Math.abs(p - lock.at); break;
  }
  size = snapNumber(size);
  return size > 0 ? { size } : undefined;
}

/**
 * Drag a handle (`spot`, from handlesFor with the same `locks`) to `p`,
 * keeping still the points links hold: the handle follows the pointer only
 * where that doesn't move a held point. Without locks, exactly resizeTo.
 * Positions on locked axes are derived, so they are never written.
 */
export function dragHandle(state: DocState, id: EntityId, spot: HandleSpot, p: Point, locks: LinkLocks = {}): Change | undefined {
  const handle = spot.handle;
  if (!locks.x && !locks.y) return resizeTo(state, id, handle, p, spot.anchor);
  switch (handle.kind) {
    case "rect-corner": {
      if (!spot.anchor) return undefined;
      const ax = rectAxis(locks.x, xSide(handle.corner), p[0], spot.anchor[0]);
      const ay = rectAxis(locks.y, ySide(handle.corner), p[1], spot.anchor[1]);
      if (!ax || !ay || (ax === "still" && ay === "still")) return undefined;
      const pos: Props = {};
      if (ax !== "still" && ax.min !== undefined) pos.x = ax.min;
      if (ay !== "still" && ay.min !== undefined) pos.y = ay.min;
      const changes: Change[] = [];
      if (Object.keys(pos).length > 0) changes.push(propsChanged(id, pos));
      const w = ax !== "still" ? setLength(state, id, "width", ax.size) : undefined;
      const h = ay !== "still" ? setLength(state, id, "height", ay.size) : undefined;
      if (w) changes.push(w);
      if (h) changes.push(h);
      return batch(changes);
    }
    case "circle-centre": {
      if (locks.x && locks.y) return undefined;
      return propsChanged(id, locks.x ? { cy: p[1] } : { cx: p[0] });
    }
    case "circle-radius": {
      const lock = locks.x;
      if (!lock) return resizeTo(state, id, handle, p, spot.anchor);
      // The handle sits on the side that can move (see handlesFor), so its x gives the diameter.
      const d = lock.mode === "start" ? p[0] - lock.at : lock.mode === "end" ? lock.at - p[0] : 2 * Math.abs(p[0] - lock.at);
      const diameter = snapNumber(d);
      return diameter > 0 ? setLength(state, id, "diameter", diameter) : undefined;
    }
    case "line-end": {
      if (locks.x && locks.y) return undefined;
      const q: Point = [locks.x ? spot.point[0] : p[0], locks.y ? spot.point[1] : p[1]];
      return resizeTo(state, id, handle, q, spot.anchor);
    }
  }
}
