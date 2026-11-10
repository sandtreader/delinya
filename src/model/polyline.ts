// Editing a path's nodes. Each action is (state, ...) -> Change | undefined,
// undefined when there is nothing to do, like those in actions.ts. Node and
// segment indexes are into the stored `nodes` (ResolvedPolyNode.index), and
// positions are as stored: a link that moves the whole path moves it on top.
//
// Every change replaces the whole `nodes` list: props_changed merges
// shallowly, and a node is one value of it.

import type { Change, DocState, PropValue } from "@sandtreader/collab/protocol";
import { type Point, cubic, lerp, snapNumber, splitCubic } from "./geometry";
import { type ResolvedPolyNode, resolve } from "./resolve";
import { type Gesture, deleteEntity, propsChanged } from "./actions";
import { type EntityId, type PolyNode, type PolyNodeType, KINDS } from "./types";

/** The stored nodes of path `id` (as stored, possibly malformed), or undefined if it isn't a path. */
function storedNodes(state: DocState, id: EntityId): unknown[] | undefined {
  const e = state.entities[id];
  if (!e || e.kind !== KINDS.polyline || !Array.isArray(e.props.nodes)) return undefined;
  return e.props.nodes;
}

/** Stored node `index` as a plain object, or undefined. */
function nodeAt(nodes: unknown[], index: number): Record<string, unknown> | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= nodes.length) return undefined;
  const n = nodes[index];
  return n !== null && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, unknown>) : undefined;
}

/** The nodes with `index` replaced by `node`, as a change to `id`. */
function withNode(id: EntityId, nodes: unknown[], index: number, node: PolyNode | Record<string, unknown>, gesture: Gesture = {}): Change {
  const next = nodes.map((n, i) => (i === index ? node : n));
  return propsChanged(id, { nodes: next as PropValue[] }, gesture);
}

/** A node object without its handles. */
function withoutHandles(n: Record<string, unknown>): Record<string, unknown> {
  const { in: _in, out: _out, ...rest } = n;
  return rest;
}

/** The resolved node at stored `index` of path `id`: its effective handles, smoothed if auto. */
function resolvedNode(state: DocState, id: EntityId, index: number): { node: ResolvedPolyNode; all: ResolvedPolyNode[]; closed: boolean } | undefined {
  const s = resolve(state).shapes[id];
  if (!s || s.kind !== "polyline") return undefined;
  const node = s.nodes.find((n) => n.index === index);
  return node ? { node, all: s.nodes, closed: s.closed } : undefined;
}

const same = (a: unknown, b: Point) => Array.isArray(a) && a[0] === b[0] && a[1] === b[1];

/** Move one node (its handles go with it). Undefined if it is already there or doesn't exist. */
export function movePolyNode(state: DocState, id: EntityId, index: number, [x, y]: Point, gesture: Gesture = {}): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || (n.x === x && n.y === y)) return undefined;
  return withNode(id, nodes, index, { ...n, x, y }, gesture);
}

/**
 * Make a node a cusp (dropping its handles) or a curve (auto: smoothed from
 * its neighbours until a handle is dragged). Undefined if it already is.
 */
export function setPolyNodeType(state: DocState, id: EntityId, index: number, type: PolyNodeType): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || n.type === type) return undefined;
  return withNode(id, nodes, index, { ...withoutHandles(n), type });
}

/**
 * Drag one handle of a curve node to `offset` (from the node). Smooth: the
 * other handle turns to point the opposite way, keeping its own length. An
 * auto node first takes its smoothed handles as its own, so it stops
 * following its neighbours. Undefined for a cusp or if nothing changes.
 */
export function setPolyHandle(state: DocState, id: EntityId, index: number, which: "in" | "out", offset: Point, gesture: Gesture = {}): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || n.type !== "curve" || !offset.every(Number.isFinite)) return undefined;
  const found = resolvedNode(state, id, index);
  if (!found || found.node.type !== "curve") return undefined;
  const other = which === "in" ? "out" : "in";
  const current = found.node[other] ?? [0, 0];
  const len = Math.hypot(offset[0], offset[1]);
  const keep = Math.hypot(current[0], current[1]);
  // A zero-length drag has no direction: the other handle stays as it is.
  const turned: Point = len > 0 ? [0 - (offset[0] / len) * keep, 0 - (offset[1] / len) * keep] : [current[0], current[1]];
  if (same(n[which], offset) && same(n[other], turned)) return undefined;
  return withNode(id, nodes, index, { ...n, [which]: [offset[0], offset[1]], [other]: turned }, gesture);
}

/**
 * Delete one node. A path left with fewer than 2 nodes is deleted whole
 * (with its dimensions and links, as deleteEntity does); a closed path left
 * with fewer than 3 opens.
 */
export function deletePolyNode(state: DocState, id: EntityId, index: number): Change | undefined {
  const nodes = storedNodes(state, id);
  if (!nodes || !Number.isInteger(index) || index < 0 || index >= nodes.length) return undefined;
  const rest = nodes.filter((_, i) => i !== index);
  if (rest.length < 2) return deleteEntity(state, id);
  const props: Record<string, PropValue> = { nodes: rest as PropValue[] };
  if (rest.length < 3 && state.entities[id]!.props.closed === true) props.closed = false;
  return propsChanged(id, props);
}

/**
 * Split segment `segmentIndex` (the one starting at that node) at parameter
 * t with a new node. A straight segment gets a cusp at the point t along it;
 * a curve gets a curve node with handles, and the neighbours' adjoining
 * handles shortened (de Casteljau), so the drawn path doesn't change.
 * Neighbours that were auto keep their smoothed handles as their own, since
 * their neighbours change. Undefined if there is no such segment.
 */
export function insertPolyNode(state: DocState, id: EntityId, segmentIndex: number, t = 0.5): Change | undefined {
  const nodes = storedNodes(state, id);
  if (!nodes || !(t > 0 && t < 1)) return undefined;
  const found = resolvedNode(state, id, segmentIndex);
  if (!found) return undefined;
  const { node: a, all, closed } = found;
  const k = all.indexOf(a);
  if (k === all.length - 1 && !closed) return undefined;
  const b = all[(k + 1) % all.length]!;
  const sa = nodeAt(nodes, a.index)!, sb = nodeAt(nodes, b.index)!;
  // Stored positions, so a link's offset stays out of it; handles are offsets either way.
  const pa: Point = [sa.x as number, sa.y as number], pb: Point = [sb.x as number, sb.y as number];
  const next = [...nodes];

  if (a.type === "cusp" && b.type === "cusp") {
    const [x, y] = lerp(pa, pb, t);
    next.splice(a.index + 1, 0, { x: snapNumber(x), y: snapNumber(y), type: "cusp" } satisfies PolyNode);
    return propsChanged(id, { nodes: next as PropValue[] });
  }

  const plus = (p: Point, d: Point | undefined): Point => (d ? [p[0] + d[0], p[1] + d[1]] : p);
  const minus = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];
  const [left, right] = splitCubic(cubic(pa, a.type === "curve" ? plus(pa, a.out) : pa, b.type === "curve" ? plus(pb, b.in) : pb, pb), t);
  const m = left.to;
  if (a.type === "curve") next[a.index] = { ...sa, in: a.in!, out: minus(left.c1, pa) };
  if (b.type === "curve") next[b.index] = { ...sb, in: minus(right.c2, pb), out: b.out! };
  next.splice(a.index + 1, 0, { x: m[0], y: m[1], type: "curve", in: minus(left.c2, m), out: minus(right.c1, m) } satisfies PolyNode);
  return propsChanged(id, { nodes: next as PropValue[] });
}

/** Open or close a path. Undefined if it already is, or to close one of fewer than 3 nodes. */
export function setPolyClosed(state: DocState, id: EntityId, closed: boolean): Change | undefined {
  const nodes = storedNodes(state, id);
  if (!nodes) return undefined;
  if ((state.entities[id]!.props.closed === true) === closed) return undefined;
  if (closed && nodes.length < 3) return undefined;
  return propsChanged(id, { closed });
}
