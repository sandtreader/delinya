import { describe, it, expect } from "vitest";
import { addDimension, addRect, addText, resolve } from "../src/model";
import { editorReducer, initialEditor } from "../src/app/editor";
import { drawingExtent, FIT_PAD_PX } from "../src/view/fit";
import { DEFAULT_VIEW, MAX_SCALE, MIN_SCALE, fitView, toScreen } from "../src/view/viewport";
import { doc } from "./helpers";

// Fit view to drawing: the view that shows everything drawn, as large as
// the canvas allows with FIT_PAD_PX clear all round, centred. On opening a
// drawing, and from the status bar button or F.

/** Screen points, to float rounding. */
function near(p: readonly number[], q: readonly number[]) {
  expect(p[0]).toBeCloseTo(q[0]!, 9);
  expect(p[1]).toBeCloseTo(q[1]!, 9);
}

describe("fitView", () => {
  const size: [number, number] = [800, 600];

  it("scales the drawing to the canvas less the padding, and centres it", () => {
    expect(FIT_PAD_PX).toBe(40);
    // 720 × 520 px to fill: 100 × 50 mm goes 7.2 px/mm, 720 × 360 px.
    const v = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, size);
    expect(v.scale).toBeCloseTo(7.2, 9);
    near([v.ox, v.oy], [40, 120]);
  });

  it("puts the drawing's corners where they belong wherever it is", () => {
    const b = { minX: 50, minY: -20, maxX: 150, maxY: 30 };
    const v = fitView(b, size);
    near(toScreen(v, [b.minX, b.minY]), [40, 120]);
    near(toScreen(v, [b.maxX, b.maxY]), [760, 480]);
  });

  it("fits the tighter way for tall drawings", () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 10, maxY: 100 }, size);
    expect(v.scale).toBeCloseTo(5.2, 9);
    near(toScreen(v, [5, 50]), [400, 300]);
  });

  it("centres a drawing with no width or height at the default scale", () => {
    const v = fitView({ minX: 10, minY: 20, maxX: 10, maxY: 20 }, size);
    expect(v.scale).toBe(DEFAULT_VIEW.scale);
    near(toScreen(v, [10, 20]), [400, 300]);
    // A vertical line: fitted by its height alone.
    expect(fitView({ minX: 0, minY: 0, maxX: 0, maxY: 52 }, size).scale).toBeCloseTo(10, 9);
  });

  it("keeps to the zoom limits", () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 0.01, maxY: 0.01 }, size).scale).toBe(MAX_SCALE);
    expect(fitView({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, size).scale).toBe(MIN_SCALE);
  });

  it("gives the default view for nothing drawn or no canvas", () => {
    expect(fitView(null, size)).toEqual(DEFAULT_VIEW);
    expect(fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, [0, 0])).toEqual(DEFAULT_VIEW);
  });

  it("still fits a canvas smaller than its padding", () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, [60, 60]);
    expect(v.scale).toBeGreaterThan(0);
    near(toScreen(v, [50, 25]), [30, 30]);
  });
});

describe("drawingExtent", () => {
  it("covers the visible shapes and their dimensions", () => {
    const r = resolve(doc(
      addRect("a", { x: 0, y: 0, width: 100, height: 50 }),
      addDimension("d", "a", "width", 10),        // its line at y = -10
      addText("t", { x: 200, y: 20, width: 50, height: 12, text: "Hi" }),
    ));
    expect(drawingExtent(r, new Set())).toEqual({ minX: 0, minY: -10, maxX: 250, maxY: 50 });
  });

  it("leaves out hidden layers, and is null with nothing to show", () => {
    const st = doc(
      { type: "entity_added", id: "layer", kind: "layer", props: { order: 0 } },
      { type: "entity_added", id: "top", kind: "layer", props: { order: 1 } },
      addRect("a", { x: 0, y: 0, width: 10, height: 10, layer: "layer" }),
      addRect("b", { x: 100, y: 100, width: 10, height: 10, layer: "top" }),
    );
    const r = resolve(st);
    expect(drawingExtent(r, new Set(["top"]))).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(drawingExtent(r, new Set(["top", "layer"]))).toBeNull();
    expect(drawingExtent(resolve(doc()), new Set())).toBeNull();
  });
});

describe("asking for a fit", () => {
  it("counts requests, so the canvas (which knows its size) can answer each", () => {
    const once = editorReducer(initialEditor, { type: "fit" });
    expect(once.fitRequest).toBe(initialEditor.fitRequest + 1);
    expect(editorReducer(once, { type: "fit" }).fitRequest).toBe(initialEditor.fitRequest + 2);
  });
});
