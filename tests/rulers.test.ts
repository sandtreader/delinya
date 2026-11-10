import { describe, it, expect } from "vitest";
import { rulerTicks } from "../src/view/rulers";

// Rulers along the top and left of the canvas: ticks on the drawn grid
// pitch, a longer one every 5, a labelled one every 10, in model mm.

describe("rulerTicks", () => {
  // 2 px/mm with 1 mm spacing draws a 5 mm grid (10 px).
  const view = { scale: 2, ox: 60, oy: 40 };

  it("ticks every drawn grid line across the ruler, by screen position", () => {
    const ticks = rulerTicks(view, "x", 200, 1);
    expect(ticks.map((t) => t.at)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200]);
  });

  it("makes every 10th tick major and labels it in mm; every 5th is a mid tick", () => {
    const ticks = rulerTicks(view, "x", 200, 1);
    expect(ticks.filter((t) => t.size === "major")).toEqual([
      { at: 60, size: "major", label: "0" },
      { at: 160, size: "major", label: "50" },
    ]);
    expect(ticks.filter((t) => t.size === "mid").map((t) => t.at)).toEqual([10, 110]);
    expect(ticks.filter((t) => t.label === undefined).every((t) => t.size !== "major")).toBe(true);
  });

  it("runs down the left ruler from the view's y origin, negative above it", () => {
    const ticks = rulerTicks(view, "y", 150, 1);
    expect(ticks[0]).toEqual({ at: 0, size: "minor" });
    expect(ticks.filter((t) => t.label).map((t) => [t.at, t.label])).toEqual([[40, "0"], [140, "50"]]);
    expect(rulerTicks({ scale: 2, ox: 0, oy: 140 }, "y", 150, 1).find((t) => t.at === 40)).toEqual({ at: 40, size: "major", label: "-50" });
  });

  it("follows the drawing's grid spacing and coarsens with zoom like the grid", () => {
    // 5 mm spacing at 0.5 px/mm draws 25 mm (12.5 px): labels every 250 mm.
    const ticks = rulerTicks({ scale: 0.5, ox: 0, oy: 0 }, "x", 300, 5);
    expect(ticks[1]!.at).toBeCloseTo(12.5);
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toEqual(["0", "250", "500"]);
  });

  it("labels more often when zoomed in past the spacing, so numbers stay in view", () => {
    // 100 px/mm: 1 mm lines 100 px apart, every one labelled.
    expect(rulerTicks({ scale: 100, ox: 0, oy: 0 }, "x", 300, 1).filter((t) => t.label).map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
    // 20 px/mm: 1 mm lines 20 px apart, every fifth labelled.
    expect(rulerTicks({ scale: 20, ox: 0, oy: 0 }, "x", 400, 1).filter((t) => t.label).map((t) => [t.at, t.label]))
      .toEqual([[0, "0"], [100, "5"], [200, "10"], [300, "15"], [400, "20"]]);
  });
});
