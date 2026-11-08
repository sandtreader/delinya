import { describe, it, expect } from "vitest";
import { applyChange } from "@sandtreader/collab/protocol";
import {
  addCircle, addDimension, addRadiusLabel, addRect, addRectWithDimensions, addSpacing, addVariable,
  deleteEntity, linkLengths, moveBy, resolve, setCornerRadius, setLength, unlinkLength, unlinkSpacing,
} from "../src/model";
import type { ResolvedRect } from "../src/model";
import { doc } from "./helpers";

describe("adding", () => {
  it("adds a rect with its two dimensions as one batch", () => {
    const c = addRectWithDimensions({ rect: "r", width: "dw", height: "dh" }, { x: 0, y: 0, width: 10, height: 5 });
    expect(c.type).toBe("batch");
    const state = doc(c);
    expect(Object.keys(state.entities)).toEqual(["r", "dw", "dh"]);
    expect(state.entities.dh!.props).toEqual({ target: "r", prop: "height", offset: 10 });
  });
});

describe("moving", () => {
  it("moves rects by x,y and circles by centre, carrying gesture flags", () => {
    const state = doc(addRect("r", { x: 1, y: 2, width: 3, height: 4 }), addCircle("c", { cx: 10, cy: 10, diameter: 2 }));
    expect(moveBy(state, "r", 5, 5, { start: true })).toEqual({ type: "props_changed", id: "r", props: { x: 6, y: 7 }, gestureStart: true });
    expect(moveBy(state, "c", -1, 0, { end: true })).toEqual({ type: "props_changed", id: "c", props: { cx: 9, cy: 10 }, gestureEnd: true });
    expect(moveBy(state, "nope", 1, 1)).toBeUndefined();
  });
});

describe("lengths and equal-value links", () => {
  const base = doc(
    addRect("a", { x: 0, y: 0, width: 100, height: 18 }),
    addRect("b", { x: 0, y: 50, width: 120, height: 18 }),
  );

  it("sets an unlinked length directly on the shape", () => {
    expect(setLength(base, "a", "width", 150)).toEqual({ type: "props_changed", id: "a", props: { width: 150 } });
  });

  it("links widths to a new variable seeded from the first member", () => {
    const c = linkLengths(base, [{ id: "a", prop: "width" }, { id: "b", prop: "width" }], "w", "width")!;
    const state = applyChange(base, c);
    expect(state.entities.w).toEqual({ kind: "variable", props: { value: 100, name: "width" } });
    expect(state.entities.a!.props.width).toEqual({ ref: "w" });
    expect(state.entities.b!.props.width).toEqual({ ref: "w" });
    const res = resolve(state);
    expect((res.shapes.b as ResolvedRect).width).toBe(100);

    // Typing a width on a linked shape edits the variable.
    const edit = setLength(state, "b", "width", 250)!;
    expect(edit).toEqual({ type: "props_changed", id: "w", props: { value: 250 } });
    const after = resolve(applyChange(state, edit));
    expect((after.shapes.a as ResolvedRect).width).toBe(250);
    expect((after.shapes.b as ResolvedRect).width).toBe(250);
  });

  it("reuses an existing variable and skips unknown members", () => {
    const withVar = applyChange(base, addVariable("w", 77));
    const c = linkLengths(withVar, [{ id: "a", prop: "width" }, { id: "zz", prop: "width" }], "w")!;
    expect(c).toEqual({ type: "batch", changes: [{ type: "props_changed", id: "a", props: { width: { ref: "w" } } }] });
  });

  it("unlinks by writing the current value back", () => {
    const linked = applyChange(base, linkLengths(base, [{ id: "a", prop: "width" }], "w")!);
    expect(unlinkLength(linked, "a", "width")).toEqual({ type: "props_changed", id: "a", props: { width: 100 } });
    expect(unlinkLength(base, "a", "width")).toBeUndefined();
  });

  it("sets one corner radius, going through the variable when linked", () => {
    const state = doc(addVariable("rv", 4), addRect("r", { x: 0, y: 0, width: 50, height: 50, r: [0, { ref: "rv" }, 0, 0] }));
    expect(setCornerRadius(state, "r", 0, 6)).toEqual({ type: "props_changed", id: "r", props: { r: [6, { ref: "rv" }, 0, 0] } });
    expect(setCornerRadius(state, "r", 1, 9)).toEqual({ type: "props_changed", id: "rv", props: { value: 9 } });
  });
});

describe("spacing links", () => {
  it("unlinking writes derived positions back so nothing moves", () => {
    const state = doc(
      addRect("L", { x: 0, y: 0, width: 18, height: 300 }),
      addRect("R", { x: 518, y: 0, width: 18, height: 300 }),
      addRect("s1", { x: 999, y: 100, width: 100, height: 18 }),
      addCircle("h", { cx: -5, cy: 20, diameter: 10 }),
      addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["s1", "h"], axis: "x", mode: "gaps" }),
    );
    const before = resolve(state);
    const after = resolve(applyChange(state, unlinkSpacing(state, "sp")!));
    expect(after.spacings).toEqual([]);
    expect(after.shapes.s1!.bounds).toEqual(before.shapes.s1!.bounds);
    expect(after.shapes.h!.bounds).toEqual(before.shapes.h!.bounds);
    expect((after.shapes.s1 as ResolvedRect).x).toBe(before.spacings[0]!.positions.s1);
  });
});

describe("deleting", () => {
  it("cascades to dimensions, labels and spacing membership", () => {
    const state = doc(
      addRect("L", { x: 0, y: 0, width: 18, height: 300 }),
      addRect("R", { x: 518, y: 0, width: 18, height: 300 }),
      addRect("s1", { x: 0, y: 100, width: 100, height: 18, r: [5, 0, 0, 0] }),
      addRect("s2", { x: 0, y: 200, width: 100, height: 18 }),
      addDimension("d", "s1", "width"),
      addDimension("dOther", "s2", "width"),
      addRadiusLabel("lab", "s1", 0),
      addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["s1", "s2"], axis: "x", mode: "gaps" }),
    );
    const after = applyChange(state, deleteEntity(state, "s1")!);
    expect(Object.keys(after.entities).sort()).toEqual(["L", "R", "dOther", "s2", "sp"]);
    expect(after.entities.sp!.props.items).toEqual(["s2"]);
    expect(resolve(after).issues).toEqual([]);
  });

  it("removes a spacing link that loses an anchor", () => {
    const state = doc(
      addRect("L", { x: 0, y: 0, width: 18, height: 300 }),
      addRect("R", { x: 518, y: 0, width: 18, height: 300 }),
      addRect("s", { x: 0, y: 100, width: 100, height: 18 }),
      addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["s"], axis: "x", mode: "gaps" }),
    );
    const after = applyChange(state, deleteEntity(state, "L")!);
    expect(Object.keys(after.entities).sort()).toEqual(["R", "s"]);
  });

  it("is a plain entity_removed when nothing depends on the entity", () => {
    const state = doc(addCircle("c", { cx: 0, cy: 0, diameter: 1 }));
    expect(deleteEntity(state, "c")).toEqual({ type: "entity_removed", id: "c" });
    expect(deleteEntity(state, "x")).toBeUndefined();
  });
});
