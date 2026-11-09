// resolve(): the one pure function from document to drawable geometry.
//
// Every client runs this over the same synced document and gets the same
// result, which is why only the model is synced and never the geometry.
// It must never throw on a malformed or half-arrived document: dangling
// references make the dependent piece inactive and add an Issue.
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
  type RadiusLabelProps, type SpacingProps,
  KINDS, entitiesOfKind, isRef,
} from "./types";

// ---- Output types ----

export type IssueCode =
  | "dangling-ref"          // a { ref } points at a missing or non-variable entity
  | "bad-value"             // a prop that must be a number isn't
  | "radius-clamped"        // corner radii were too big for the rectangle
  | "dangling-target"       // dimension / label / link refers to a missing shape
  | "spacing-inactive"      // a spacing link could not be computed
  | "spacing-overflow";     // items wider than the span between anchors

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

export interface Resolved {
  /** Shapes by ID, positions already adjusted by spacing links. */
  shapes: Record<EntityId, ResolvedShape>;
  /** Shape IDs in document (draw) order. */
  order: EntityId[];
  variables: Record<EntityId, number>;
  dimensions: ResolvedDimension[];
  radiusLabels: ResolvedRadiusLabel[];
  spacings: ResolvedSpacing[];
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

  const spacings = applySpacings(ctx, shapes);
  const dimensions = resolveDimensions(ctx, shapes);
  const radiusLabels = resolveRadiusLabels(ctx, shapes);

  return { shapes, order, variables, dimensions, radiusLabels, spacings, issues };
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

// ---- Spacing links ----

function applySpacings(ctx: Ctx, shapes: Record<EntityId, ResolvedShape>): ResolvedSpacing[] {
  const out: ResolvedSpacing[] = [];
  // Sorted by ID so the result doesn't depend on entity arrival order.
  const links = entitiesOfKind(ctx.state, KINDS.spacing).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [id, link] of links) out.push(applySpacing(ctx, id, link, shapes));
  return out;
}

function applySpacing(ctx: Ctx, id: EntityId, link: SpacingProps, shapes: Record<EntityId, ResolvedShape>): ResolvedSpacing {
  const axis: Axis = link.axis === "y" ? "y" : "x";
  const inactive = (why: string): ResolvedSpacing => {
    ctx.issues.push({ entity: id, code: "spacing-inactive", message: why });
    return { id, active: false, axis, positions: {}, step: 0 };
  };

  const a = shapes[link.anchorA], b = shapes[link.anchorB];
  if (!a || !b) return inactive("anchor shape missing");
  const items = (Array.isArray(link.items) ? link.items : []).filter((i): i is EntityId => typeof i === "string");
  const present = items.filter((i) => shapes[i] !== undefined && i !== link.anchorA && i !== link.anchorB);
  for (const i of items) if (!shapes[i]) ctx.issues.push({ entity: id, code: "dangling-target", message: `spacing item ${i} missing` });
  if (present.length === 0) return inactive("no items");

  // Span is the clear space between the anchors' inner edges.
  const [lower, upper] = boundsMin(a.bounds, axis) <= boundsMin(b.bounds, axis) ? [a, b] : [b, a];
  const start = boundsMax(lower.bounds, axis);
  const end = boundsMin(upper.bounds, axis);
  const span = end - start;
  const sizes = present.map((i) => boundsSize(shapes[i]!.bounds, axis));
  const n = present.length;
  const positions: Record<EntityId, number> = {};
  let step: number;

  if (link.mode === "centres") {
    step = span / (n + 1);
    present.forEach((i, k) => { positions[i] = snapNumber(start + step * (k + 1) - sizes[k]! / 2); });
  } else {
    const total = sizes.reduce((s, v) => s + v, 0);
    step = (span - total) / (n + 1);
    let cursor = start + step;
    present.forEach((i, k) => { positions[i] = snapNumber(cursor); cursor += sizes[k]! + step; });
  }
  if (step < 0) ctx.issues.push({ entity: id, code: "spacing-overflow", message: "items do not fit between the anchors" });

  for (const i of present) {
    const s = shapes[i]!;
    const delta = positions[i]! - boundsMin(s.bounds, axis);
    shapes[i] = axis === "x" ? translateShape(s, delta, 0) : translateShape(s, 0, delta);
  }
  return { id, active: true, axis, positions, step: snapNumber(step) };
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
