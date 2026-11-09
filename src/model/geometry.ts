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

export type PathElement = Segment | Arc;
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

export function elementLength(e: PathElement): number {
  if (e.kind === "segment") return distance(e.from, e.to);
  return (Math.abs(e.end - e.start) * DEG) * e.radius;
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

export function pathBounds(p: Path): Bounds {
  const parts = p.map((e) => (e.kind === "segment" ? boundsOfPoints([e.from, e.to]) : arcBounds(e)));
  return unionBounds(parts);
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

/** Round to a tolerance so derived values compare cleanly across clients. */
export function snapNumber(v: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
