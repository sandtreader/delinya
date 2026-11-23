import { describe, it, expect } from "vitest";
import { applyChange, type DocState } from "@sandtreader/collab/protocol";
import {
  addCircle, addDimension, addLine, addRadiusLabel, addRect, dimensionOffsetAt, dimensionTargetAt, resolve,
  setDimensionOffset, toggleDimension, toggleRadiusLabel,
} from "../src/model";
import { DEFAULT_LABEL_VIEW, loadLabelView, saveLabelView } from "../src/app/labelView";
import { editorReducer, initialEditor } from "../src/app/editor";
import { doc } from "./helpers";

// Dimensions and radius labels, by hand. A dimension's offset is signed:
// positive stands off the shape's near side (a rect's top or left edge, a
// circle's top, a line's left as it runs), negative off the far side (the
// bottom or right edge, below the circle, the line's right), so a dimension
// moved across its shape attaches to the other edge rather than drawing
// extension lines through it. The Dimension tool picks what to measure from
// what is under the pointer; a rounded rect corner gives its radius label.

const dims = (st: DocState) => resolve(st).dimensions;

describe("the far side", () => {
  it("puts a rect's width below it and its height to its right", () => {
    const [w, h] = dims(doc(
      addRect("r", { x: 0, y: 0, width: 100, height: 50 }),
      addDimension("w", "r", "width", -10),
      addDimension("h", "r", "height", -10),
    ));
    expect(w!.anchors).toEqual([[0, 50], [100, 50]]);
    expect(w!.line).toEqual({ kind: "segment", from: [0, 60], to: [100, 60] });
    expect(h!.anchors).toEqual([[100, 0], [100, 50]]);
    expect(h!.line).toEqual({ kind: "segment", from: [110, 0], to: [110, 50] });
    expect(w!.value).toBe(100);
  });

  it("turns with the rect", () => {
    // 90°: tl (10,20), tr (10,120), br (-40,120), bl (-40,20); the bottom edge is bl–br.
    const [w] = dims(doc(addRect("r", { x: 10, y: 20, width: 100, height: 50, rotation: 90 }), addDimension("w", "r", "width", -10)));
    expect(w!.anchors).toEqual([[-40, 20], [-40, 120]]);
    expect(w!.line).toEqual({ kind: "segment", from: [-50, 20], to: [-50, 120] });
  });

  it("puts a circle's diameter below it", () => {
    const [d] = dims(doc(addCircle("c", { cx: 50, cy: 50, diameter: 20 }), addDimension("d", "c", "diameter", -5)));
    expect(d!.anchors).toEqual([[40, 60], [60, 60]]);
    expect(d!.line).toEqual({ kind: "segment", from: [40, 65], to: [60, 65] });
  });
});

describe("dimensionOffsetAt: where the pointer puts a dimension", () => {
  const r = resolve(doc(
    addRect("r", { x: 0, y: 0, width: 100, height: 50 }),
    addRect("t", { x: 0, y: 0, width: 100, height: 50, rotation: 90 }),
    addCircle("c", { cx: 50, cy: 50, diameter: 20 }),
    addLine("l", { x: 0, y: 0, length: 100, angle: 0 }),
  ));

  it("measures from the near or far edge, by which half the pointer is in", () => {
    expect(dimensionOffsetAt(r, "r", "width", [30, -12])).toBe(12);
    expect(dimensionOffsetAt(r, "r", "width", [30, 62])).toBe(-12);
    expect(dimensionOffsetAt(r, "r", "height", [-7, 20])).toBe(7);
    expect(dimensionOffsetAt(r, "r", "height", [108, 20])).toBe(-8);
  });

  it("sits on the edge when the pointer is inside the shape", () => {
    expect(dimensionOffsetAt(r, "r", "width", [30, 10])).toBe(0);
    // The far side, on the edge: the smallest offset that still says "far".
    const far = dimensionOffsetAt(r, "r", "width", [30, 40])!;
    expect(far).toBeLessThan(0);
    expect(far).toBeGreaterThan(-0.1);
  });

  it("works in a turned rect's own frame", () => {
    // Turned 90° about (0,0): its top edge runs down the page along x = 0, its outside to the right.
    expect(dimensionOffsetAt(r, "t", "width", [9, 30])).toBe(9);
  });

  it("measures a circle from its top or bottom, and a line by its signed distance", () => {
    expect(dimensionOffsetAt(r, "c", "diameter", [50, 35])).toBe(5);
    expect(dimensionOffsetAt(r, "c", "diameter", [50, 66])).toBe(-6);
    // A line along +x: its left (as it runs) is up the page, the normal (0, -1).
    expect(dimensionOffsetAt(r, "l", "length", [40, -15])).toBe(15);
    expect(dimensionOffsetAt(r, "l", "length", [40, 15])).toBe(-15);
  });

  it("rounds to the step given (the grid, or 0.01 mm)", () => {
    expect(dimensionOffsetAt(r, "r", "width", [30, -12.3], 5)).toBe(10);
    expect(dimensionOffsetAt(r, "r", "width", [30, -12.346])).toBe(12.35);
  });

  it("is undefined for what can't be measured that way", () => {
    expect(dimensionOffsetAt(r, "c", "width", [0, 0])).toBeUndefined();
    expect(dimensionOffsetAt(r, "missing", "width", [0, 0])).toBeUndefined();
  });
});

describe("dimensionTargetAt: what the Dimension tool would measure", () => {
  const r = resolve(doc(
    addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 0, 0, 0] }),
    addCircle("c", { cx: 200, cy: 25, diameter: 40 }),
    addLine("l", { x: 300, y: 0, length: 100, angle: 90 }),
  ));
  const tol = 2;

  it("measures a rect's width from its top or bottom edge and its height from its sides", () => {
    expect(dimensionTargetAt(r, [50, 1], tol)).toEqual({ kind: "dimension", target: "r", prop: "width" });
    expect(dimensionTargetAt(r, [50, 51], tol)).toEqual({ kind: "dimension", target: "r", prop: "width" });
    expect(dimensionTargetAt(r, [99, 30], tol)).toEqual({ kind: "dimension", target: "r", prop: "height" });
  });

  it("labels a rounded corner's radius", () => {
    // The top-left arc, centre (10,10) radius 10: its middle is at 225°.
    const mid: [number, number] = [10 - 10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2];
    expect(dimensionTargetAt(r, mid, tol)).toEqual({ kind: "radius", target: "r", corner: 0 });
  });

  it("measures a circle's diameter on its outline and a line's length along it", () => {
    expect(dimensionTargetAt(r, [220, 25], tol)).toEqual({ kind: "dimension", target: "c", prop: "diameter" });
    expect(dimensionTargetAt(r, [301, 60], tol)).toEqual({ kind: "dimension", target: "l", prop: "length" });
  });

  it("finds nothing inside a shape or in empty space", () => {
    expect(dimensionTargetAt(r, [50, 25], tol)).toBeNull();
    expect(dimensionTargetAt(r, [200, 25], tol)).toBeNull();
    expect(dimensionTargetAt(r, [500, 500], tol)).toBeNull();
  });

  it("leaves out hidden and locked layers", () => {
    expect(dimensionTargetAt(r, [50, 1], tol, { hidden: new Set(["layer"]) })).toBeNull();
    expect(dimensionTargetAt(r, [50, 1], tol, { locked: new Set(["layer"]) })).toBeNull();
  });
});

describe("adding, moving and removing", () => {
  const base = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [5, 0, 0, 0] }));

  it("toggles a shape's dimension of a prop", () => {
    const on = applyChange(base, toggleDimension(base, "r", "width", "d1")!);
    expect(on.entities.d1).toMatchObject({ kind: "dimension", props: { target: "r", prop: "width", offset: 10 } });
    const off = applyChange(on, toggleDimension(on, "r", "width", "d2")!);
    expect(off.entities.d1).toBeUndefined();
    expect(off.entities.d2).toBeUndefined();
    expect(toggleDimension(base, "r", "diameter", "d3")).toBeUndefined();
  });

  it("toggles a corner's radius label", () => {
    const on = applyChange(base, toggleRadiusLabel(base, "r", 0, "l1")!);
    expect(on.entities.l1).toMatchObject({ kind: "radius-label", props: { target: "r", corner: 0 } });
    const off = applyChange(on, toggleRadiusLabel(on, "r", 0, "l2")!);
    expect(off.entities.l1).toBeUndefined();
    expect(toggleRadiusLabel(doc(addCircle("c", { cx: 0, cy: 0, diameter: 10 })), "c", 0, "l3")).toBeUndefined();
  });

  it("moves a dimension by its offset, either side", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50 }), addDimension("d", "r", "width", 10));
    const moved = applyChange(st, setDimensionOffset(st, "d", -20)!);
    expect(moved.entities.d!.props.offset).toBe(-20);
    expect(resolve(moved).dimensions[0]!.line).toEqual({ kind: "segment", from: [0, 70], to: [100, 70] });
    expect(setDimensionOffset(moved, "d", -20)).toBeUndefined();
    expect(setDimensionOffset(moved, "r", 5)).toBeUndefined();
  });

  it("deletes a radius label on its own", () => {
    const st = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [5, 0, 0, 0] }), addRadiusLabel("lab", "r", 0));
    const off = applyChange(st, toggleRadiusLabel(st, "r", 0, "x")!);
    expect(resolve(off).radiusLabels).toEqual([]);
    expect(off.entities.r).toBeDefined();
  });
});

describe("the viewer's dimension settings", () => {
  it("dimension new shapes and show dimensions, both on by default, remembered per browser", () => {
    expect(DEFAULT_LABEL_VIEW).toEqual({ autoDimension: true, show: true });
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(loadLabelView(storage)).toEqual(DEFAULT_LABEL_VIEW);
    saveLabelView(storage, { autoDimension: false, show: true });
    expect(loadLabelView(storage)).toEqual({ autoDimension: false, show: true });
    store.set("delinya.labels", "junk");
    expect(loadLabelView(storage)).toEqual(DEFAULT_LABEL_VIEW);
    expect(loadLabelView(null)).toEqual(DEFAULT_LABEL_VIEW);
  });

  it("are editor state, set by their own action", () => {
    expect(initialEditor.labels).toEqual(DEFAULT_LABEL_VIEW);
    const off = editorReducer(initialEditor, { type: "labels", labels: { show: false } });
    expect(off.labels).toEqual({ autoDimension: true, show: false });
  });

  it("selects one dimension or label at a time, apart from the shape selection", () => {
    const sel = editorReducer({ ...initialEditor, selection: ["r"] }, { type: "selectLabel", id: "d" });
    expect([sel.label, sel.selection]).toEqual(["d", []]);
    expect(editorReducer(sel, { type: "select", ids: ["r"] }).label).toBeNull();
    expect(editorReducer(sel, { type: "tool", tool: "rect" }).label).toBeNull();
    expect(editorReducer(sel, { type: "labels", labels: { show: false } }).label).toBeNull();
  });

  it("has a Dimension tool", () => {
    expect(editorReducer(initialEditor, { type: "tool", tool: "dimension" }).tool).toBe("dimension");
  });
});
