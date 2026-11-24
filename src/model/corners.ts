// A rect's corner radii, all together: the shape panel's "all" switch shows
// one radius and one label field for the four corners while they are alike
// (the same stored radius, one number or one variable, and at most one
// radius label), or a field per corner when switched off. Switching back on
// gives every corner the largest radius (as stored, so a variable stays
// linked) and keeps one label if any corner had one. One label standing
// for four equal corners reads "4× R10" (see `count` in resolve.ts).

import type { Change, DocState, Props } from "@sandtreader/collab/protocol";
import { addRadiusLabel, batch, propsChanged, setCornerRadius } from "./actions";
import { radiusLabelsOf } from "./dimensions";
import { lengthValue } from "./resolve";
import { type EntityId, type Length, KINDS, entityAs, isRef, toProps } from "./types";

type Corner = 0 | 1 | 2 | 3;
const CORNERS: readonly Corner[] = [0, 1, 2, 3];

/** Where the one label for all four corners goes: bottom-right, clear of the width and height dimensions. */
export const ALL_CORNERS_LABEL_CORNER: Corner = 2;

/** A rect's stored radii, [0, 0, 0, 0] when it has none; undefined if `id` isn't a rect. */
function storedRadii(state: DocState, id: EntityId): [Length, Length, Length, Length] | undefined {
  const rect = entityAs(state, id, KINDS.rect);
  if (!rect) return undefined;
  return rect.r ? [...rect.r] : [0, 0, 0, 0];
}

function sameLength(a: Length, b: Length): boolean {
  if (isRef(a) || isRef(b)) return isRef(a) && isRef(b) && a.ref === b.ref;
  return a === b;
}

/** Every radius label on the rect, corner by corner. */
function labels(state: DocState, id: EntityId): Array<{ corner: Corner; id: EntityId }> {
  return CORNERS.flatMap((corner) => radiusLabelsOf(state, id, corner).map((l) => ({ corner, id: l })));
}

/** Whether one radius and one label field can stand for all four corners. */
export function cornersAlike(state: DocState, id: EntityId): boolean {
  const r = storedRadii(state, id);
  if (!r) return false;
  return r.every((v) => sameLength(v, r[0])) && labels(state, id).length <= 1;
}

/**
 * Every corner's radius to `value`: the variable, when all four share one;
 * else all four as the number. Undefined when nothing would change, for a
 * bad value, or if `id` isn't a rect.
 */
export function setAllCornerRadii(state: DocState, id: EntityId, value: number): Change | undefined {
  const r = storedRadii(state, id);
  if (!r || !Number.isFinite(value) || value < 0) return undefined;
  const first = r[0];
  if (isRef(first) && r.every((v) => sameLength(v, first))) {
    return lengthValue(state, first) === value ? undefined : setCornerRadius(state, id, 0, value);
  }
  if (r.every((v) => v === value)) return undefined;
  return propsChanged(id, { r: toProps([value, value, value, value]) as unknown as Props["r"] });
}

/**
 * Back to all together: every corner the largest radius, as stored, and of
 * any labels only the first corner's kept. One change; undefined when the
 * corners are alike already (or `id` isn't a rect).
 */
export function joinCorners(state: DocState, id: EntityId): Change | undefined {
  const r = storedRadii(state, id);
  if (!r || cornersAlike(state, id)) return undefined;
  let largest = r[0];
  let most = lengthValue(state, largest) ?? 0;
  for (const v of r) {
    const n = lengthValue(state, v) ?? 0;
    if (n > most) { largest = v; most = n; }
  }
  const changes: Change[] = [];
  if (!r.every((v) => sameLength(v, largest))) {
    changes.push(propsChanged(id, { r: toProps([largest, largest, largest, largest]) as unknown as Props["r"] }));
  }
  for (const l of labels(state, id).slice(1)) changes.push({ type: "entity_removed", id: l.id });
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/**
 * The one label field for all four corners: off takes every label off; on
 * adds one on ALL_CORNERS_LABEL_CORNER as `newId`. Undefined if `id` isn't a rect.
 */
export function toggleAllCornersLabel(state: DocState, id: EntityId, newId: EntityId): Change | undefined {
  if (!entityAs(state, id, KINDS.rect)) return undefined;
  const existing = labels(state, id);
  if (existing.length === 0) return addRadiusLabel(newId, id, ALL_CORNERS_LABEL_CORNER);
  const changes: Change[] = existing.map((l) => ({ type: "entity_removed", id: l.id }));
  return changes.length === 1 ? changes[0] : batch(changes);
}
