import { describe, it, expect } from "vitest";
import type { Change } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, KINDS, addCircle, addLine, addRect, resolve } from "../src/model";
import { lassoSelect, lassoMode } from "../src/canvas/lasso";
import { doc } from "./helpers";

const layer = (id: string, order: number): Change => ({ type: "entity_added", id, kind: KINDS.layer, props: { order } });

const r = resolve(doc(
  layer(BASE_LAYER_ID, 0), layer("hid", 1), layer("lock", 2),
  addRect("a", { x: 10, y: 10, width: 20, height: 10 }),       // 10..30 × 10..20
  addCircle("c", { cx: 50, cy: 15, diameter: 10 }),             // 45..55 × 10..20
  addLine("l", { x: 10, y: 40, length: 30, angle: 0 }),          // 10..40 × 40
  addRect("h", { x: 12, y: 12, width: 2, height: 2, layer: "hid" }),
  addRect("k", { x: 14, y: 14, width: 2, height: 2, layer: "lock" }),
));
const none = { hidden: new Set<string>(), locked: new Set<string>() };
const view = { hidden: new Set(["hid"]), locked: new Set(["lock"]) };

describe("lassoSelect", () => {
  it("selects the shapes wholly inside the rectangle, in draw order", () => {
    expect(lassoSelect(r, [0, 0], [60, 50], none)).toEqual(["a", "c", "l", "h", "k"]);
    expect(lassoSelect(r, [5, 5], [35, 25], none)).toEqual(["a", "h", "k"]);
  });

  it("leaves out a shape that only overlaps the rectangle", () => {
    expect(lassoSelect(r, [5, 5], [50, 25], none)).toEqual(["a", "h", "k"]);
  });

  it("works whichever way it was dragged", () => {
    expect(lassoSelect(r, [35, 25], [5, 5], none)).toEqual(["a", "h", "k"]);
    expect(lassoSelect(r, [35, 5], [5, 25], none)).toEqual(["a", "h", "k"]);
  });

  it("counts a shape touching the edge as inside", () => {
    expect(lassoSelect(r, [10, 10], [30, 20], none)).toEqual(["a", "h", "k"]);
  });

  it("skips shapes on layers this viewer has hidden or locked", () => {
    expect(lassoSelect(r, [0, 0], [60, 50], view)).toEqual(["a", "c", "l"]);
  });
});

describe("lassoMode", () => {
  it("a mouse or pen drag on the background lassoes; a finger pans", () => {
    expect(lassoMode("mouse")).toBe("lasso");
    expect(lassoMode("pen")).toBe("lasso");
    expect(lassoMode("touch")).toBe("pan");
  });
});
