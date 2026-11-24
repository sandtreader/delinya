import { describe, it, expect } from "vitest";
import { addRadiusLabel, addRect, resolve, rotatePoint, type Point } from "../src/model";
import { RADIUS_LABEL_CAP, RADIUS_LABEL_GAP, radiusLabelPlace } from "../src/view/dimensionText";
import { drawingPrimitives } from "../src/output/primitives";
import { doc } from "./helpers";

// Where a radius label sits: inside the corner's curve, just in from its
// midpoint towards the rect's middle, set in the rect's own frame so it
// turns with the rect. A left corner's label starts there; a right
// corner's ends there (right-aligned against the right-hand edge). A top
// corner's hangs below it, a bottom corner's stands above it. Kept
// readable like dimension text: turned past upright (angles not in
// [-90, 90)), the text turns half round and the corners swap roles
// accordingly (top-left reads as bottom-right).

const size = 3;
const g = RADIUS_LABEL_GAP * size, cap = RADIUS_LABEL_CAP * size;
const k = 10 * Math.SQRT1_2;

function near(p: Point, q: Point) {
  expect(p[0]).toBeCloseTo(q[0], 9);
  expect(p[1]).toBeCloseTo(q[1], 9);
}

const labels = (rotation = 0) => resolve(doc(
  addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 10, 10, 10], rotation }),
  addRadiusLabel("l0", "r", 0), addRadiusLabel("l1", "r", 1), addRadiusLabel("l2", "r", 2), addRadiusLabel("l3", "r", 3),
)).radiusLabels;

describe("radiusLabelPlace", () => {
  it("has the gap and cap height as fractions of the text size", () => {
    expect(RADIUS_LABEL_GAP).toBe(0.3);
    expect(RADIUS_LABEL_CAP).toBe(0.7);
  });

  it("sits inside each corner of an upright rect, right-aligned on the right", () => {
    const [l0, l1, l2, l3] = labels().map((l) => radiusLabelPlace(l, size));
    // The arcs' midpoints: centre less (or plus) r/√2 each way.
    expect(l0).toMatchObject({ angle: 0, anchor: "start" });
    near(l0!.at, [10 - k + g, 10 - k + g + cap]);
    expect(l1).toMatchObject({ angle: 0, anchor: "end" });
    near(l1!.at, [90 + k - g, 10 - k + g + cap]);
    expect(l2).toMatchObject({ angle: 0, anchor: "end" });
    near(l2!.at, [90 + k - g, 40 + k - g]);
    expect(l3).toMatchObject({ angle: 0, anchor: "start" });
    near(l3!.at, [10 - k + g, 40 + k - g]);
  });

  it("turns with the rect", () => {
    const ls = labels(30);
    expect(ls[1]!.rotation).toBe(30);
    const p = radiusLabelPlace(ls[1]!, size);
    expect(p).toMatchObject({ angle: 30, anchor: "end" });
    const d = rotatePoint([-g, g + cap], 30);
    near(p.at, [ls[1]!.at[0] + d[0], ls[1]!.at[1] + d[1]]);
  });

  it("reads the right way up when the rect is turned over", () => {
    // Half round: the top-left corner is bottom right on the page, its inside up and left.
    const [l0] = labels(180);
    const p = radiusLabelPlace(l0!, size);
    expect(p).toMatchObject({ angle: 0, anchor: "end" });
    near(p.at, [l0!.at[0] - g, l0!.at[1] - g]);
    // A quarter turn reads bottom to top, as dimensions do: at 90 the corners swap, at 270 they don't.
    const q = radiusLabelPlace(labels(90)[0]!, size);
    expect(q).toMatchObject({ angle: -90, anchor: "end" });
    expect(radiusLabelPlace(labels(270)[0]!, size)).toMatchObject({ angle: -90, anchor: "start" });
  });

  it("goes in from the corner itself when it is sharp", () => {
    const [l] = resolve(doc(addRect("r", { x: 0, y: 0, width: 100, height: 50 }), addRadiusLabel("l", "r", 2))).radiusLabels;
    near(radiusLabelPlace(l!, size).at, [100 - g, 50 - g]);
  });
});

describe("in output", () => {
  it("is placed the same way", () => {
    const r = resolve(doc(
      addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 10, 10, 10], rotation: 30 }),
      addRadiusLabel("l1", "r", 1),
    ));
    const [t] = drawingPrimitives(r, { dimensions: true, textSize: size, tick: 1 }).filter((p) => p.kind === "text");
    const p = radiusLabelPlace(r.radiusLabels[0]!, size);
    expect(t).toMatchObject({ kind: "text", anchor: "end", angle: 30, text: "4× R10" });
    near(t!.kind === "text" ? t!.at : [0, 0], p.at);
  });
});
