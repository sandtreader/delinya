// Guides for live links: where to draw each align and spacing link, in
// model mm. Pure; the canvas styles them. Guides follow the shapes as
// resolved, so a link that is not in force is drawn where its shapes are.

import {
  type Axis, type Bounds, type DocState, type EntityId, type Point, type Resolved, type Segment,
  KINDS, boundsMax, boundsMin, isVisible, midpoint, segment,
} from "../model";

export interface LinkGuide {
  link: EntityId;
  kind: "align" | "spacing";
  /** Dashed guide segments. */
  path: Segment[];
  /** Where "=" marks go: each spacing segment's midpoint; none for align. */
  marks: Point[];
  /** An anchor or item of the link is selected. */
  emphasis: boolean;
  /** The link is not in force. */
  broken: boolean;
}

interface Placed { id: EntityId; b: Bounds }

const NO_LAYERS: ReadonlySet<EntityId> = new Set();
type Drawn = { placed: Placed[]; path: Segment[]; marks: Point[] };

/**
 * Guides for every drawable link, in link ID order. Malformed links are
 * skipped, and so are links with a shape on one of the `hidden` layers.
 */
export function linkGuides(
  state: DocState, resolved: Resolved, selection: EntityId[], overhang: number, hidden: ReadonlySet<EntityId> = NO_LAYERS,
): LinkGuide[] {
  const active = new Set([...resolved.aligns, ...resolved.spacings].filter((l) => l.active).map((l) => l.id));
  const selected = new Set(selection);
  const links = Object.entries(state.entities)
    .filter(([, e]) => e.kind === KINDS.align || e.kind === KINDS.spacing)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: LinkGuide[] = [];
  for (const [id, e] of links) {
    const p: Record<string, unknown> = e.props;
    if (touchesHidden(resolved, p, hidden)) continue;
    const axis: Axis = p.axis === "y" ? "y" : "x";
    const align = e.kind === KINDS.align;
    const g = align ? alignGuide(resolved, p, axis, overhang) : spacingGuide(resolved, p, axis);
    if (!g) continue;
    out.push({
      link: id, kind: align ? "align" : "spacing", path: g.path, marks: g.marks,
      emphasis: g.placed.some((s) => selected.has(s.id)), broken: !active.has(id),
    });
  }
  return out;
}

/** One segment along the held line, across every shape in the link plus `overhang` each end. */
function alignGuide(r: Resolved, p: Record<string, unknown>, axis: Axis, overhang: number): Drawn | undefined {
  const anchor = placed(r, p.anchor);
  if (!anchor) return undefined;
  const items = present(r, p.items, [anchor.id]);
  if (items.length === 0) return undefined;
  const all = [anchor, ...items], c = cross(axis), a = anchor.b;
  const at = p.mode === "centre" ? mid(a, axis) : p.mode === "end" ? boundsMax(a, axis) : boundsMin(a, axis);
  const lo = Math.min(...all.map((s) => boundsMin(s.b, c))) - overhang;
  const hi = Math.max(...all.map((s) => boundsMax(s.b, c))) + overhang;
  return { placed: all, path: [segment(pt(axis, at, lo), pt(axis, at, hi))], marks: [] };
}

/**
 * One segment per equal step, in order along the axis: face to face for
 * gaps; for centres, centre to centre and out to the anchors' inner faces.
 * Each sits halfway across between the centres of the two shapes it joins.
 */
function spacingGuide(r: Resolved, p: Record<string, unknown>, axis: Axis): Drawn | undefined {
  const a = placed(r, p.anchorA), b = placed(r, p.anchorB);
  if (!a || !b) return undefined;
  const anchors = a.id === b.id ? [a] : [a, b];
  const items = present(r, p.items, anchors.map((s) => s.id));
  if (items.length === 0) return undefined;
  const all = [...anchors, ...items].sort((s, t) => boundsMin(s.b, axis) - boundsMin(t.b, axis));
  const centres = p.mode === "centres", c = cross(axis);
  const isItem = (s: Placed) => centres && !anchors.includes(s);
  const path: Segment[] = [];
  for (let k = 1; k < all.length; k++) {
    const s = all[k - 1]!, t = all[k]!;
    const from = isItem(s) ? mid(s.b, axis) : boundsMax(s.b, axis);
    const to = isItem(t) ? mid(t.b, axis) : boundsMin(t.b, axis);
    const across = (mid(s.b, c) + mid(t.b, c)) / 2;
    path.push(segment(pt(axis, from, across), pt(axis, to, across)));
  }
  return { placed: all, path, marks: path.map((s) => midpoint(s.from, s.to)) };
}

/** Whether any of a link's anchors or items is a shape on a hidden layer. */
function touchesHidden(r: Resolved, p: Record<string, unknown>, hidden: ReadonlySet<EntityId>): boolean {
  const members = [p.anchor, p.anchorA, p.anchorB, ...(Array.isArray(p.items) ? p.items : [])];
  return members.some((m) => typeof m === "string" && Object.hasOwn(r.shapes, m) && !isVisible(r, m, hidden));
}

/** A resolved shape by ID; own properties only, so a junk ID finds nothing. */
function placed(r: Resolved, id: unknown): Placed | undefined {
  return typeof id === "string" && Object.hasOwn(r.shapes, id) ? { id, b: r.shapes[id]!.bounds } : undefined;
}

/** A link's items that are resolved shapes, each once, anchors left out. */
function present(r: Resolved, raw: unknown, anchors: EntityId[]): Placed[] {
  const seen = new Set<unknown>(anchors);
  const out: Placed[] = [];
  for (const i of Array.isArray(raw) ? raw : []) {
    if (seen.has(i)) continue;
    seen.add(i);
    const s = placed(r, i);
    if (s) out.push(s);
  }
  return out;
}

const cross = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const mid = (b: Bounds, axis: Axis) => (boundsMin(b, axis) + boundsMax(b, axis)) / 2;
/** A point from its along-axis and cross-axis coordinates. */
const pt = (axis: Axis, along: number, across: number): Point => (axis === "x" ? [along, across] : [across, along]);

/**
 * How far guides run past their shapes, in screen px. Shapes take clicks
 * 6 px either side of their edges, so this leaves an edge-aligned guide a
 * clickable stretch of its own; the delink buttons sit at its end.
 */
export const GUIDE_OVERHANG_PX = 16;
