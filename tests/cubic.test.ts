import { describe, it, expect } from "vitest";
import { cubic, cubicBounds, cubicPoint, elementLength, flattenCubic, pathBounds, segment } from "../src/model";

// A hump: (0,0) up to (10,0) via controls straight above each end.
const hump = cubic([0, 0], [0, 10], [10, 10], [10, 0]);

describe("cubic Bézier", () => {
  it("runs from its start to its end", () => {
    expect(cubicPoint(hump, 0)).toEqual([0, 0]);
    expect(cubicPoint(hump, 1)).toEqual([10, 0]);
    expect(cubicPoint(hump, 0.5)).toEqual([5, 7.5]);
  });

  it("is bounded by its true extremes, not its control points", () => {
    const b = cubicBounds(hump);
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(7.5);
    expect(pathBounds([segment([-5, 0], [0, 0]), hump]).minX).toBeCloseTo(-5);
    expect(pathBounds([hump]).maxY).toBeCloseTo(7.5);
  });

  it("measures its length", () => {
    expect(elementLength(cubic([0, 0], [0, 0], [10, 0], [10, 0]))).toBeCloseTo(10, 6);
    // The hump is longer than its chord and shorter than its control polygon.
    const l = elementLength(hump);
    expect(l).toBeGreaterThan(10);
    expect(l).toBeLessThan(30);
  });

  it("flattens to points on the curve, within the tolerance, ends included", () => {
    const pts = flattenCubic(hump, 0.05);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([10, 0]);
    expect(pts.length).toBeGreaterThan(4);
    // Each chord's midpoint stays close to the curve.
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      let best = Infinity;
      for (let t = 0; t <= 1; t += 0.001) {
        const [x, y] = cubicPoint(hump, t);
        best = Math.min(best, Math.hypot(x - mx, y - my));
      }
      expect(best).toBeLessThan(0.05);
    }
  });
});
