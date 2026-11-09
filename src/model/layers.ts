// Layers: queries over the resolved layers and the actions that edit them.
//
// A drawing with no layer entities has one implicit base layer at
// BASE_LAYER_ID (see resolve.ts). Actions that need a real layer entity
// materialise the base first, in the same change, so a drawing only grows
// layer entities once someone uses layers.

import { applyChange, type Change, type DocState, type Props } from "@sandtreader/collab/protocol";
import { batch, deleteEntity, propsChanged } from "./actions";
import { type Resolved, type StoredLayer, resolve, storedLayers } from "./resolve";
import { type EntityId, BASE_LAYER_ID, KINDS, entityAs } from "./types";

// ---- Queries ----

/** The ID of a shape's layer; undefined if it is not a shape. */
function layerOf(r: Resolved, id: EntityId): EntityId | undefined {
  return Object.hasOwn(r.shapes, id) ? r.shapes[id]!.layer : undefined;
}

/**
 * Which layers this viewer has hidden and locked: their own choice, held in
 * editor state, never in the document (so not synced, saved or undoable).
 */
export interface LayerView {
  hidden: ReadonlySet<EntityId>;
  locked: ReadonlySet<EntityId>;
}

/** Whether a shape exists and its layer is not among the `hidden` layer IDs. */
export function isVisible(r: Resolved, id: EntityId, hidden: ReadonlySet<EntityId>): boolean {
  const l = layerOf(r, id);
  return l !== undefined && !hidden.has(l);
}

/** Whether a shape exists and its layer is neither hidden nor locked in `view`. */
export function isSelectable(r: Resolved, id: EntityId, view: LayerView): boolean {
  const l = layerOf(r, id);
  return l !== undefined && !view.hidden.has(l) && !view.locked.has(l);
}

/** The one layer all the given shapes are on; undefined if mixed or none. Non-shapes are ignored. */
export function layerChoice(r: Resolved, ids: EntityId[]): EntityId | undefined {
  const layers = new Set(ids.filter((id) => Object.hasOwn(r.shapes, id)).map((id) => r.shapes[id]!.layer));
  return layers.size === 1 ? [...layers][0] : undefined;
}

// ---- Actions ----

/** Add a layer in front of the rest, making the implicit base layer real first if need be. */
export function addLayer(state: DocState, id: EntityId, name?: string): Change {
  const stored = storedLayers(state);
  const props: Props = { order: stored.length === 0 ? 1 : stored[stored.length - 1]!.order + 1 };
  if (name) props.name = name;
  const add: Change = { type: "entity_added", id, kind: KINDS.layer, props };
  if (stored.length > 0) return add;
  return batch([{ type: "entity_added", id: BASE_LAYER_ID, kind: KINDS.layer, props: { order: 0 } }, add]);
}

/**
 * Rename a layer (absent counts as ""). Undefined if the name is unchanged
 * or there is no such layer; the implicit base layer is made real to hold
 * the name.
 */
export function setLayerName(state: DocState, id: EntityId, name: string): Change | undefined {
  const layer = entityAs(state, id, KINDS.layer);
  const implicit = !layer && id === BASE_LAYER_ID && storedLayers(state).length === 0;
  if (!layer && !implicit) return undefined;
  if (name === (typeof layer?.name === "string" ? layer.name : "")) return undefined;
  if (implicit) return { type: "entity_added", id, kind: KINDS.layer, props: { order: 0, name } };
  return propsChanged(id, { name });
}

/**
 * Move a layer to position `toIndex` (0 at the back), normally by changing
 * only its own order: just behind the first, just after the last, or midway
 * between its new neighbours. When that would not sort between them (tied
 * neighbours, as when two peers add a layer at once, or orders too close
 * for a float to split) every layer is renumbered 0..n-1 in the new order
 * instead, as one batch. Undefined if unknown or already there.
 */
export function moveLayer(state: DocState, id: EntityId, toIndex: number): Change | undefined {
  const stored = storedLayers(state);
  const from = stored.findIndex((l) => l.id === id);
  if (from < 0) return undefined;
  const to = Math.max(0, Math.min(stored.length - 1, Math.trunc(toIndex) || 0));
  if (to === from) return undefined;
  const rest = stored.filter((l) => l.id !== id);
  const prev = rest[to - 1], next = rest[to];
  const order = !prev ? next!.order - 1
    : !next ? prev.order + 1
    : (prev.order + next.order) / 2;
  const moved = { id, order };
  if (Number.isFinite(order) && (!prev || layerBefore(prev, moved)) && (!next || layerBefore(moved, next))) {
    return propsChanged(id, { order });
  }
  rest.splice(to, 0, moved);
  const changes = rest
    .map((l, i) => ({ id: l.id, i }))
    .filter(({ id: lid, i }) => state.entities[lid]!.props.order !== i)
    .map(({ id: lid, i }) => propsChanged(lid, { order: i }));
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/** Whether `a` sorts strictly before `b` as storedLayers sorts them: by order, ties by ID. */
function layerBefore(a: StoredLayer, b: StoredLayer): boolean {
  return a.order < b.order || (a.order === b.order && a.id < b.id);
}

/** Put shapes on a layer, skipping any already on it. Undefined if none move or there is no such layer. */
export function setShapesLayer(state: DocState, ids: EntityId[], layerId: EntityId): Change | undefined {
  const r = resolve(state);
  if (!r.layers.some((l) => l.id === layerId)) return undefined;
  const changes = [...new Set(ids)]
    .filter((id) => Object.hasOwn(r.shapes, id) && r.shapes[id]!.layer !== layerId)
    .map((id) => propsChanged(id, { layer: layerId }));
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/**
 * Delete a layer with every shape on it (and, through deleteEntity, their
 * dimensions, labels and link memberships), as one undo step. Undefined for
 * an unknown layer or the only one.
 */
export function deleteLayer(state: DocState, id: EntityId): Change | undefined {
  const r = resolve(state);
  if (r.layers.length <= 1 || !r.layers.some((l) => l.id === id)) return undefined;
  const changes: Change[] = [];
  let running = state;
  for (const shapeId of r.order) {
    if (r.shapes[shapeId]!.layer !== id) continue;
    const c = deleteEntity(running, shapeId);
    if (c) { changes.push(c); running = applyChange(running, c); }
  }
  if (entityAs(state, id, KINDS.layer)) changes.push({ type: "entity_removed", id });
  return batch(changes);
}
