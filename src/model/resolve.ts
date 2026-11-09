// resolve(): the one pure function from document to drawable geometry.
//
// Every client runs this over the same synced document and gets the same
// result, which is why only the model is synced and never the geometry.
// It must never throw on a malformed or half-arrived document: dangling
// references make the dependent piece inactive and add an Issue.
//
// Order of work: variables, shapes as authored, position links (spacing and
// align) in dependency order, then dimensions and labels on the placed
// shapes. "Position links" below says how links are ordered.
//
// Coordinates: x to the right, y increasing downwards (as SVG and canvas),
// angles in degrees from +x towards +y. "Top" means smaller y.

import type { DocState } from "@sandtreader/collab/protocol";
import {
  type Arc, type Bounds, type Path, type Point, type Segment,
  arc, arcMid, boundsMax, boundsMin, boundsOfPoints, boundsSize, fullCircle, midpoint,
  pathBounds, polar, segment, snapNumber,
} from "./geometry";
import {
  type Axis, type DimensionProp, type DimensionProps, type EntityId, type Length,
  type AlignMode, type RadiusLabelProps, type SpacingMode, type SpacingProps,
  DOCUMENT_FIELDS, DOCUMENT_ID, KINDS, entitiesOfKind, isRef,
} from "./types";

// ---- Output types ----

export type IssueCode =
  | "dangling-ref"          // a { ref } points at a missing or non-variable entity
  | "bad-value"             // a prop has the wrong type (not a number, not text)
  | "radius-clamped"        // corner radii were too big for the rectangle
  | "dangling-target"       // dimension / label / link refers to a missing shape
  | "spacing-inactive"      // a spacing link could not be computed
  | "spacing-overflow"      // items wider than the span between anchors
  | "align-inactive"        // an align link is malformed or has nothing to align
  | "link-conflict"         // another link already positions an item on that axis
  | "link-cycle";           // links position each other's anchors in a loop

export interface Issue {
  entity: EntityId;
  code: IssueCode;
  message: string;
}

export type SnapType = "endpoint" | "corner" | "midpoint" | "centre" | "quadrant" | "tangent";

export interface SnapPoint {
  point: Point;
  type: SnapType;
}

interface ResolvedBase {
  id: EntityId;
  path: Path;
  bounds: Bounds;
  snaps: SnapPoint[];
}

export interface ResolvedLine extends ResolvedBase {
  kind: "line";
  from: Point;
  to: Point;
  length: number;
  angle: number;
}

export interface ResolvedRect extends ResolvedBase {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Effective radii after clamping: [tl, tr, br, bl]. */
  r: [number, number, number, number];
  /** Sharp corner points [tl, tr, br, bl], whether or not rounded. */
  corners: [Point, Point, Point, Point];
  /** Corner arcs, null where the radius is zero. Same order as `r`. */
  arcs: [Arc | null, Arc | null, Arc | null, Arc | null];
}

export interface ResolvedCircle extends ResolvedBase {
  kind: "circle";
  centre: Point;
  diameter: number;
  radius: number;
}

export type ResolvedShape = ResolvedLine | ResolvedRect | ResolvedCircle;

export interface ResolvedDimension {
  id: EntityId;
  target: EntityId;
  prop: DimensionProp;
  value: number;
  /** The two points on the shape being measured. */
  anchors: [Point, Point];
  /** The dimension line itself, already moved out by `offset`. */
  line: Segment;
  offset: number;
}

export interface ResolvedRadiusLabel {
  id: EntityId;
  target: EntityId;
  corner: 0 | 1 | 2 | 3;
  radius: number;
  /** Where the label attaches: the arc midpoint, or the corner if sharp. */
  at: Point;
}

export interface ResolvedSpacing {
  id: EntityId;
  active: boolean;
  axis: Axis;
  /** Derived along-axis minimum for each placed item. */
  positions: Record<EntityId, number>;
  /** Gap between neighbours (gaps mode) or centre pitch (centres mode). */
  step: number;
}

export interface ResolvedAlign {
  id: EntityId;
  active: boolean;
  anchor: EntityId;
  axis: Axis;
  mode: AlignMode;
  /** Derived along-axis minimum for each placed item. */
  positions: Record<EntityId, number>;
}

/** Document properties, "" where unset. */
export interface ResolvedDocument {
  title: string;
  author: string;
  revision: string;
  notes: string;
}

export interface Resolved {
  document: ResolvedDocument;
  /** Shapes by ID, positions already adjusted by spacing and align links. */
  shapes: Record<EntityId, ResolvedShape>;
  /** Shape IDs in document (draw) order. */
  order: EntityId[];
  variables: Record<EntityId, number>;
  dimensions: ResolvedDimension[];
  radiusLabels: ResolvedRadiusLabel[];
  /** Links in ID order, inactive ones included. */
  spacings: ResolvedSpacing[];
  aligns: ResolvedAlign[];
  issues: Issue[];
}

// ---- Entry point ----

export function resolve(state: DocState): Resolved {
  const issues: Issue[] = [];
  const variables = resolveVariables(state, issues);
  const ctx: Ctx = { state, variables, issues };

  const shapes: Record<EntityId, ResolvedShape> = {};
  const order: EntityId[] = [];
  for (const [id, e] of Object.entries(state.entities)) {
    const shape = resolveShape(ctx, id, e.kind, e.props);
    if (shape) { shapes[id] = shape; order.push(id); }
  }

  const { spacings, aligns } = applyLinks(ctx, shapes);
  const dimensions = resolveDimensions(ctx, shapes);
  const radiusLabels = resolveRadiusLabels(ctx, shapes);
  const document = resolveDocument(ctx);

  return { document, shapes, order, variables, dimensions, radiusLabels, spacings, aligns, issues };
}

interface Ctx {
  state: DocState;
  variables: Record<EntityId, number>;
  issues: Issue[];
}

// ---- Variables and lengths ----

function resolveVariables(state: DocState, issues: Issue[]): Record<EntityId, number> {
  const out: Record<EntityId, number> = {};
  for (const [id, v] of entitiesOfKind(state, KINDS.variable)) {
    if (typeof v.value === "number" && Number.isFinite(v.value)) out[id] = v.value;
    else issues.push({ entity: id, code: "bad-value", message: `variable value is not a number` });
  }
  return out;
}

/** A Length to a number. Dangling or bad values resolve to 0 with an issue. */
export function resolveLength(ctx: Ctx, owner: EntityId, prop: string, v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (isRef(v)) {
    const n = ctx.variables[v.ref];
    if (n !== undefined) return n;
    ctx.issues.push({ entity: owner, code: "dangling-ref", message: `${prop} refers to missing variable ${v.ref}` });
    return 0;
  }
  ctx.issues.push({ entity: owner, code: "bad-value", message: `${prop} is not a length` });
  return 0;
}

function num(ctx: Ctx, owner: EntityId, prop: string, v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  ctx.issues.push({ entity: owner, code: "bad-value", message: `${prop} is not a number` });
  return 0;
}

/** Look through a ref to the number it currently stands for, for UIs and unlinking. */
export function lengthValue(state: DocState, v: Length): number | undefined {
  if (typeof v === "number") return v;
  const e = state.entities[v.ref];
  if (!e || e.kind !== KINDS.variable) return undefined;
  const n = e.props.value;
  return typeof n === "number" ? n : undefined;
}

// ---- Document properties ----

function resolveDocument(ctx: Ctx): ResolvedDocument {
  const out: ResolvedDocument = { title: "", author: "", revision: "", notes: "" };
  const e = ctx.state.entities[DOCUMENT_ID];
  if (!e || e.kind !== KINDS.document) return out;
  for (const k of DOCUMENT_FIELDS) {
    const v = e.props[k];
    if (typeof v === "string") out[k] = v;
    else if (v != null) ctx.issues.push({ entity: DOCUMENT_ID, code: "bad-value", message: `${k} is not text` });
  }
  return out;
}

// ---- Shapes ----

function resolveShape(ctx: Ctx, id: EntityId, kind: string, p: Record<string, unknown>): ResolvedShape | undefined {
  switch (kind) {
    case KINDS.line: return resolveLine(ctx, id, p);
    case KINDS.rect: return resolveRect(ctx, id, p);
    case KINDS.circle: return resolveCircle(ctx, id, p);
    default: return undefined;
  }
}

function resolveLine(ctx: Ctx, id: EntityId, p: Record<string, unknown>): ResolvedLine {
  const x = num(ctx, id, "x", p.x), y = num(ctx, id, "y", p.y);
  const angle = num(ctx, id, "angle", p.angle);
  const length = resolveLength(ctx, id, "length", p.length);
  return buildLine(id, [x, y], length, angle);
}

function buildLine(id: EntityId, from: Point, length: number, angle: number): ResolvedLine {
  // Not .map(snapNumber): map's index would become the decimal places.
  const to = polar(from, length, angle).map((v) => snapNumber(v)) as Point;
  const seg = segment(from, to);
  return {
    id, kind: "line", from, to, length, angle,
    path: [seg],
    bounds: boundsOfPoints([from, to]),
    snaps: [
      { point: from, type: "endpoint" },
      { point: to, type: "endpoint" },
      { point: midpoint(from, to), type: "midpoint" },
    ],
  };
}

function resolveRect(ctx: Ctx, id: EntityId, p: Record<string, unknown>): ResolvedRect {
  const x = num(ctx, id, "x", p.x), y = num(ctx, id, "y", p.y);
  const width = resolveLength(ctx, id, "width", p.width);
  const height = resolveLength(ctx, id, "height", p.height);
  const rawR = Array.isArray(p.r) && p.r.length === 4 ? p.r : [0, 0, 0, 0];
  const r = rawR.map((v, i) => Math.max(0, resolveLength(ctx, id, `r[${i}]`, v))) as [number, number, number, number];
  const clamped = clampRadii(r, width, height);
  if (clamped !== r) ctx.issues.push({ entity: id, code: "radius-clamped", message: "corner radii exceed the sides and were scaled down" });
  return buildRect(id, x, y, width, height, clamped);
}

/**
 * Scale all four radii by one factor so that adjacent pairs fit on each
 * side (the CSS border-radius rule). Returns the same array if nothing
 * needed changing.
 */
export function clampRadii(r: [number, number, number, number], width: number, height: number): [number, number, number, number] {
  const [tl, tr, br, bl] = r;
  const sums = [tl + tr, bl + br, tl + bl, tr + br];
  const sides = [width, width, height, height];
  let f = 1;
  for (let i = 0; i < 4; i++) {
    const s = sums[i]!;
    if (s > 0) f = Math.min(f, sides[i]! / s);
  }
  if (f >= 1) return r;
  return r.map((v) => snapNumber(v * Math.max(0, f))) as [number, number, number, number];
}

function buildRect(id: EntityId, x: number, y: number, width: number, height: number, r: [number, number, number, number]): ResolvedRect {
  const [tl, tr, br, bl] = r;
  const corners: [Point, Point, Point, Point] = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];

  // Corner arcs run with increasing angle, which is clockwise on a y-down
  // screen, matching the clockwise walk below.
  const arcs: [Arc | null, Arc | null, Arc | null, Arc | null] = [
    tl > 0 ? arc([x + tl, y + tl], tl, 180, 270) : null,
    tr > 0 ? arc([x + width - tr, y + tr], tr, 270, 360) : null,
    br > 0 ? arc([x + width - br, y + height - br], br, 0, 90) : null,
    bl > 0 ? arc([x + bl, y + height - bl], bl, 90, 180) : null,
  ];

  const path: Path = [];
  const snaps: SnapPoint[] = [];
  const edge = (a: Point, b: Point) => {
    if (a[0] !== b[0] || a[1] !== b[1]) path.push(segment(a, b));
  };
  const pushArc = (a: Arc | null, corner: Point) => {
    if (a) {
      path.push(a);
      snaps.push({ point: polar(a.centre, a.radius, a.start), type: "tangent" });
      snaps.push({ point: polar(a.centre, a.radius, a.end), type: "tangent" });
    } else {
      snaps.push({ point: corner, type: "corner" });
    }
  };

  // Clockwise on screen: top, right, bottom, left.
  edge([x + tl, y], [x + width - tr, y]);
  pushArc(arcs[1], corners[1]);
  edge([x + width, y + tr], [x + width, y + height - br]);
  pushArc(arcs[2], corners[2]);
  edge([x + width - br, y + height], [x + bl, y + height]);
  pushArc(arcs[3], corners[3]);
  edge([x, y + height - bl], [x, y + tl]);
  pushArc(arcs[0], corners[0]);

  snaps.push(
    { point: midpoint(corners[0], corners[1]), type: "midpoint" },
    { point: midpoint(corners[1], corners[2]), type: "midpoint" },
    { point: midpoint(corners[2], corners[3]), type: "midpoint" },
    { point: midpoint(corners[3], corners[0]), type: "midpoint" },
    { point: [x + width / 2, y + height / 2], type: "centre" },
  );

  return {
    id, kind: "rect", x, y, width, height, r, corners, arcs, path, snaps,
    bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
  };
}

function resolveCircle(ctx: Ctx, id: EntityId, p: Record<string, unknown>): ResolvedCircle {
  const cx = num(ctx, id, "cx", p.cx), cy = num(ctx, id, "cy", p.cy);
  const diameter = resolveLength(ctx, id, "diameter", p.diameter);
  return buildCircle(id, [cx, cy], diameter);
}

function buildCircle(id: EntityId, centre: Point, diameter: number): ResolvedCircle {
  const radius = diameter / 2;
  const [cx, cy] = centre;
  return {
    id, kind: "circle", centre, diameter, radius,
    path: [fullCircle(centre, radius)],
    bounds: { minX: cx - radius, minY: cy - radius, maxX: cx + radius, maxY: cy + radius },
    snaps: [
      { point: centre, type: "centre" },
      { point: [cx + radius, cy], type: "quadrant" },
      { point: [cx, cy + radius], type: "quadrant" },
      { point: [cx - radius, cy], type: "quadrant" },
      { point: [cx, cy - radius], type: "quadrant" },
    ],
  };
}

/** Rebuild a shape at a new position. Sizes are untouched. */
export function translateShape(s: ResolvedShape, dx: number, dy: number): ResolvedShape {
  if (dx === 0 && dy === 0) return s;
  switch (s.kind) {
    case "line": return buildLine(s.id, [s.from[0] + dx, s.from[1] + dy], s.length, s.angle);
    case "rect": return buildRect(s.id, s.x + dx, s.y + dy, s.width, s.height, s.r);
    case "circle": return buildCircle(s.id, [s.centre[0] + dx, s.centre[1] + dy], s.diameter);
  }
}

// ---- Position links ----
//
// Spacing and align links derive their items' along-axis position from
// their anchors. Rules, so every client gets the same answer whatever order
// entities arrived in:
//
// 1. Claims. A shape's position on an axis comes from at most one link.
//    Links are taken in ID order; one wanting an item already claimed on
//    its axis is switched off whole ("link-conflict").
// 2. Order. L depends on M when M places one of L's anchors on L's axis.
//    Kahn's algorithm, lowest ready ID first, gives the apply order; links
//    on a cycle are switched off ("link-cycle"). Links downstream of a
//    cycle still run: a switched-off link moves nothing, so they read the
//    anchor as authored.
// 3. Apply. Translating along one axis never moves the other, and an item
//    is moved only by its one claimant, so x and y never interact and any
//    dependency order gives the same geometry. The ID tie-break just keeps
//    the order (and so the issue list) identical everywhere.

interface LinkPlan {
  id: EntityId;
  axis: Axis;
  anchors: EntityId[];
  /** Present shapes, each once, never an anchor. */
  items: EntityId[];
  report: { active: boolean; positions: Record<EntityId, number> };
  /** Along-axis minimum per item, from the anchors as they stand when called. */
  place: () => Record<EntityId, number>;
}

function applyLinks(ctx: Ctx, shapes: Record<EntityId, ResolvedShape>): { spacings: ResolvedSpacing[]; aligns: ResolvedAlign[] } {
  const spacings: ResolvedSpacing[] = [];
  const aligns: ResolvedAlign[] = [];
  const plans: LinkPlan[] = [];
  const links = Object.entries(ctx.state.entities)
    .filter(([, e]) => e.kind === KINDS.spacing || e.kind === KINDS.align)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [id, e] of links) {
    const plan = e.kind === KINDS.spacing
      ? planSpacing(ctx, id, e.props as unknown as SpacingProps, shapes, spacings)
      : planAlign(ctx, id, e.props, shapes, aligns);
    if (plan) plans.push(plan);
  }

  for (const plan of orderLinks(ctx, claimItems(ctx, plans))) {
    const positions = plan.place();
    for (const i of plan.items) shapes[i] = placeAlong(shapes[i]!, plan.axis, positions[i]!);
    plan.report.active = true;
    plan.report.positions = positions;
  }
  return { spacings, aligns };
}

function planSpacing(ctx: Ctx, id: EntityId, link: SpacingProps, shapes: Record<EntityId, ResolvedShape>, out: ResolvedSpacing[]): LinkPlan | undefined {
  const axis: Axis = link.axis === "y" ? "y" : "x";
  const mode: SpacingMode = link.mode === "centres" ? "centres" : "gaps";
  const report: ResolvedSpacing = { id, active: false, axis, positions: {}, step: 0 };
  out.push(report);
  const inactive = (why: string) => { ctx.issues.push({ entity: id, code: "spacing-inactive", message: why }); return undefined; };

  if (!shapeAt(shapes, link.anchorA) || !shapeAt(shapes, link.anchorB)) return inactive("anchor shape missing");
  const items = linkItems(ctx, id, "spacing", link.items, shapes, [link.anchorA, link.anchorB]);
  if (items.length === 0) return inactive("no items");

  const place = () => {
    const { positions, step } = spacedPositions(
      shapes[link.anchorA]!.bounds, shapes[link.anchorB]!.bounds, items.map((i) => shapes[i]!.bounds), axis, mode);
    if (step < 0) ctx.issues.push({ entity: id, code: "spacing-overflow", message: "items do not fit between the anchors" });
    report.step = snapNumber(step);
    return Object.fromEntries(items.map((i, k) => [i, positions[k]!]));
  };
  return { id, axis, anchors: [link.anchorA, link.anchorB], items, report, place };
}

// Props arrive unchecked: this kind is newer, so it is validated strictly
// rather than defaulted like spacing.
function planAlign(ctx: Ctx, id: EntityId, p: Record<string, unknown>, shapes: Record<EntityId, ResolvedShape>, out: ResolvedAlign[]): LinkPlan | undefined {
  const axis: Axis = p.axis === "y" ? "y" : "x";
  const mode: AlignMode = p.mode === "centre" || p.mode === "end" ? p.mode : "start";
  const anchor = typeof p.anchor === "string" ? p.anchor : "";
  const report: ResolvedAlign = { id, active: false, anchor, axis, mode, positions: {} };
  out.push(report);
  const inactive = (why: string) => { ctx.issues.push({ entity: id, code: "align-inactive", message: why }); return undefined; };

  if (p.axis !== axis) return inactive("axis is not x or y");
  if (p.mode !== mode) return inactive("mode is not start, centre or end");
  if (!shapeAt(shapes, anchor)) return inactive("anchor shape missing");
  if (!Array.isArray(p.items)) return inactive("items is not a list");
  const items = linkItems(ctx, id, "align", p.items, shapes, [anchor]);
  if (items.length === 0) return inactive("no items");

  const place = () => Object.fromEntries(items.map((i) => [i, alignedPosition(shapes[anchor]!.bounds, shapes[i]!.bounds, axis, mode)]));
  return { id, axis, anchors: [anchor], items, report, place };
}

/** A link's items that are shapes, each once, anchors left out; missing ones are flagged. */
function linkItems(ctx: Ctx, id: EntityId, what: string, raw: unknown, shapes: Record<EntityId, ResolvedShape>, anchors: EntityId[]): EntityId[] {
  const seen = new Set<string>(anchors);
  const out: EntityId[] = [];
  for (const i of Array.isArray(raw) ? raw : []) {
    if (typeof i !== "string" || seen.has(i)) continue;
    seen.add(i);
    if (shapeAt(shapes, i)) out.push(i);
    else ctx.issues.push({ entity: id, code: "dangling-target", message: `${what} item ${i} missing` });
  }
  return out;
}

/** Own-property lookup, so a bad ID such as "toString" can't find a prototype method. */
function shapeAt(shapes: Record<EntityId, ResolvedShape>, id: unknown): ResolvedShape | undefined {
  return typeof id === "string" && Object.hasOwn(shapes, id) ? shapes[id] : undefined;
}

/**
 * Rule 1: the first link by ID to place a shape on an axis keeps it. Returns
 * the live links in ID order, each with the links that place its anchors.
 */
function claimItems(ctx: Ctx, plans: LinkPlan[]): Map<LinkPlan, LinkPlan[]> {
  const owner: Record<Axis, Map<EntityId, LinkPlan>> = { x: new Map(), y: new Map() };
  const live: LinkPlan[] = [];
  for (const p of plans) {
    const taken = p.items.find((i) => owner[p.axis].has(i));
    if (taken !== undefined) {
      const by = owner[p.axis].get(taken)!.id;
      ctx.issues.push({ entity: p.id, code: "link-conflict", message: `${taken} is already positioned along ${p.axis} by ${by}` });
      continue;
    }
    for (const i of p.items) owner[p.axis].set(i, p);
    live.push(p);
  }
  return new Map(live.map((p) => [p, [...new Set(p.anchors.flatMap((a) => owner[p.axis].get(a) ?? []))]]));
}

/** Rule 2: dependency order; links on a cycle are reported and left out. */
function orderLinks(ctx: Ctx, deps: Map<LinkPlan, LinkPlan[]>): LinkPlan[] {
  const all = [...deps.keys()];
  const sorted = topoSort(all, deps);
  if (sorted.length === all.length) return sorted;
  // Kahn leaves out links on a cycle and those behind one; only the former are broken.
  const done = new Set(sorted);
  const cyclic = new Set(all.filter((p) => !done.has(p) && dependsOnItself(p, deps)));
  for (const p of cyclic) ctx.issues.push({ entity: p.id, code: "link-cycle", message: "links position each other's anchors in a loop" });
  return topoSort(all.filter((p) => !cyclic.has(p)), deps);
}

/** Kahn's algorithm over `nodes` (in ID order), lowest ready ID first. Deps outside `nodes` are ignored. */
function topoSort(nodes: LinkPlan[], deps: Map<LinkPlan, LinkPlan[]>): LinkPlan[] {
  const included = new Set(nodes);
  const waiting = new Map<LinkPlan, number>();
  const next = new Map<LinkPlan, LinkPlan[]>();
  for (const n of nodes) {
    const ds = deps.get(n)!.filter((d) => included.has(d));
    waiting.set(n, ds.length);
    for (const d of ds) {
      const list = next.get(d);
      if (list) list.push(n);
      else next.set(d, [n]);
    }
  }
  const ready = nodes.filter((n) => waiting.get(n) === 0);
  const out: LinkPlan[] = [];
  while (ready.length > 0) {
    const n = ready.shift()!;
    out.push(n);
    for (const m of next.get(n) ?? []) {
      const w = waiting.get(m)! - 1;
      waiting.set(m, w);
      if (w > 0) continue;
      const at = ready.findIndex((r) => r.id > m.id);
      ready.splice(at < 0 ? ready.length : at, 0, m);
    }
  }
  return out;
}

/** Whether a chain of dependencies leads from `p` back to itself. Iterative, so a long chain can't overflow the stack. */
function dependsOnItself(p: LinkPlan, deps: Map<LinkPlan, LinkPlan[]>): boolean {
  const stack = [...deps.get(p)!];
  const seen = new Set<LinkPlan>();
  while (stack.length > 0) {
    const q = stack.pop()!;
    if (q === p) return true;
    if (seen.has(q)) continue;
    seen.add(q);
    stack.push(...deps.get(q)!);
  }
  return false;
}

// Placement arithmetic, shared with the one-shot actions so a one-off
// align or space lands exactly where the live link would put it.

/**
 * Along-axis minimum for each item spaced between two anchors' inner faces,
 * by equal gaps or equal centre pitch, and that gap or pitch (negative if
 * the items don't fit). Anchor order doesn't matter.
 */
export function spacedPositions(a: Bounds, b: Bounds, items: Bounds[], axis: Axis, mode: SpacingMode): { positions: number[]; step: number } {
  const [lower, upper] = boundsMin(a, axis) <= boundsMin(b, axis) ? [a, b] : [b, a];
  const start = boundsMax(lower, axis);
  const span = boundsMin(upper, axis) - start;
  const sizes = items.map((i) => boundsSize(i, axis));
  const n = items.length;
  if (mode === "centres") {
    const step = span / (n + 1);
    return { step, positions: sizes.map((size, k) => snapNumber(start + step * (k + 1) - size / 2)) };
  }
  const step = (span - sizes.reduce((s, v) => s + v, 0)) / (n + 1);
  let cursor = start + step;
  const positions = sizes.map((size) => { const at = snapNumber(cursor); cursor += size + step; return at; });
  return { step, positions };
}

/** Along-axis minimum that lines an item's start, centre or end up with the anchor's. */
export function alignedPosition(anchor: Bounds, item: Bounds, axis: Axis, mode: AlignMode): number {
  switch (mode) {
    case "start": return snapNumber(boundsMin(anchor, axis));
    case "centre": return snapNumber((boundsMin(anchor, axis) + boundsMax(anchor, axis) - boundsSize(item, axis)) / 2);
    case "end": return snapNumber(boundsMax(anchor, axis) - boundsSize(item, axis));
  }
}

/** Translate a shape along one axis so its minimum there is `at`. */
export function placeAlong(s: ResolvedShape, axis: Axis, at: number): ResolvedShape {
  const delta = at - boundsMin(s.bounds, axis);
  return axis === "x" ? translateShape(s, delta, 0) : translateShape(s, 0, delta);
}

/** Axes on which a live link derives this shape's position, so its stored value there is ignored. */
export function derivedAxes(r: Resolved, id: EntityId): Set<Axis> {
  const out = new Set<Axis>();
  for (const l of [...r.spacings, ...r.aligns]) if (l.active && Object.hasOwn(l.positions, id)) out.add(l.axis);
  return out;
}

/** A drag delta with the components dropped on axes a live link controls for this shape; [0, 0] if it is not a shape. */
export function freeDelta(r: Resolved, id: EntityId, delta: Point): Point {
  if (!Object.hasOwn(r.shapes, id)) return [0, 0];
  const axes = derivedAxes(r, id);
  return [axes.has("x") ? 0 : delta[0], axes.has("y") ? 0 : delta[1]];
}

// ---- Dimensions and labels ----

function resolveDimensions(ctx: Ctx, shapes: Record<EntityId, ResolvedShape>): ResolvedDimension[] {
  const out: ResolvedDimension[] = [];
  for (const [id, d] of entitiesOfKind(ctx.state, KINDS.dimension)) {
    const r = resolveDimension(ctx, id, d, shapes);
    if (r) out.push(r);
  }
  return out;
}

function resolveDimension(ctx: Ctx, id: EntityId, d: DimensionProps, shapes: Record<EntityId, ResolvedShape>): ResolvedDimension | undefined {
  const s = shapes[d.target];
  if (!s) { ctx.issues.push({ entity: id, code: "dangling-target", message: `dimension target ${d.target} missing` }); return undefined; }
  const offset = typeof d.offset === "number" ? d.offset : 0;
  const measured = measure(s, d.prop);
  if (!measured) { ctx.issues.push({ entity: id, code: "bad-value", message: `${s.kind} has no ${d.prop}` }); return undefined; }
  const { value, anchors, normal } = measured;
  const line = segment(
    [anchors[0][0] + normal[0] * offset, anchors[0][1] + normal[1] * offset],
    [anchors[1][0] + normal[0] * offset, anchors[1][1] + normal[1] * offset],
  );
  return { id, target: d.target, prop: d.prop, value, anchors, line, offset };
}

/** What a dimension of `prop` measures on a shape, and which way it stands off. */
function measure(s: ResolvedShape, prop: DimensionProp): { value: number; anchors: [Point, Point]; normal: Point } | undefined {
  switch (s.kind) {
    case "rect":
      if (prop === "width") return { value: s.width, anchors: [s.corners[0], s.corners[1]], normal: [0, -1] };
      if (prop === "height") return { value: s.height, anchors: [s.corners[0], s.corners[3]], normal: [-1, 0] };
      return undefined;
    case "circle":
      if (prop === "diameter") {
        const [cx, cy] = s.centre;
        return { value: s.diameter, anchors: [[cx - s.radius, cy - s.radius], [cx + s.radius, cy - s.radius]], normal: [0, -1] };
      }
      return undefined;
    case "line":
      if (prop === "length") {
        const n = polar([0, 0], 1, s.angle - 90);
        return { value: s.length, anchors: [s.from, s.to], normal: [snapNumber(n[0]), snapNumber(n[1])] };
      }
      return undefined;
  }
}

function resolveRadiusLabels(ctx: Ctx, shapes: Record<EntityId, ResolvedShape>): ResolvedRadiusLabel[] {
  const out: ResolvedRadiusLabel[] = [];
  for (const [id, l] of entitiesOfKind(ctx.state, KINDS.radiusLabel)) {
    const s = shapes[l.target];
    if (!s || s.kind !== "rect") { ctx.issues.push({ entity: id, code: "dangling-target", message: `radius label target ${l.target} is not a rect` }); continue; }
    const corner = ([0, 1, 2, 3] as const).includes(l.corner) ? l.corner : 0;
    const a = s.arcs[corner];
    out.push({ id, target: l.target, corner, radius: s.r[corner], at: a ? arcMid(a) : s.corners[corner] });
  }
  return out;
}

// Re-exported for consumers that only need bounds helpers alongside resolve.
export { pathBounds };
export type { RadiusLabelProps };
