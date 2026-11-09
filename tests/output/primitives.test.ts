import { describe, it, expect } from "vitest";
import {
  type Path, type Point, type Segment, addCircle, addDimension, addLine, addRadiusLabel, addRect, resolve,
} from "../../src/model";
import { drawingPrimitives, primitivesBounds } from "../../src/output/primitives";
import { textWidth } from "../../src/output/text";
import type { PathPrim, Primitive, TextPrim } from "../../src/output/types";
import { doc } from "../helpers";

const SIZE = 3, TICK = 1.2;

function sample() {
  return resolve(doc(
    addRect("a", { x: 0, y: 0, width: 100, height: 50 }),
    addRect("b", { x: 200, y: 0, width: 100, height: 50, r: [0, 10, 0, 0] }),
    addCircle("c", { cx: 10, cy: 120, diameter: 10 }),
    addLine("l", { x: 0, y: 200, length: 80, angle: 0 }),
    addDimension("dw", "a", "width"),
    addDimension("dh", "a", "height"),
    addRadiusLabel("rl", "b", 1),
  ));
}

const paths = (ps: Primitive[], role: string) => ps.filter((p): p is PathPrim => p.kind === "path" && p.role === role);
const texts = (ps: Primitive[]) => ps.filter((p): p is TextPrim => p.kind === "text");
const segmentsOf = (ps: PathPrim[]) => ps.flatMap((p) => p.path).filter((e): e is Segment => e.kind === "segment");

function hasSegment(segs: Segment[], a: Point, b: Point) {
  const close = (p: Point, q: Point) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  return segs.some((s) => (close(s.from, a) && close(s.to, b)) || (close(s.from, b) && close(s.to, a)));
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

describe("drawingPrimitives", () => {
  it("gives one shape path per shape, in draw order, with the resolved path", () => {
    const r = sample();
    const shapes = paths(drawingPrimitives(r, { dimensions: true, textSize: SIZE, tick: TICK }), "shape");
    expect(shapes.map((p) => p.path)).toEqual(r.order.map((id) => r.shapes[id]!.path as Path));
  });

  it("leaves out dimensions and labels when asked", () => {
    const prims = drawingPrimitives(sample(), { dimensions: false, textSize: SIZE, tick: TICK });
    expect(prims.every((p) => p.role === "shape" && p.kind === "path")).toBe(true);
    expect(prims.length).toBe(4);
  });

  it("draws a dimension's line, extension lines and end ticks", () => {
    const segs = segmentsOf(paths(drawingPrimitives(sample(), { dimensions: true, textSize: SIZE, tick: TICK }), "dimension"));
    // Width dimension: 10 mm above the top edge.
    expect(hasSegment(segs, [0, -10], [100, -10])).toBe(true);
    expect(hasSegment(segs, [0, 0], [0, -10])).toBe(true);
    expect(hasSegment(segs, [100, 0], [100, -10])).toBe(true);
    expect(hasSegment(segs, [0, -10 - TICK], [0, -10 + TICK])).toBe(true);
    expect(hasSegment(segs, [100, -10 - TICK], [100, -10 + TICK])).toBe(true);
    // Height dimension: 10 mm left of the left edge; ticks run across it.
    expect(hasSegment(segs, [-10, 0], [-10, 50])).toBe(true);
    expect(hasSegment(segs, [-10 - TICK, 50], [-10 + TICK, 50])).toBe(true);
  });

  it("sets dimension text above a horizontal line and reading upwards beside a vertical one", () => {
    const ts = texts(drawingPrimitives(sample(), { dimensions: true, textSize: SIZE, tick: TICK }));
    const w = ts.find((t) => t.text === "100")!;
    expect(w).toMatchObject({ role: "dimension", anchor: "middle", size: SIZE });
    expect(norm(w.angle)).toBeCloseTo(0);
    expect(w.at[0]).toBeCloseTo(50);
    expect(w.at[1]).toBeCloseTo(-10 - 0.3 * SIZE);

    const h = ts.find((t) => t.text === "50")!;
    expect(norm(h.angle)).toBeCloseTo(270);
    expect(h.at[0]).toBeCloseTo(-10 - 0.3 * SIZE);
    expect(h.at[1]).toBeCloseTo(25);
  });

  it("labels corner radii at the arc midpoint", () => {
    const r = sample();
    const label = r.radiusLabels[0]!;
    const t = texts(drawingPrimitives(r, { dimensions: true, textSize: SIZE, tick: TICK })).find((x) => x.text === "R10")!;
    expect(t).toMatchObject({ role: "dimension", anchor: "start", size: SIZE });
    expect(norm(t.angle)).toBeCloseTo(0);
    expect(t.at[0]).toBeCloseTo(label.at[0]);
    expect(t.at[1]).toBeCloseTo(label.at[1] - 0.4 * SIZE);
  });

  it("scales text and ticks with the options", () => {
    const big = drawingPrimitives(sample(), { dimensions: true, textSize: 30, tick: 12 });
    expect(texts(big).every((t) => t.size === 30)).toBe(true);
    expect(hasSegment(segmentsOf(paths(big, "dimension")), [0, -22], [0, 2])).toBe(true);
  });

  it("is empty for an empty drawing", () => {
    expect(drawingPrimitives(resolve(doc()), { dimensions: true, textSize: SIZE, tick: TICK })).toEqual([]);
  });
});

describe("primitivesBounds", () => {
  it("is null for nothing", () => {
    expect(primitivesBounds([])).toBeNull();
  });

  it("is the shape bounds when there is no text", () => {
    const r = resolve(doc(addRect("a", { x: 5, y: 6, width: 100, height: 50 }), addCircle("c", { cx: 0, cy: 0, diameter: 4 })));
    expect(primitivesBounds(drawingPrimitives(r, { dimensions: false, textSize: SIZE, tick: TICK }))).toEqual({
      minX: -2, minY: -2, maxX: 105, maxY: 56,
    });
  });

  it("includes the extent of text", () => {
    const t: TextPrim = { kind: "text", role: "dimension", at: [50, 0], text: "100", angle: 0, size: 3, anchor: "middle" };
    const b = primitivesBounds([t])!;
    const half = textWidth("100", 3) / 2;
    expect(b.minX).toBeCloseTo(50 - half);
    expect(b.maxX).toBeCloseTo(50 + half);
    expect(b.minY).toBeLessThanOrEqual(-2);   // ascends above the baseline
    expect(b.maxY).toBeGreaterThanOrEqual(0);

    const up: TextPrim = { ...t, angle: 270 };
    const ub = primitivesBounds([up])!;
    expect(ub.minY).toBeCloseTo(-half);
    expect(ub.maxY).toBeCloseTo(half);
    expect(ub.minX).toBeLessThanOrEqual(-2 + 50);
  });
});
