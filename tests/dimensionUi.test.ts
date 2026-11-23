import { describe, it, expect } from "vitest";
import { addCircle, addDimension, addLine, addRadiusLabel, addRect, distanceToArc, arc, dimensionTargetAt, resolve } from "../src/model";
import { dimensionText } from "../src/view/dimensionText";
import { targetPath } from "../src/view/dimensionTarget";
import { dimensionStatus, positionStatus } from "../src/view/format";
import { doc } from "./helpers";

// The Dimension tool's helpers on screen: what it highlights, what the
// status bar says, and that a far-side dimension's value still reads away
// from its shape.

describe("a far-side dimension's value", () => {
  it("reads below a width under its rect and right of a height beside it", () => {
    const r = resolve(doc(
      addRect("r", { x: 0, y: 0, width: 100, height: 50 }),
      addDimension("w", "r", "width", -10),
      addDimension("h", "r", "height", -10),
      addCircle("c", { cx: 50, cy: 200, diameter: 20 }),
      addDimension("d", "c", "diameter", -5),
    ));
    const [w, h, d] = r.dimensions;
    expect(dimensionText(w!)).toEqual({ angle: 0, above: false });
    // Vertical text reads bottom to top, so "below" is to its right.
    expect(dimensionText(h!)).toEqual({ angle: -90, above: false });
    expect(dimensionText(d!).above).toBe(false);
  });
});

describe("distanceToArc", () => {
  const a = arc([0, 0], 10, 180, 270);   // the top-left quarter
  it("is to the circle within the sweep, else to the nearer end", () => {
    expect(distanceToArc([-12 * Math.SQRT1_2, -12 * Math.SQRT1_2], a)).toBeCloseTo(2);
    expect(distanceToArc([10, 0], a)).toBeCloseTo(Math.hypot(10, 10));
    expect(distanceToArc([0, 5], a)).toBeCloseTo(Math.hypot(10, 5));
  });

  it("handles a sweep that runs past 360", () => {
    const b = arc([0, 0], 10, 300, 390);
    expect(distanceToArc([10, 0], b)).toBeCloseTo(0);
    expect(distanceToArc([0, 10], b)).toBeCloseTo(Math.hypot(10 * Math.cos(Math.PI / 6), 10 - 10 * Math.sin(Math.PI / 6)));
  });
});

describe("what the Dimension tool highlights", () => {
  const r = resolve(doc(
    addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 0, 0, 0] }),
    addRect("t", { x: 300, y: 0, width: 100, height: 50, rotation: 90 }),
    addCircle("c", { cx: 200, cy: 25, diameter: 40 }),
    addLine("l", { x: 0, y: 100, length: 50, angle: 0 }),
  ));

  it("is the straight part of the rect's edge nearer the pointer", () => {
    expect(targetPath(r, { kind: "dimension", target: "r", prop: "width" }, [50, 1])).toEqual([{ kind: "segment", from: [10, 0], to: [100, 0] }]);
    expect(targetPath(r, { kind: "dimension", target: "r", prop: "width" }, [50, 49])).toEqual([{ kind: "segment", from: [0, 50], to: [100, 50] }]);
    expect(targetPath(r, { kind: "dimension", target: "r", prop: "height" }, [99, 30])).toEqual([{ kind: "segment", from: [100, 0], to: [100, 50] }]);
  });

  it("turns with a turned rect", () => {
    // Turned 90° about (300, 0): its top edge runs down x = 300.
    const [e] = targetPath(r, { kind: "dimension", target: "t", prop: "width" }, [299, 50]);
    expect(e).toMatchObject({ kind: "segment" });
    const seg = e as { from: [number, number]; to: [number, number] };
    expect(seg.from[0]).toBeCloseTo(300);
    expect(seg.to[0]).toBeCloseTo(300);
    expect(seg.to[1]).toBeCloseTo(100);
  });

  it("is a corner's arc, a circle's outline or a line", () => {
    expect(targetPath(r, { kind: "radius", target: "r", corner: 0 }, [3, 3])).toEqual([r.shapes.r!.kind === "rect" && r.shapes.r!.arcs[0]]);
    expect(targetPath(r, { kind: "dimension", target: "c", prop: "diameter" }, [220, 25])).toBe(r.shapes.c!.path);
    expect(targetPath(r, { kind: "dimension", target: "l", prop: "length" }, [20, 100])).toBe(r.shapes.l!.path);
    expect(targetPath(r, { kind: "dimension", target: "gone", prop: "length" }, [0, 0])).toEqual([]);
  });

  it("finds a turned rect's sides in its own frame", () => {
    // Its top edge (width) runs down x = 300; its far side (height's) along y = 100 from x 250 to 300.
    expect(dimensionTargetAt(r, [301, 50], 2)).toEqual({ kind: "dimension", target: "t", prop: "width" });
    expect(dimensionTargetAt(r, [280, 101], 2)).toEqual({ kind: "dimension", target: "t", prop: "height" });
  });
});

describe("the status bar with the Dimension tool", () => {
  const r = resolve(doc(
    addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [5, 0, 0, 0] }),
    addRadiusLabel("lab", "r", 0),
  ));

  it("says what would be measured, and the offset of one being placed", () => {
    expect(dimensionStatus({ kind: "dimension", target: "r", prop: "width" }, undefined, r)).toBe("width 100 mm");
    expect(dimensionStatus({ kind: "dimension", target: "r", prop: "height" }, 12, r)).toBe("height 50 mm · offset 12 mm");
    expect(dimensionStatus({ kind: "dimension", target: "r", prop: "width" }, -8.5, r)).toBe("width 100 mm · offset 8.5 mm, far side");
  });

  it("says whether a click adds or removes a corner's label", () => {
    expect(dimensionStatus({ kind: "radius", target: "r", corner: 0 }, undefined, r)).toBe("top-left corner R5 mm · click to remove its label");
    expect(dimensionStatus({ kind: "radius", target: "r", corner: 1 }, undefined, r)).toBe("top-right corner R0 mm · click to label it");
  });

  it("comes before the pointer position, and falls back to it once the shape has gone", () => {
    const e = { tool: "dimension" as const, selection: [], cursor: [1, 2] as [number, number], draw: null, measure: null };
    expect(positionStatus({ ...e, dimension: { what: { kind: "dimension", target: "r", prop: "width" } } }, r)).toBe("width 100 mm");
    expect(positionStatus({ ...e, dimension: { what: { kind: "dimension", target: "gone", prop: "width" } } }, r)).toBe("1, 2 mm");
  });
});
