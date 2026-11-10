// Hit-testing a selected path's nodes, handles and segments, in drawn
// (resolved) mm. Results are stored node indexes (ResolvedPolyNode.index),
// as the node actions in model/polyline.ts take. Any shape may be passed;
// only a path has nodes.

import {
  cubicPoint, distance, distanceToSegment, isVisible, polyEnd,
  type Cubic, type EntityId, type Point, type PolyNodeRef, type Resolved, type ResolvedShape, type Segment, type SnapPoint,
} from "../model";

/** The stored index of the node nearest `point`, within `tolerance` mm; null if none. */
export function nodeAt(poly: ResolvedShape, point: Point, tolerance: number): number | null {
  if (poly.kind !== "polyline") return null;
  let best: number | null = null, bestD = Infinity;
  for (const n of poly.nodes) {
    const d = distance(n.point, point);
    if (d <= tolerance && d < bestD) { best = n.index; bestD = d; }
  }
  return best;
}

/**
 * The handles a node shows and can be dragged by, as drawn points: a curve
 * node's in and out (its own, or smoothed when auto) or those a cusp has,
 * less the one an open path's end doesn't use.
 */
export function nodeHandles(poly: ResolvedShape, index: number): Array<{ which: "in" | "out"; point: Point }> {
  if (poly.kind !== "polyline") return [];
  const k = poly.nodes.findIndex((n) => n.index === index);
  const n = poly.nodes[k];
  if (!n) return [];
  const out: Array<{ which: "in" | "out"; point: Point }> = [];
  const at = (d: Point): Point => [n.point[0] + d[0], n.point[1] + d[1]];
  if (n.in && (poly.closed || k > 0)) out.push({ which: "in", point: at(n.in) });
  if (n.out && (poly.closed || k < poly.nodes.length - 1)) out.push({ which: "out", point: at(n.out) });
  return out;
}

/**
 * The handles on a segment (named by its start node's stored index), as
 * drawn points: its start's out and its end's in, where they have them.
 * None for a straight segment, or no such segment.
 */
export function segmentHandles(poly: ResolvedShape, segment: number): Array<{ node: number; which: "in" | "out"; point: Point }> {
  if (poly.kind !== "polyline") return [];
  const k = poly.nodes.findIndex((n) => n.index === segment);
  if (k < 0 || (k === poly.nodes.length - 1 && !poly.closed)) return [];
  const a = poly.nodes[k]!, b = poly.nodes[(k + 1) % poly.nodes.length]!;
  const out: Array<{ node: number; which: "in" | "out"; point: Point }> = [];
  if (a.out) out.push({ node: a.index, which: "out", point: [a.point[0] + a.out[0], a.point[1] + a.out[1]] });
  if (b.in) out.push({ node: b.index, which: "in", point: [b.point[0] + b.in[0], b.point[1] + b.in[1]] });
  return out;
}

/** Which handle of node `index` (stored) is under `point`, within `tolerance` mm, nearest first. */
export function handleAt(poly: ResolvedShape, index: number, point: Point, tolerance: number): "in" | "out" | null {
  let best: "in" | "out" | null = null, bestD = Infinity;
  for (const h of nodeHandles(poly, index)) {
    const d = distance(h.point, point);
    if (d <= tolerance && d < bestD) { best = h.which; bestD = d; }
  }
  return best;
}

/**
 * Which handle an Alt-drag of node `index` (stored) pulls out, the drag
 * heading `direction`: a corner's side with a segment but no handle (or one
 * of zero length); with both missing, the one whose neighbour lies more
 * that way. Null for a smooth node, or a corner missing none.
 */
export function pullHandleSide(poly: ResolvedShape, index: number, direction: Point): "in" | "out" | null {
  if (poly.kind !== "polyline") return null;
  const { nodes, closed } = poly;
  const k = nodes.findIndex((n) => n.index === index);
  const n = nodes[k];
  if (!n || n.type !== "cusp") return null;
  const count = nodes.length;
  const missing = (h: Point | undefined) => !h || (h[0] === 0 && h[1] === 0);
  const sides: Array<{ which: "in" | "out"; towards: Point }> = [];
  if ((closed || k > 0) && missing(n.in)) sides.push({ which: "in", towards: nodes[(k - 1 + count) % count]!.point });
  if ((closed || k < count - 1) && missing(n.out)) sides.push({ which: "out", towards: nodes[(k + 1) % count]!.point });
  if (sides.length < 2) return sides[0]?.which ?? null;
  // The cosine between the drag and each neighbour (0 for one on the node itself).
  const cos = (p: Point) => {
    const dx = p[0] - n.point[0], dy = p[1] - n.point[1], len = Math.hypot(dx, dy);
    return len > 0 ? (dx * direction[0] + dy * direction[1]) / len : 0;
  };
  return cos(sides[0]!.towards) > cos(sides[1]!.towards) ? "in" : "out";
}

/**
 * A path's own snap points at its nodes other than `index` (stored), as
 * resolve gives them: a node being dragged may land on the others (an end
 * on the other end, to close the path), though not on its own place.
 */
export function ownNodeSnaps(poly: ResolvedShape, index: number): SnapPoint[] {
  if (poly.kind !== "polyline") return [];
  // A path's snaps start with its nodes', in order.
  return poly.nodes.flatMap((n, k) => (n.index === index ? [] : [poly.snaps[k]!]));
}

/** Ends this close (mm, as drawn) are on the same spot, and can be joined. */
const JOIN_TOLERANCE = 0.005;

const NO_LAYERS: ReadonlySet<EntityId> = new Set();

/**
 * The end node `ref` can be joined to (joinPolyEnds): another open path end
 * on the same spot. Its own path's other end comes first (if closing would
 * leave at least 3 nodes), then other paths' ends in drawing order, leaving
 * out paths on `hidden` or `locked` layers. Null if `ref` isn't an open
 * path's end, or there is none.
 */
export function joinTarget(
  r: Resolved, ref: PolyNodeRef, hidden: ReadonlySet<EntityId> = NO_LAYERS, locked: ReadonlySet<EntityId> = NO_LAYERS,
): PolyNodeRef | null {
  const end = polyEnd(r, ref);
  if (!end) return null;
  const on = (p: Point) => distance(p, end.node.point) <= JOIN_TOLERANCE;
  const { nodes } = end.shape;
  const other = end.first ? nodes[nodes.length - 1]! : nodes[0]!;
  if (nodes.length > 3 && on(other.point)) return { shape: ref.shape, index: other.index };
  for (const id of r.order) {
    const s = r.shapes[id]!;
    if (id === ref.shape || s.kind !== "polyline" || s.closed || !isVisible(r, id, hidden) || locked.has(s.layer)) continue;
    for (const n of [s.nodes[0]!, s.nodes[s.nodes.length - 1]!]) if (on(n.point)) return { shape: id, index: n.index };
  }
  return null;
}

/**
 * The segment nearest `point`, within `tolerance` mm, and the parameter t
 * of the nearest point on it: `segment` is the stored index of its start
 * node, as insertPolyNode takes. Null if no segment is that close.
 */
export function segmentAt(poly: ResolvedShape, point: Point, tolerance: number): { segment: number; t: number } | null {
  if (poly.kind !== "polyline") return null;
  const { nodes } = poly;
  let best: { segment: number; t: number } | null = null, bestD = Infinity;
  poly.path.forEach((e, k) => {
    const hit = e.kind === "segment" ? nearestOnSegment(e, point) : e.kind === "cubic" ? nearestOnCubic(e, point) : undefined;
    if (hit && hit.d <= tolerance && hit.d < bestD) { best = { segment: nodes[k]!.index, t: hit.t }; bestD = hit.d; }
  });
  return best;
}

function nearestOnSegment(s: Segment, p: Point): { t: number; d: number } {
  const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s.from[0]) * dx + (p[1] - s.from[1]) * dy) / len2));
  return { t, d: distanceToSegment(p, s.from, s.to) };
}

/** Coarse samples, then a ternary search around the nearest: close enough to place a node by hand. */
function nearestOnCubic(c: Cubic, p: Point): { t: number; d: number } {
  const STEPS = 32;
  const dist = (t: number) => distance(cubicPoint(c, t), p);
  let bestT = 0, bestD = dist(0);
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS, d = dist(t);
    if (d < bestD) { bestT = t; bestD = d; }
  }
  let lo = Math.max(0, bestT - 1 / STEPS), hi = Math.min(1, bestT + 1 / STEPS);
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (dist(a) < dist(b)) hi = b; else lo = a;
  }
  const t = (lo + hi) / 2, d = dist(t);
  return d < bestD ? { t, d } : { t: bestT, d: bestD };
}
