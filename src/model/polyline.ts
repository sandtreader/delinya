// Editing a path's nodes and segments. Each action is (state, ...) ->
// Change | undefined, undefined when there is nothing to do, like those in
// actions.ts. Node indexes are into the stored `nodes`
// (ResolvedPolyNode.index); a segment is named by its start node's (a
// closed path's closing segment by its last node's). Positions are as
// stored: a link that moves the whole path moves it on top.
//
// Every change replaces the whole `nodes` list: props_changed merges
// shallowly, and a node is one value of it.

import { type Change, type DocState, type PropValue, applyChange } from "@sandtreader/collab/protocol";
import { type Point, cubic, distance, lerp, snapNumber, splitCubic } from "./geometry";
import { type Resolved, type ResolvedPolyNode, type ResolvedPolyline, resolve } from "./resolve";
import { type Gesture, batch, deleteEntity, drawnOffset, propsChanged, shiftNodes } from "./actions";
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

/**
 * Segment `segment` of path `id` (named by its start node's stored index):
 * its two ends as resolved, and `k`, the start's place among the drawn
 * nodes. Undefined if there is no such segment (an open path's last node
 * starts none).
 */
function segmentEnds(state: DocState, id: EntityId, segment: number): { a: ResolvedPolyNode; b: ResolvedPolyNode; k: number; all: ResolvedPolyNode[]; closed: boolean } | undefined {
  const found = resolvedNode(state, id, segment);
  if (!found) return undefined;
  const { node: a, all, closed } = found;
  const k = all.indexOf(a);
  if (k === all.length - 1 && !closed) return undefined;
  return { a, b: all[(k + 1) % all.length]!, k, all, closed };
}

const same = (a: unknown, b: Point) => Array.isArray(a) && a[0] === b[0] && a[1] === b[1];

/** A resolved node's handles (smoothed ones included), to store as its own. */
function ownHandles(n: ResolvedPolyNode): { in?: [number, number]; out?: [number, number] } {
  return { ...(n.in ? { in: [n.in[0], n.in[1]] } : {}), ...(n.out ? { out: [n.out[0], n.out[1]] } : {}) };
}

/**
 * A smooth node's other handle once handle `which` is at `offset`: turned to
 * point the opposite way, keeping its own length (as drawn, so an auto
 * node's smoothed one). A zero-length offset has no direction: it stays.
 */
function opposite(n: ResolvedPolyNode, which: "in" | "out", offset: Point): Point {
  const current = n[which === "in" ? "out" : "in"] ?? [0, 0];
  const len = Math.hypot(offset[0], offset[1]);
  const keep = Math.hypot(current[0], current[1]);
  return len > 0 ? [0 - (offset[0] / len) * keep, 0 - (offset[1] / len) * keep] : [current[0], current[1]];
}

/** A handle offset to store: rounded as other stored numbers are, never -0. */
const tidy = (p: Point): [number, number] => [snapNumber(p[0]) + 0, snapNumber(p[1]) + 0];

/** Move one node (its handles go with it). Undefined if it is already there or doesn't exist. */
export function movePolyNode(state: DocState, id: EntityId, index: number, [x, y]: Point, gesture: Gesture = {}): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || (n.x === x && n.y === y)) return undefined;
  return withNode(id, nodes, index, { ...n, x, y }, gesture);
}

/**
 * Change a node's type, keeping the shape where it can. To a cusp (corner):
 * its handles as drawn, smoothed ones included, become its own. To a curve
 * (smooth): a cusp's two handles are lined up along out − in, each keeping
 * its length; with one, the other points the opposite way, a third of the
 * way to that side's neighbour (as long as the one it has, at an open
 * path's end); with none it is auto (smoothed from its neighbours until a
 * handle is dragged). Undefined if it already is that type.
 */
export function setPolyNodeType(state: DocState, id: EntityId, index: number, type: PolyNodeType): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || n.type === type) return undefined;
  const plain = { ...withoutHandles(n), type };
  const found = resolvedNode(state, id, index);
  // A node resolve dropped (a bad type, say) is just retyped.
  if (!found) return withNode(id, nodes, index, plain);
  const { node, all, closed } = found;
  if (type === "cusp") return withNode(id, nodes, index, { ...plain, ...ownHandles(node) });
  const hi = node.in, ho = node.out;
  if (hi && ho) {
    // Along out − in (or out, if they coincide), so each keeps its side.
    let [dx, dy] = [ho[0] - hi[0], ho[1] - hi[1]];
    if (dx === 0 && dy === 0) [dx, dy] = ho;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const li = Math.hypot(hi[0], hi[1]), lo = Math.hypot(ho[0], ho[1]);
      const u: Point = [dx / d, dy / d];
      return withNode(id, nodes, index, { ...plain, in: tidy([-u[0] * li, -u[1] * li]), out: tidy([u[0] * lo, u[1] * lo]) });
    }
    return withNode(id, nodes, index, plain);
  }
  const one = hi ?? ho;
  const len = one ? Math.hypot(one[0], one[1]) : 0;
  if (!one || len === 0) return withNode(id, nodes, index, plain);
  const which = hi ? "in" : "out", other = hi ? "out" : "in";
  const k = all.indexOf(node), count = all.length;
  const neighbour = other === "in"
    ? (closed || k > 0 ? all[(k - 1 + count) % count] : undefined)
    : (closed || k < count - 1 ? all[(k + 1) % count] : undefined);
  const l = neighbour ? distance(node.point, neighbour.point) / 3 : len;
  return withNode(id, nodes, index, { ...plain, [which]: [one[0], one[1]], [other]: tidy([-one[0] / len * l, -one[1] / len * l]) });
}

/**
 * Drag one handle of a node to `offset` (from the node). A cusp's handles
 * move independently: only this one changes (added if it had none; the
 * other stays as it is, absent or not). A curve's are smooth: the other
 * handle turns to point the opposite way, keeping its own length, and an
 * auto node first takes its smoothed handles as its own, so it stops
 * following its neighbours. `independent` (Alt-drag) breaks a curve into a
 * cusp instead, the other handle staying where it is drawn. Undefined if
 * nothing changes.
 */
export function setPolyHandle(
  state: DocState, id: EntityId, index: number, which: "in" | "out", offset: Point, gesture: Gesture = {}, independent = false,
): Change | undefined {
  const nodes = storedNodes(state, id);
  const n = nodes && nodeAt(nodes, index);
  if (!nodes || !n || (n.type !== "curve" && n.type !== "cusp") || !offset.every(Number.isFinite)) return undefined;
  const handle: [number, number] = [offset[0], offset[1]];
  if (n.type === "cusp") return same(n[which], offset) ? undefined : withNode(id, nodes, index, { ...n, [which]: handle }, gesture);
  const found = resolvedNode(state, id, index);
  if (!found || found.node.type !== "curve") return undefined;
  const other = which === "in" ? "out" : "in";
  if (independent) {
    const keep = found.node[other];
    return withNode(id, nodes, index, { ...withoutHandles(n), type: "cusp", [which]: handle, ...(keep ? { [other]: [keep[0], keep[1]] } : {}) }, gesture);
  }
  const turned = opposite(found.node, which, offset);
  if (same(n[which], offset) && same(n[other], turned)) return undefined;
  return withNode(id, nodes, index, { ...n, [which]: handle, [other]: turned }, gesture);
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
 * Split segment `segmentIndex` at parameter t with a new node. A straight
 * segment (no handle on it at either end) gets a cusp at the point t along
 * it; a curved one gets a curve node with handles, and the ends' handles on
 * it shortened (de Casteljau), so the drawn path doesn't change. Neighbours
 * that were auto keep their smoothed handles as their own, since their
 * neighbours change; a cusp keeps its other handle as stored. Undefined if
 * there is no such segment.
 */
export function insertPolyNode(state: DocState, id: EntityId, segmentIndex: number, t = 0.5): Change | undefined {
  const nodes = storedNodes(state, id);
  if (!nodes || !(t > 0 && t < 1)) return undefined;
  const seg = segmentEnds(state, id, segmentIndex);
  if (!seg) return undefined;
  const { a, b } = seg;
  const sa = nodeAt(nodes, a.index)!, sb = nodeAt(nodes, b.index)!;
  // Stored positions, so a link's offset stays out of it; handles are offsets either way.
  const pa = storedPoint(sa), pb = storedPoint(sb);
  const next = [...nodes];

  if (!a.out && !b.in) {
    const [x, y] = lerp(pa, pb, t);
    next.splice(a.index + 1, 0, { x: snapNumber(x), y: snapNumber(y), type: "cusp" } satisfies PolyNode);
    return propsChanged(id, { nodes: next as PropValue[] });
  }

  const plus = (p: Point, d: Point | undefined): Point => (d ? [p[0] + d[0], p[1] + d[1]] : p);
  const minus = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];
  const [left, right] = splitCubic(cubic(pa, plus(pa, a.out), plus(pb, b.in), pb), t);
  const m = left.to;
  // An end without a handle on the segment stays so: its side of the split is straight there.
  if (a.out) next[a.index] = a.type === "curve" ? { ...sa, in: a.in!, out: minus(left.c1, pa) } : { ...sa, out: minus(left.c1, pa) };
  if (b.in) next[b.index] = b.type === "curve" ? { ...sb, in: minus(right.c2, pb), out: b.out! } : { ...sb, in: minus(right.c2, pb) };
  next.splice(a.index + 1, 0, { x: m[0], y: m[1], type: "curve", in: minus(left.c2, m), out: minus(right.c1, m) } satisfies PolyNode);
  return propsChanged(id, { nodes: next as PropValue[] });
}

/** A stored node's position (checked usable by resolve before this is called). */
const storedPoint = (n: Record<string, unknown>): Point => [n.x as number, n.y as number];

/**
 * Make a segment curved or straight. Curved: handles on its ends a third
 * of the way along it, so it doesn't move until they are dragged.
 * Straight: the handles on it come off; a smooth end becomes a corner,
 * keeping its other handle as drawn (so its other segment stays). Undefined
 * if it already is, or there is no such segment.
 */
export function setPolySegmentCurved(state: DocState, id: EntityId, segment: number, curved: boolean): Change | undefined {
  const nodes = storedNodes(state, id);
  const seg = nodes && segmentEnds(state, id, segment);
  if (!nodes || !seg) return undefined;
  const { a, b } = seg;
  if (curved === !!(a.out || b.in)) return undefined;
  const sa = nodeAt(nodes, a.index)!, sb = nodeAt(nodes, b.index)!;
  const next = [...nodes];
  if (curved) {
    // Both ends are corners with no handle on this side: a smooth node always has one.
    const pa = storedPoint(sa), pb = storedPoint(sb);
    next[a.index] = { ...sa, out: tidy([(pb[0] - pa[0]) / 3, (pb[1] - pa[1]) / 3]) };
    next[b.index] = { ...sb, in: tidy([(pa[0] - pb[0]) / 3, (pa[1] - pb[1]) / 3]) };
  } else {
    next[a.index] = cornerWithout(sa, a, "out");
    next[b.index] = cornerWithout(sb, b, "in");
  }
  return propsChanged(id, { nodes: next as PropValue[] });
}

/** Stored node `s` (resolved as `r`) as a corner without handle `which`: a smooth node keeps its other handle as drawn. */
function cornerWithout(s: Record<string, unknown>, r: ResolvedPolyNode, which: "in" | "out"): Record<string, unknown> {
  if (r.type === "curve") {
    const other = which === "in" ? "out" : "in", keep = r[other];
    return { ...withoutHandles(s), type: "cusp", ...(keep ? { [other]: [keep[0], keep[1]] } : {}) };
  }
  const { [which]: _gone, ...rest } = s;
  return rest;
}

/**
 * How a bend shares out between a segment's two handles, by where it was
 * grabbed (Inkscape's weighting): all to the near handle close to an end,
 * evenly in the middle.
 */
function bendWeight(t: number): number {
  if (t <= 1 / 6) return 0;
  if (t <= 0.5) return ((6 * t - 1) / 2) ** 3 / 2;
  if (t <= 5 / 6) return (1 - ((6 * (1 - t) - 1) / 2) ** 3) / 2 + 0.5;
  return 1;
}

/**
 * Bend a segment by dragging the point at parameter t by `delta`: its
 * handles move so that point moves by exactly `delta`, the ends staying
 * put (a straight segment is first taken as a curve with handles a third
 * of the way along). t is held to 0.1–0.9. Linear in `delta` for a given
 * t, so a drag can apply each pointer move's delta in turn. A smooth end
 * stays smooth (its other handle turns to match, keeping its length); a
 * corner's other handle is untouched. Undefined for no delta or no such
 * segment.
 */
export function bendPolySegment(state: DocState, id: EntityId, segment: number, t: number, delta: Point, gesture: Gesture = {}): Change | undefined {
  const nodes = storedNodes(state, id);
  const seg = nodes && segmentEnds(state, id, segment);
  if (!nodes || !seg || !Number.isFinite(t) || !delta.every(Number.isFinite) || (delta[0] === 0 && delta[1] === 0)) return undefined;
  const { a, b } = seg;
  const sa = nodeAt(nodes, a.index)!, sb = nodeAt(nodes, b.index)!;
  const pa = storedPoint(sa), pb = storedPoint(sb);
  const straight = !a.out && !b.in;
  // Handles as offsets; a missing one on a curved segment is the node itself.
  const h1: Point = a.out ?? (straight ? [(pb[0] - pa[0]) / 3, (pb[1] - pa[1]) / 3] : [0, 0]);
  const h2: Point = b.in ?? (straight ? [(pa[0] - pb[0]) / 3, (pa[1] - pb[1]) / 3] : [0, 0]);
  const u = Math.min(0.9, Math.max(0.1, t));
  const w = bendWeight(u);
  // B1(u)·k1 + B2(u)·k2 = 1: the point at u moves by delta.
  const k1 = (1 - w) / (3 * u * (1 - u) ** 2), k2 = w / (3 * u * u * (1 - u));
  const next = [...nodes];
  // A handle the bend doesn't reach is left as it is (absent stays absent).
  if (k1 !== 0 || straight) next[a.index] = withHandle(sa, a, "out", tidy([h1[0] + delta[0] * k1, h1[1] + delta[1] * k1]));
  if (k2 !== 0 || straight) next[b.index] = withHandle(sb, b, "in", tidy([h2[0] + delta[0] * k2, h2[1] + delta[1] * k2]));
  return propsChanged(id, { nodes: next as PropValue[] }, gesture);
}

/** Stored node `s` (resolved as `r`) with handle `which` at `offset`: smooth stays smooth (as setPolyHandle), a corner's other handle stays. */
function withHandle(s: Record<string, unknown>, r: ResolvedPolyNode, which: "in" | "out", offset: [number, number]): Record<string, unknown> {
  if (r.type !== "curve") return { ...s, [which]: offset };
  return { ...s, [which]: offset, [which === "in" ? "out" : "in"]: opposite(r, which, offset) };
}

/**
 * Delete a segment. A closed path opens there, now running from the
 * segment's end round to its start. An open path splits in two: the nodes
 * up to the segment's start stay as `id`, the rest become a new path
 * (`makeId("polyline")`, on the same layer). A part left with fewer than 2
 * nodes goes (if the first, `id` keeps the second); if both do, so does the
 * path, with its links, as deleteEntity does. `ids`: the paths left, `id`
 * first. One undo step. Undefined if there is no such segment.
 */
export function deletePolySegment(
  state: DocState, id: EntityId, segment: number, makeId: (prefix: string) => EntityId,
): { change: Change; ids: EntityId[] } | undefined {
  const stored = storedNodes(state, id);
  const seg = stored && segmentEnds(state, id, segment);
  if (!stored || !seg) return undefined;
  const { a, b, k, all, closed } = seg;
  // The cut takes a neighbour from each end: an auto smooth end keeps its
  // smoothed handles as its own, so what's left doesn't change shape.
  const nodes = stored.map((n, i) => {
    const r = i === a.index ? a : i === b.index ? b : undefined;
    return r?.auto && r.in && r.out ? { ...(n as Record<string, unknown>), in: [r.in[0], r.in[1]], out: [r.out[0], r.out[1]] } : n;
  });
  if (closed) {
    const rotated = [...nodes.slice(b.index), ...nodes.slice(0, b.index)];
    return { change: propsChanged(id, { nodes: rotated as PropValue[], closed: false }), ids: [id] };
  }
  const head = nodes.slice(0, a.index + 1), tail = nodes.slice(a.index + 1);
  // Counted in usable nodes, which resolve keeps.
  const keepHead = k + 1 >= 2, keepTail = all.length - (k + 1) >= 2;
  if (!keepHead && !keepTail) {
    const change = deleteEntity(state, id);
    return change && { change, ids: [] };
  }
  if (!keepTail) return { change: propsChanged(id, { nodes: head as PropValue[] }), ids: [id] };
  if (!keepHead) return { change: propsChanged(id, { nodes: tail as PropValue[] }), ids: [id] };
  const other = makeId(KINDS.polyline);
  const layer = state.entities[id]!.props.layer;
  return {
    change: batch([
      propsChanged(id, { nodes: head as PropValue[] }),
      { type: "entity_added", id: other, kind: KINDS.polyline, props: { nodes: structuredClone(tail) as PropValue[], ...(layer !== undefined ? { layer } : {}) } },
    ]),
    ids: [id, other],
  };
}

/** Open or close a path. Undefined if it already is, or to close one of fewer than 3 nodes. */
export function setPolyClosed(state: DocState, id: EntityId, closed: boolean): Change | undefined {
  const nodes = storedNodes(state, id);
  if (!nodes) return undefined;
  if ((state.entities[id]!.props.closed === true) === closed) return undefined;
  if (closed && nodes.length < 3) return undefined;
  return propsChanged(id, { closed });
}

// ---- Breaking and joining ----

/** A node of a path: the path and the node's stored index (the editor's NodeRef). */
export interface PolyNodeRef {
  shape: EntityId;
  index: number;
}

/**
 * The end node `ref` names, if it is the first or last drawn node of an
 * open path: the path, the node and which end. Undefined otherwise.
 */
export function polyEnd(r: Resolved, ref: PolyNodeRef): { shape: ResolvedPolyline; node: ResolvedPolyNode; first: boolean } | undefined {
  const s = Object.hasOwn(r.shapes, ref.shape) ? r.shapes[ref.shape] : undefined;
  if (s?.kind !== "polyline" || s.closed) return undefined;
  const first = s.nodes[0]!, last = s.nodes[s.nodes.length - 1]!;
  if (first.index === ref.index) return { shape: s, node: first, first: true };
  if (last.index === ref.index) return { shape: s, node: last, first: false };
  return undefined;
}

/** Stored node `n` (resolved as `r`) as a corner with only handle `which`, as drawn, if it has one. */
function cornerWith(n: Record<string, unknown>, r: ResolvedPolyNode, which: "in" | "out"): Record<string, unknown> {
  const h = r[which];
  return { ...withoutHandles(n), type: "cusp", ...(h ? { [which]: [h[0], h[1]] } : {}) };
}

/**
 * Break a path apart at a node, leaving two end nodes on top of each other:
 * corners, each keeping the handle its own side uses (as drawn, so an auto
 * node's smoothed one), so nothing moves. An open path splits in two: the
 * nodes up to this one stay as `id`, those from it on become a new path
 * (`makeId("polyline")`, on the same layer). A closed path opens there,
 * running from the node round to itself. `ids`: the paths, `id` first;
 * `node`: the stored index in `id` of the end left on the spot (the first
 * part's last node; a closed path's last). One undo step. Undefined at an
 * open path's end, or no such node.
 */
export function breakPolyNode(
  state: DocState, id: EntityId, index: number, makeId: (prefix: string) => EntityId,
): { change: Change; ids: EntityId[]; node: number } | undefined {
  const stored = storedNodes(state, id);
  const found = stored && resolvedNode(state, id, index);
  if (!stored || !found) return undefined;
  const { node, all, closed } = found;
  const n = nodeAt(stored, index)!;
  // Neighbours keep theirs, so auto nodes beside the break smooth as before.
  const head = cornerWith(n, node, "in"), tail = cornerWith(n, node, "out");
  if (closed) {
    const nodes = [tail, ...stored.slice(index + 1), ...stored.slice(0, index), head];
    return { change: propsChanged(id, { nodes: nodes as PropValue[], closed: false }), ids: [id], node: nodes.length - 1 };
  }
  const k = all.indexOf(node);
  if (k === 0 || k === all.length - 1) return undefined;
  const other = makeId(KINDS.polyline);
  const layer = state.entities[id]!.props.layer;
  return {
    change: batch([
      propsChanged(id, { nodes: [...stored.slice(0, index), head] as PropValue[] }),
      { type: "entity_added", id: other, kind: KINDS.polyline, props: { nodes: structuredClone([tail, ...stored.slice(index + 1)]) as PropValue[], ...(layer !== undefined ? { layer } : {}) } },
    ]),
    ids: [id, other],
    node: index,
  };
}

/** Whether two handles point opposite ways, in line (within a small angle). */
function opposed(a: Point, b: Point): boolean {
  const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
  if (la === 0 || lb === 0) return false;
  return a[0] * b[0] + a[1] * b[1] < 0 && Math.abs(a[0] * b[1] - a[1] * b[0]) <= 1e-6 * la * lb;
}

/**
 * Two ends merged into stored node `base`'s place: `hin` from one, `hout`
 * from the other. Smooth if they line up opposite (so a smooth node broken
 * apart joins back smooth), else a corner.
 */
function mergedNode(base: Record<string, unknown>, hin: Point | undefined, hout: Point | undefined): Record<string, unknown> {
  const type = hin && hout && opposed(hin, hout) ? "curve" : "cusp";
  return { ...withoutHandles(base), type, ...(hin ? { in: [hin[0], hin[1]] } : {}), ...(hout ? { out: [hout[0], hout[1]] } : {}) };
}

/** A stored node of a path turned round: its handles swap sides. */
function turned(n: unknown): unknown {
  if (n === null || typeof n !== "object" || Array.isArray(n)) return n;
  const { in: hin, out: hout, ...rest } = n as Record<string, unknown>;
  return { ...rest, ...(hout !== undefined ? { in: hout } : {}), ...(hin !== undefined ? { out: hin } : {}) };
}

/**
 * Join two end nodes of open paths into one node (wherever b is, it comes
 * to a). The two ends of one path close it: they merge at the first node,
 * with the last's in and the first's out, and the last goes (undefined if
 * fewer than 3 nodes would be left). Ends of two paths make one path, kept
 * as a's: a's path runs to a, then on through b's (each turned round if
 * need be, handles swapping sides), b's nodes brought into a's stored
 * frame (a link may draw either away from its nodes); b's path is deleted
 * with its links, as deleteEntity does. The merged node has the in its
 * side of the path uses and the out of the other, smooth if they line up
 * opposite, else a corner; an auto end's smoothed handles are kept, so
 * nothing else moves. `node`: the merged node's stored index. One undo
 * step. Undefined unless a and b are different ends of open paths.
 */
export function joinPolyEnds(state: DocState, a: PolyNodeRef, b: PolyNodeRef): { change: Change; node: number } | undefined {
  const r = resolve(state);
  const ea = polyEnd(r, a), eb = polyEnd(r, b);
  if (!ea || !eb || ea.node === eb.node) return undefined;

  if (a.shape === b.shape) {
    const { nodes: all } = ea.shape;
    if (all.length - 1 < 3) return undefined;
    const first = all[0]!, last = all[all.length - 1]!;
    const stored = storedNodes(state, a.shape)!;
    const nodes = stored
      .map((n, i) => (i === first.index ? mergedNode(n as Record<string, unknown>, last.in, first.out) : n))
      .filter((_, i) => i !== last.index);
    return { change: propsChanged(a.shape, { nodes: nodes as PropValue[], closed: true }), node: first.index };
  }

  // b's path goes first: a link anchored on it writes a's position back.
  const gone = deleteEntity(state, b.shape)!;
  const after = applyChange(state, gone);
  const sa = resolve(after).shapes[a.shape];
  const storedA = storedNodes(after, a.shape), storedB = storedNodes(state, b.shape)!;
  if (sa?.kind !== "polyline" || !storedA) return undefined;

  // a's path running up to a, then b's on from b, without a and b themselves.
  const headA = ea.first ? storedA.slice(a.index + 1).reverse().map(turned) : storedA.slice(0, a.index);
  const restB = eb.first ? storedB.slice(b.index + 1) : storedB.slice(0, b.index).reverse().map(turned);
  const [ax, ay] = drawnOffset(after, sa), [bx, by] = drawnOffset(state, eb.shape);
  const dx = bx - ax, dy = by - ay;
  const merged = mergedNode(
    nodeAt(storedA, a.index)!,
    ea.first ? ea.node.out : ea.node.in,
    eb.first ? eb.node.out : eb.node.in,
  );
  const nodes = [...headA, merged, ...shiftNodes(restB, dx, dy, dx !== 0 || dy !== 0)];
  const props: Record<string, PropValue> = { nodes: nodes as PropValue[] };
  // Stored closed but drawn open (too few nodes): it stays open.
  if (after.entities[a.shape]!.props.closed === true) props.closed = false;
  return {
    change: batch([...(gone.type === "batch" ? gone.changes : [gone]), propsChanged(a.shape, props)]),
    node: headA.length,
  };
}
