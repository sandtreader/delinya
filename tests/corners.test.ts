import { describe, it, expect } from "vitest";
import { applyChange, type DocState } from "@sandtreader/collab/protocol";
import {
  ALL_CORNERS_LABEL_CORNER, addRadiusLabel, addRect, addVariable, cornersAlike, joinCorners, radiusLabelsOf, resolve,
  setAllCornerRadii, toggleAllCornersLabel,
} from "../src/model";
import { radiusLabelText } from "../src/view/dimensionText";
import { drawingPrimitives } from "../src/output/primitives";
import { toWinAnsi } from "../src/output/text";
import { doc } from "./helpers";

// Corner radii, all together: the shape panel shows one radius and one
// label field for all four corners while they are alike (the same stored
// radius, a number or one variable, and at most one radius label), or one
// per corner when switched off. Switching back on gives every corner the
// largest radius and keeps a label if any corner had one. A single label
// standing for four equal corners reads "4× R10", as drawings show it.

const labelled = (st: DocState, id = "r") => ([0, 1, 2, 3] as const).filter((c) => radiusLabelsOf(st, id, c).length > 0);

describe("cornersAlike: whether one field can stand for all four", () => {
  it("is so for a new rect and for four equal radii with at most one label", () => {
    expect(cornersAlike(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30 })), "r")).toBe(true);
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 5] }), addRadiusLabel("a", "r", 2));
    expect(cornersAlike(st, "r")).toBe(true);
    expect(cornersAlike(applyChange(st, addRadiusLabel("b", "r", 0)), "r")).toBe(false);
  });

  it("is not for different radii, or a variable beside a number of the same value", () => {
    expect(cornersAlike(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 6] })), "r")).toBe(false);
    const v = { ref: "v" };
    expect(cornersAlike(doc(addVariable("v", 5), addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [v, v, v, v] })), "r")).toBe(true);
    expect(cornersAlike(doc(addVariable("v", 5), addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [v, 5, 5, 5] })), "r")).toBe(false);
  });

  it("is false for what isn't a rect", () => {
    expect(cornersAlike(doc(), "missing")).toBe(false);
  });
});

describe("setAllCornerRadii", () => {
  it("sets every corner to the value", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [1, 2, 3, 4] }));
    expect(applyChange(st, setAllCornerRadii(st, "r", 7)!).entities.r!.props.r).toEqual([7, 7, 7, 7]);
    const none = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30 }));
    expect(applyChange(none, setAllCornerRadii(none, "r", 3)!).entities.r!.props.r).toEqual([3, 3, 3, 3]);
  });

  it("edits the variable when all four share one", () => {
    const v = { ref: "v" };
    const st = doc(addVariable("v", 5), addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [v, v, v, v] }));
    const after = applyChange(st, setAllCornerRadii(st, "r", 8)!);
    expect(after.entities.v!.props.value).toBe(8);
    expect(after.entities.r!.props.r).toEqual([v, v, v, v]);
  });

  it("is undefined when nothing would change, or for a bad value", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [4, 4, 4, 4] }));
    expect(setAllCornerRadii(st, "r", 4)).toBeUndefined();
    expect(setAllCornerRadii(st, "r", -1)).toBeUndefined();
    expect(setAllCornerRadii(st, "missing", 4)).toBeUndefined();
  });
});

describe("joinCorners: switching back to all together", () => {
  it("gives every corner the largest radius, as stored", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [2, 9, 5, 0] }));
    expect(applyChange(st, joinCorners(st, "r")!).entities.r!.props.r).toEqual([9, 9, 9, 9]);
    // The largest linked: they all link to it.
    const v = { ref: "v" };
    const linked = doc(addVariable("v", 9), addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [2, v, 5, 0] }));
    expect(applyChange(linked, joinCorners(linked, "r")!).entities.r!.props.r).toEqual([v, v, v, v]);
  });

  it("keeps one label, on the first corner labelled, if any had one", () => {
    const st = doc(
      addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [2, 9, 5, 3] }),
      addRadiusLabel("a", "r", 3), addRadiusLabel("b", "r", 1),
    );
    const after = applyChange(st, joinCorners(st, "r")!);
    expect(labelled(after)).toEqual([1]);
    expect(cornersAlike(after, "r")).toBe(true);
    const bare = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [2, 9, 5, 3] }));
    expect(labelled(applyChange(bare, joinCorners(bare, "r")!))).toEqual([]);
  });

  it("is undefined when they are alike already", () => {
    expect(joinCorners(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [4, 4, 4, 4] })), "r")).toBeUndefined();
    expect(joinCorners(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30 })), "r")).toBeUndefined();
  });
});

describe("toggleAllCornersLabel: the one label field", () => {
  it("adds a label on the bottom-right corner, clear of the width and height dimensions", () => {
    expect(ALL_CORNERS_LABEL_CORNER).toBe(2);
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [4, 4, 4, 4] }));
    const after = applyChange(st, toggleAllCornersLabel(st, "r", "lab")!);
    expect(after.entities.lab).toMatchObject({ kind: "radius-label", props: { target: "r", corner: 2 } });
  });

  it("takes off every label there is", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [4, 4, 4, 4] }), addRadiusLabel("a", "r", 0), addRadiusLabel("b", "r", 3));
    expect(labelled(applyChange(st, toggleAllCornersLabel(st, "r", "x")!))).toEqual([]);
  });
});

describe("a label for four equal corners", () => {
  it("counts four when it is the rect's only label and every corner is drawn the same", () => {
    const one = resolve(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 5] }), addRadiusLabel("a", "r", 2)));
    expect(one.radiusLabels[0]!.count).toBe(4);
    // Clamped alike: 100 each on a 50 × 30 rect draws 15 each.
    const clamped = resolve(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [100, 100, 100, 100] }), addRadiusLabel("a", "r", 0)));
    expect(clamped.radiusLabels[0]!).toMatchObject({ radius: 15, count: 4 });
  });

  it("counts one where corners differ or another label is there", () => {
    const differ = resolve(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 6] }), addRadiusLabel("a", "r", 2)));
    expect(differ.radiusLabels[0]!.count).toBe(1);
    const two = resolve(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 5] }), addRadiusLabel("a", "r", 2), addRadiusLabel("b", "r", 0)));
    expect(two.radiusLabels.map((l) => l.count)).toEqual([1, 1]);
  });

  it("reads 4× R5, on screen and in output", () => {
    const r = resolve(doc(addRect("r", { x: 0, y: 0, width: 50, height: 30, r: [5, 5, 5, 5] }), addRadiusLabel("a", "r", 2)));
    expect(radiusLabelText(r.radiusLabels[0]!)).toBe("4× R5");
    expect(radiusLabelText({ ...r.radiusLabels[0]!, count: 1 })).toBe("R5");
    const texts = drawingPrimitives(r, { dimensions: true, textSize: 3, tick: 1 }).filter((p) => p.kind === "text").map((p) => p.kind === "text" && p.text);
    expect(texts).toContain("4× R5");
    // The PDF's Helvetica has the times sign.
    expect(toWinAnsi("×")).toEqual([0xd7]);
  });
});
