import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  addCircle, addDimension, addLine, addPolyline, addRadiusLabel, addRect, addVariable, duplicateShapes,
  flipShapes, handlesFor, linkAlign, resolve, rotateShapes, setRotation,
} from "../src/model";
import type { Point, PolyNode, ResolvedCircle, ResolvedLine, ResolvedPolyline, ResolvedRect } from "../src/model";
import { shapeStatus } from "../src/view/format";
import { doc } from "./helpers";

// Rotation. A rect stores `rotation` (degrees, clockwise on screen like a
// line's angle) about its (x, y) corner, so its sizes stay editable. Rotating
// or flipping a selection turns each shape about one pivot (by default the
// centre of the selection's bounds): a line's start and angle, a circle's
// centre, a path's nodes and handles, a rect's corner and rotation.

const apply = (state: DocState, c: Change | undefined): DocState => {
  expect(c).toBeDefined();
  return applyChange(state, c!);
};
const rect = (state: DocState, id = "r") => resolve(state).shapes[id] as ResolvedRect;
const props = (state: DocState, id: string) => state.entities[id]!.props as Record<string, unknown>;
const sortPts = (ps: readonly Point[]) => [...ps].map((p) => [p[0], p[1]]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe("a rotated rect resolves", () => {
  it("turns about its (x, y) corner", () => {
    const r = rect(doc(addRect("r", { x: 10, y: 20, width: 100, height: 50, rotation: 90 })));
    expect(r.rotation).toBe(90);
    expect(r.corners).toEqual([[10, 20], [10, 120], [-40, 120], [-40, 20]]);
    expect(r.bounds).toEqual({ minX: -40, minY: 20, maxX: 10, maxY: 120 });
    // Width and height are still its own sides.
    expect([r.x, r.y, r.width, r.height]).toEqual([10, 20, 100, 50]);
  });

  it("has no rotation when none is stored", () => {
    expect(rect(doc(addRect("r", { x: 0, y: 0, width: 10, height: 10 }))).rotation).toBe(0);
  });

  it("turns its corner arcs and snaps with it", () => {
    const r = rect(doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 0, 0, 0], rotation: 90 })));
    expect(r.arcs[0]!.centre).toEqual([-10, 10]);
    expect([r.arcs[0]!.start, r.arcs[0]!.end]).toEqual([270, 360]);
    expect(r.snaps).toContainEqual({ point: [-25, 50], type: "centre" });
    expect(r.snaps).toContainEqual({ point: [0, 50], type: "midpoint" });
  });

  it("measures width and height along its turned sides", () => {
    const res = resolve(doc(
      addRect("r", { x: 10, y: 20, width: 100, height: 50, rotation: 90 }),
      addDimension("dw", "r", "width", 10),
      addDimension("dh", "r", "height", 10),
    ));
    const [dw, dh] = res.dimensions;
    expect(dw!.value).toBe(100);
    expect(dw!.anchors).toEqual([[10, 20], [10, 120]]);
    expect(dw!.line).toEqual({ kind: "segment", from: [20, 20], to: [20, 120] });
    expect(dh!.anchors).toEqual([[10, 20], [-40, 20]]);
    expect(dh!.line).toEqual({ kind: "segment", from: [10, 10], to: [-40, 10] });
  });

  it("keeps its rotation when a link moves it, placed by its turned bounds", () => {
    const res = resolve(doc(
      addRect("a", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("r", { x: 100, y: 0, width: 100, height: 50, rotation: 90 }),
      linkAlign("k", "a", ["r"], "x", "start"),
    ));
    const r = res.shapes.r as ResolvedRect;
    expect(r.rotation).toBe(90);
    expect(r.bounds.minX).toBe(0);
    expect(r.x).toBe(50);
  });

  it("is copied by Duplicate", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 10, height: 20, rotation: 30 }));
    let n = 0;
    const out = duplicateShapes(st, ["r"], [50, 0], (p) => `${p}${++n}`)!;
    const copy = applyChange(st, out.change);
    expect(rect(copy, out.ids[0]!).rotation).toBe(30);
  });

  it("shows its angle in the status bar when turned", () => {
    const st = doc(addRect("a", { x: 10, y: 20, width: 50, height: 30, rotation: 30 }), addRect("b", { x: 10, y: 20, width: 50, height: 30 }));
    expect(shapeStatus(resolve(st).shapes.a!)).toBe("from 10, 20 mm · 50 × 30 mm at 30°");
    expect(shapeStatus(resolve(st).shapes.b!)).toBe("from 10, 20 mm · 50 × 30 mm");
  });

  it("has no resize handles yet (they come with the canvas rotate handle)", () => {
    expect(handlesFor(rect(doc(addRect("r", { x: 0, y: 0, width: 10, height: 20, rotation: 30 }))))).toEqual([]);
    expect(handlesFor(rect(doc(addRect("r", { x: 0, y: 0, width: 10, height: 20, rotation: 0 }))))).toHaveLength(4);
  });
});

describe("rotateShapes", () => {
  const base = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50 }));

  it("turns one rect about its centre", () => {
    const st = apply(base, rotateShapes(base, ["r"], 90));
    expect(props(st, "r")).toMatchObject({ x: 75, y: -25, width: 100, height: 50, rotation: 90 });
    expect(rect(st).bounds).toEqual({ minX: 25, minY: -25, maxX: 75, maxY: 75 });
  });

  it("comes back exactly after four quarter turns", () => {
    let st = base;
    for (let i = 0; i < 4; i++) st = apply(st, rotateShapes(st, ["r"], 90));
    const r = rect(st);
    expect([r.x, r.y, r.rotation]).toEqual([0, 0, 0]);
  });

  it("keeps the stored rotation in [0, 360)", () => {
    expect(props(apply(base, rotateShapes(base, ["r"], -90)), "r").rotation).toBe(270);
    expect(props(apply(base, rotateShapes(base, ["r"], 450)), "r").rotation).toBe(90);
  });

  it("turns about a given pivot", () => {
    const st = apply(base, rotateShapes(base, ["r"], 90, [0, 0]));
    expect(props(st, "r")).toMatchObject({ x: 0, y: 0, rotation: 90 });
  });

  it("turns a line's start and angle, leaving a linked length alone", () => {
    const st0 = doc(addVariable("v", 10), addLine("l", { x: 0, y: 0, length: { ref: "v" }, angle: 0 }));
    const st = apply(st0, rotateShapes(st0, ["l"], 90));
    expect(props(st, "l")).toEqual({ x: 5, y: -5, length: { ref: "v" }, angle: 90 });
    const l = resolve(st).shapes.l as ResolvedLine;
    expect(l.to).toEqual([5, 5]);
  });

  it("turns a selection about the centre of its bounds", () => {
    const st0 = doc(addCircle("a", { cx: 0, cy: 0, diameter: 10 }), addCircle("b", { cx: 100, cy: 0, diameter: 10 }));
    const st = apply(st0, rotateShapes(st0, ["a", "b"], 90));
    const res = resolve(st);
    expect((res.shapes.a as ResolvedCircle).centre).toEqual([50, -50]);
    expect((res.shapes.b as ResolvedCircle).centre).toEqual([50, 50]);
    expect((res.shapes.a as ResolvedCircle).diameter).toBe(10);
  });

  it("turns a path's nodes and handles", () => {
    const nodes: PolyNode[] = [{ x: 0, y: 0, type: "cusp", out: [10, 0] }, { x: 100, y: 0, type: "cusp" }];
    const st0 = doc(addPolyline("p", { nodes }));
    const st = apply(st0, rotateShapes(st0, ["p"], 90, [0, 0]));
    expect(props(st, "p").nodes).toEqual([{ x: 0, y: 0, type: "cusp", out: [0, 10] }, { x: 0, y: 100, type: "cusp" }]);
  });

  it("does nothing for no turn or no shapes", () => {
    const st0 = doc(addVariable("v", 1), addRect("r", { x: 0, y: 0, width: 1, height: 1 }));
    expect(rotateShapes(st0, ["r"], 0)).toBeUndefined();
    expect(rotateShapes(st0, ["r"], 360)).toBeUndefined();
    expect(rotateShapes(st0, ["v"], 90)).toBeUndefined();
    expect(rotateShapes(st0, [], 90)).toBeUndefined();
  });
});

describe("flipShapes", () => {
  it("flips an upright rect in place, swapping its corner radii", () => {
    const st0 = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [1, 2, 3, 4] }));
    const h = apply(st0, flipShapes(st0, ["r"], "x"));
    expect(props(h, "r")).toMatchObject({ x: 0, y: 0, rotation: 0, r: [2, 1, 4, 3] });
    const v = apply(st0, flipShapes(st0, ["r"], "y"));
    expect(props(v, "r")).toMatchObject({ x: 0, y: 0, rotation: 0, r: [4, 3, 2, 1] });
  });

  it("mirrors a turned rect", () => {
    const st0 = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, rotation: 30 }));
    const before = rect(st0).corners;
    const st = apply(st0, flipShapes(st0, ["r"], "x", [0, 0]));
    const after = rect(st);
    expect(after.rotation).toBe(330);
    const mirrored = before.map(([x, y]) => [-x, y] as Point);
    const round = (ps: readonly Point[]) => sortPts(ps).map(([x, y]) => [Math.round(x! * 1e6) / 1e6 + 0, Math.round(y! * 1e6) / 1e6 + 0]);
    expect(round(after.corners)).toEqual(round(mirrored));
  });

  it("moves a radius label with its corner", () => {
    const st0 = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [5, 0, 0, 0] }), addRadiusLabel("lab", "r", 0));
    const st = apply(st0, flipShapes(st0, ["r"], "x"));
    expect(props(st, "lab").corner).toBe(1);
    expect(resolve(st).radiusLabels[0]!.radius).toBe(5);
  });

  it("mirrors a line's start and angle", () => {
    const st0 = doc(addLine("l", { x: 10, y: 0, length: 10, angle: 30 }));
    expect(props(apply(st0, flipShapes(st0, ["l"], "x", [0, 0])), "l")).toMatchObject({ x: -10, y: 0, angle: 150 });
    expect(props(apply(st0, flipShapes(st0, ["l"], "y", [0, 0])), "l")).toMatchObject({ x: 10, y: 0, angle: 330 });
  });

  it("mirrors a path's nodes and handles", () => {
    const nodes: PolyNode[] = [{ x: 0, y: 0, type: "curve", in: [-5, 0], out: [10, 5] }, { x: 20, y: 10, type: "cusp" }];
    const st0 = doc(addPolyline("p", { nodes }));
    const st = apply(st0, flipShapes(st0, ["p"], "x", [0, 0]));
    expect(props(st, "p").nodes).toEqual([{ x: 0, y: 0, type: "curve", in: [5, 0], out: [-10, 5] }, { x: -20, y: 10, type: "cusp" }]);
    expect((resolve(st).shapes.p as ResolvedPolyline).nodes).toHaveLength(2);
  });

  it("mirrors a selection about the centre of its bounds", () => {
    const st0 = doc(addCircle("a", { cx: 0, cy: 0, diameter: 10 }), addCircle("b", { cx: 100, cy: 20, diameter: 10 }));
    const st = apply(st0, flipShapes(st0, ["a", "b"], "x"));
    const res = resolve(st);
    expect((res.shapes.a as ResolvedCircle).centre).toEqual([100, 0]);
    expect((res.shapes.b as ResolvedCircle).centre).toEqual([0, 20]);
  });

  it("does nothing with no shapes", () => {
    expect(flipShapes(doc(), ["x"], "x")).toBeUndefined();
  });
});

describe("setRotation", () => {
  const base = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50 }));

  it("turns a rect to an angle about its centre", () => {
    const st = apply(base, setRotation(base, "r", 90));
    expect(props(st, "r")).toMatchObject({ x: 75, y: -25, rotation: 90 });
    const back = apply(st, setRotation(st, "r", 0));
    expect(props(back, "r")).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });

  it("normalises the angle and skips no change", () => {
    expect(props(apply(base, setRotation(base, "r", 450)), "r").rotation).toBe(90);
    expect(setRotation(base, "r", 360)).toBeUndefined();
    expect(setRotation(base, "missing", 10)).toBeUndefined();
  });
});
