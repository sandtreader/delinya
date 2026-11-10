// Pure 2D geometry primitives. No model knowledge: resolve.ts turns
// entities into these, and rendering/export consume them.

export type Point = [number, number];

export interface Segment {
  kind: "segment";
  from: Point;
  to: Point;
}

/**
 * Circular arc. Angles in degrees from +x towards +y, measured at the
 * centre; the arc runs from `start` to `end` with increasing angle, which
 * is clockwise on a y-down screen. A full circle is start 0, end 360.
 */
export interface Arc {
  kind: "arc";
  centre: Point;
  radius: number;
  start: number;
  end: number;
}

/** Cubic Bézier from `from` to `to`, pulled towards `c1` then `c2`. */
export interface Cubic {
  kind: "cubic";
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

export type PathElement = Segment | Arc | Cubic;
export type Path = PathElement[];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EPS = 1e-9;

export function near(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function pointsNear(a: Point, b: Point, eps = EPS): boolean {
  return near(a[0], b[0], eps) && near(a[1], b[1], eps);
}

export function segment(from: Point, to: Point): Segment {
  return { kind: "segment", from, to };
}

export function arc(centre: Point, radius: number, start: number, end: number): Arc {
  return { kind: "arc", centre, radius, start, end };
}

export function fullCircle(centre: Point, radius: number): Arc {
  return arc(centre, radius, 0, 360);
}

export function cubic(from: Point, c1: Point, c2: Point, to: Point): Cubic {
  return { kind: "cubic", from, c1, c2, to };
}

const DEG = Math.PI / 180;

export function polar(origin: Point, length: number, angleDeg: number): Point {
  return [origin[0] + length * Math.cos(angleDeg * DEG), origin[1] + length * Math.sin(angleDeg * DEG)];
}

export function pointOnArc(a: Arc, angleDeg: number): Point {
  return polar(a.centre, a.radius, angleDeg);
}

export function arcStart(a: Arc): Point {
  return pointOnArc(a, a.start);
}

export function arcEnd(a: Arc): Point {
  return pointOnArc(a, a.end);
}

export function arcMid(a: Arc): Point {
  return pointOnArc(a, (a.start + a.end) / 2);
}

export function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function elementLength(e: PathElement): number {
  switch (e.kind) {
    case "segment": return distance(e.from, e.to);
    case "arc": return (Math.abs(e.end - e.start) * DEG) * e.radius;
    case "cubic": return cubicLength(e);
  }
}

/** Where an element starts and ends. */
export function elementStart(e: PathElement): Point {
  return e.kind === "arc" ? arcStart(e) : e.from;
}

export function elementEnd(e: PathElement): Point {
  return e.kind === "arc" ? arcEnd(e) : e.to;
}

export function pathLength(p: Path): number {
  return p.reduce((sum, e) => sum + elementLength(e), 0);
}

/** Bounds of an arc, including the extreme points it passes through. */
export function arcBounds(a: Arc): Bounds {
  const pts: Point[] = [arcStart(a), arcEnd(a)];
  const span = a.end - a.start;
  // Each cardinal angle the arc sweeps through contributes an extreme.
  for (let q = Math.ceil(a.start / 90) * 90; q <= a.start + span + EPS; q += 90) {
    if (q >= a.start - EPS) pts.push(pointOnArc(a, q));
  }
  return boundsOfPoints(pts);
}

export function boundsOfPoints(pts: Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function elementBounds(e: PathElement): Bounds {
  switch (e.kind) {
    case "segment": return boundsOfPoints([e.from, e.to]);
    case "arc": return arcBounds(e);
    case "cubic": return cubicBounds(e);
  }
}

export function pathBounds(p: Path): Bounds {
  return unionBounds(p.map(elementBounds));
}

export function unionBounds(bs: Bounds[]): Bounds {
  return {
    minX: Math.min(...bs.map((b) => b.minX)),
    minY: Math.min(...bs.map((b) => b.minY)),
    maxX: Math.max(...bs.map((b) => b.maxX)),
    maxY: Math.max(...bs.map((b) => b.maxY)),
  };
}

export function boundsSize(b: Bounds, axis: "x" | "y"): number {
  return axis === "x" ? b.maxX - b.minX : b.maxY - b.minY;
}

export function boundsMin(b: Bounds, axis: "x" | "y"): number {
  return axis === "x" ? b.minX : b.minY;
}

export function boundsMax(b: Bounds, axis: "x" | "y"): number {
  return axis === "x" ? b.maxX : b.maxY;
}

// ---- Cubic Béziers ----

/** The point at parameter t (0 at `from`, 1 at `to`). */
export function cubicPoint(c: Cubic, t: number): Point {
  if (t === 0) return c.from;
  if (t === 1) return c.to;
  const s = 1 - t;
  const a = s * s * s, b = 3 * s * s * t, d = 3 * s * t * t, e = t * t * t;
  return [
    a * c.from[0] + b * c.c1[0] + d * c.c2[0] + e * c.to[0],
    a * c.from[1] + b * c.c1[1] + d * c.c2[1] + e * c.to[1],
  ];
}

/** The derivative (velocity) at t. */
export function cubicTangent(c: Cubic, t: number): Point {
  const s = 1 - t;
  const a = 3 * s * s, b = 6 * s * t, d = 3 * t * t;
  return [
    a * (c.c1[0] - c.from[0]) + b * (c.c2[0] - c.c1[0]) + d * (c.to[0] - c.c2[0]),
    a * (c.c1[1] - c.from[1]) + b * (c.c2[1] - c.c1[1]) + d * (c.to[1] - c.c2[1]),
  ];
}

/** The curve's two halves at t (de Casteljau), together exactly the original. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const q0 = lerp(c.from, c.c1, t), q1 = lerp(c.c1, c.c2, t), q2 = lerp(c.c2, c.to, t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t);
  const m = lerp(r0, r1, t);
  return [cubic(c.from, q0, r0, m), cubic(m, r1, q2, c.to)];
}

/** Bounds through the curve's true extremes: its ends and wherever x or y turns. */
export function cubicBounds(c: Cubic): Bounds {
  const pts: Point[] = [c.from, c.to];
  for (const axis of [0, 1] as const) {
    for (const t of turningPoints(c.from[axis], c.c1[axis], c.c2[axis], c.to[axis])) pts.push(cubicPoint(c, t));
  }
  return boundsOfPoints(pts);
}

/** Parameters in (0, 1) where one coordinate's derivative is zero. */
function turningPoints(p0: number, p1: number, p2: number, p3: number): number[] {
  // d/dt over 3: a t² + b t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return roots;
  if (Math.abs(a) <= 1e-12 * scale) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

// Five-point Gauss-Legendre nodes and weights on [-1, 1].
const GAUSS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.5688888888888889],
  [-0.5384693101056831, 0.47862867049936647], [0.5384693101056831, 0.47862867049936647],
  [-0.906179845938664, 0.23692688505618908], [0.906179845938664, 0.23692688505618908],
];

/** Arc length, by adaptive Gauss-Legendre quadrature of the speed. */
function cubicLength(c: Cubic): number {
  const speed = (t: number) => Math.hypot(...cubicTangent(c, t));
  const gauss = (a: number, b: number) => {
    const m = (a + b) / 2, h = (b - a) / 2;
    let sum = 0;
    for (const [x, w] of GAUSS) sum += w * speed(m + h * x);
    return sum * h;
  };
  const refine = (a: number, b: number, whole: number, depth: number): number => {
    const m = (a + b) / 2;
    const left = gauss(a, m), right = gauss(m, b);
    if (depth >= 10 || Math.abs(left + right - whole) <= 1e-10 * Math.max(1, whole)) return left + right;
    return refine(a, m, left, depth + 1) + refine(m, b, right, depth + 1);
  };
  return refine(0, 1, gauss(0, 1), 0);
}

/**
 * Points along the curve, both ends included, such that every chord between
 * neighbours stays within `tolerance` of the curve (and the curve of it). By
 * halving until the control points lie within `tolerance` of the chord: the
 * curve stays inside their hull.
 */
export function flattenCubic(c: Cubic, tolerance: number): Point[] {
  const tol = tolerance > 0 ? tolerance : 1e-3;
  if (![c.from, c.c1, c.c2, c.to].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return [c.from, c.to];
  const out: Point[] = [c.from];
  const walk = (k: Cubic, depth: number) => {
    const flat = distanceToSegment(k.c1, k.from, k.to) <= tol && distanceToSegment(k.c2, k.from, k.to) <= tol;
    if (flat || depth >= 16) { out.push(k.to); return; }
    const [a, b] = splitCubic(k, 0.5);
    walk(a, depth + 1);
    walk(b, depth + 1);
  };
  walk(c, 0);
  out[out.length - 1] = c.to;
  return out;
}

/** Distance from p to the segment a–b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Round to a tolerance so derived values compare cleanly across clients. */
export function snapNumber(v: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
