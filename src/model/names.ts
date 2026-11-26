// Shape names. Every shape has a name: the one it was given (`name`), else
// its id. Ids never change, since dimensions, links and labels refer to
// them; a name is only for people. A shape given a name can also show it on
// the drawing (`showName`), centred in it, on screen and in print, PDF and
// SVG; an id is never shown. Text boxes have names but don't show them:
// their text is already there.

import type { Change, DocState } from "@sandtreader/collab/protocol";
import { propsChanged } from "./actions";
import type { Point } from "./geometry";
import type { ResolvedShape } from "./resolve";
import { type EntityId, isShape } from "./types";

/** The name a shape goes by: the one it was given, else its id. */
export function shapeName(s: { id: EntityId; name?: string }): string {
  return s.name || s.id;
}

/** The name a shape was given, as stored ("" for none), or undefined if `id` isn't a shape. */
export function storedName(state: DocState, id: EntityId): string | undefined {
  const e = state.entities[id];
  if (!isShape(e)) return undefined;
  return typeof e!.props.name === "string" ? e!.props.name : "";
}

/**
 * Name a shape, or clear its name with "" (it then goes by its id, and
 * stops showing a name). Surrounding space is trimmed. Undefined if `id`
 * isn't a shape or the name is the same.
 */
export function setShapeName(state: DocState, id: EntityId, name: string): Change | undefined {
  const was = storedName(state, id);
  const now = name.trim();
  if (was === undefined || now === was) return undefined;
  return propsChanged(id, now || state.entities[id]!.props.showName !== true ? { name: now } : { name: now, showName: false });
}

/** Whether a shape can show its name on the drawing: one with a name, but not a text box. */
export function canShowName(state: DocState, id: EntityId): boolean {
  const e = state.entities[id];
  return isShape(e) && e!.kind !== "text" && !!storedName(state, id)?.trim();
}

/** Whether a shape shows its name, as stored and allowed (a name, not a text box). */
export function showsName(state: DocState, id: EntityId): boolean {
  return canShowName(state, id) && state.entities[id]!.props.showName === true;
}

/** Show or hide a shape's name on the drawing. Undefined if it can't, or already does or doesn't. */
export function setShowName(state: DocState, id: EntityId, show: boolean): Change | undefined {
  if (!canShowName(state, id) || showsName(state, id) === show) return undefined;
  return propsChanged(id, { showName: show });
}

/**
 * Where a shown name goes, for text `size` high: the baseline point of a
 * line of text anchored at its middle, upright. Centred in a rectangle,
 * circle or path (an open path's bounds); just above the middle of a line.
 * Null when the shape doesn't show its name.
 */
export function namePlace(s: ResolvedShape, size: number): Point | null {
  if (!s.showName) return null;
  // A baseline this far below the centre puts the capitals' middle on it.
  const centred = ([x, y]: Point): Point => [x, y + 0.35 * size];
  switch (s.kind) {
    case "text": return null;
    case "line": return [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2 - 0.4 * size];
    case "circle": return centred(s.centre);
    case "rect": {
      const [a, , c] = s.corners;
      return centred([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
    }
    case "polyline": return centred([(s.bounds.minX + s.bounds.maxX) / 2, (s.bounds.minY + s.bounds.maxY) / 2]);
  }
}
