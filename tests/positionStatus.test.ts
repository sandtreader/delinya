import { describe, it, expect } from "vitest";
import { addCircle, addRect, resolve } from "../src/model";
import { positionStatus } from "../src/view/format";
import { doc } from "./helpers";

// The status bar's position readout, by priority: a shape being drawn, a
// shape being dragged, the selection (select tool), the pointer.

const r = resolve(doc(
  addRect("a", { x: 10, y: 20, width: 50, height: 30 }),     // 10..60 × 20..50
  addCircle("c", { cx: 100, cy: 30, diameter: 20 }),          // 90..110 × 20..40
));
const idle = { tool: "select" as const, selection: [] as string[], cursor: null, draw: null, measure: null };

describe("positionStatus", () => {
  it("shows a selected shape's position and size as soon as it is selected", () => {
    expect(positionStatus({ ...idle, selection: ["a"] }, r)).toBe("from 10, 20 mm · 50 × 30 mm");
    expect(positionStatus({ ...idle, selection: ["c"] }, r)).toBe("centre 100, 30 mm · ⌀ 20 mm");
  });

  it("shows the bounds of several selected shapes", () => {
    expect(positionStatus({ ...idle, selection: ["a", "c"] }, r)).toBe("from 10, 20 mm · 100 × 30 mm");
  });

  it("shows the shape being dragged, then the one being drawn, ahead of the selection", () => {
    expect(positionStatus({ ...idle, selection: ["a", "c"], measure: "c", cursor: [1, 2] }, r)).toBe("centre 100, 30 mm · ⌀ 20 mm");
    expect(positionStatus({ ...idle, tool: "rect", selection: ["a"], cursor: [70, 40], draw: { tool: "rect", start: [60, 30] } }, r))
      .toBe("from 60, 30 mm · 10 × 10 mm");
  });

  it("shows the pointer in a drawing tool, even with a shape still selected", () => {
    expect(positionStatus({ ...idle, tool: "line", selection: ["a"], cursor: [12.5, -3] }, r)).toBe("12.5, -3 mm");
  });

  it("shows nothing with nothing selected and no pointer position; ignores shapes that have gone", () => {
    expect(positionStatus(idle, r)).toBe("");
    expect(positionStatus({ ...idle, selection: ["gone"] }, r)).toBe("");
    expect(positionStatus({ ...idle, selection: ["gone"], cursor: [5, 5] }, r)).toBe("5, 5 mm");
  });
});
