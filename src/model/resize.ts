// Resize handles: where they sit on a resolved shape, and the Change that
// drags one to a new point. Pure, so the canvas only has to snap the
// pointer and commit.

import type { Change, DocState } from "@sandtreader/collab/protocol";
import { batch, propsChanged, setLength } from "./actions";
import { snapNumber, type Point } from "./geometry";
import type { ResolvedShape } from "./resolve";
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

export function handlesFor(shape: ResolvedShape): HandleSpot[] {
  switch (shape.kind) {
    case "rect": {
      const cursors = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"];
      return ([0, 1, 2, 3] as const).map((corner) => ({
        handle: { kind: "rect-corner", corner },
        point: shape.corners[corner],
        anchor: shape.corners[(corner + 2) % 4 as 0 | 1 | 2 | 3],
        cursor: cursors[corner]!,
      }));
    }
    case "circle":
      return [
        { handle: { kind: "circle-centre" }, point: shape.centre, cursor: "move" },
        { handle: { kind: "circle-radius" }, point: [shape.centre[0] + shape.radius, shape.centre[1]], anchor: shape.centre, cursor: "ew-resize" },
      ];
    case "line":
      return [
        { handle: { kind: "line-end", end: 0 }, point: shape.from, anchor: shape.to, cursor: "move" },
        { handle: { kind: "line-end", end: 1 }, point: shape.to, anchor: shape.from, cursor: "move" },
      ];
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
