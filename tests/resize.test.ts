import { describe, it, expect } from "vitest";
import { applyChange } from "@sandtreader/collab/protocol";
import { addCircle, addLine, addRect, addVariable, handlesFor, resizeTo, resolve } from "../src/model";
import type { ResolvedCircle, ResolvedLine, ResolvedRect } from "../src/model";
import { doc } from "./helpers";

describe("handles", () => {
  it("puts rect handles on the corners with the opposite corner as anchor", () => {
    const r = resolve(doc(addRect("r", { x: 10, y: 20, width: 100, height: 50 }))).shapes.r!;
    const hs = handlesFor(r);
    expect(hs.map((h) => h.point)).toEqual([[10, 20], [110, 20], [110, 70], [10, 70]]);
    expect(hs[0]!.anchor).toEqual([110, 70]);
    expect(hs[3]!.anchor).toEqual([110, 20]);
  });

  it("gives circles a centre and a radius handle, lines their endpoints", () => {
    const res = resolve(doc(addCircle("c", { cx: 50, cy: 50, diameter: 20 }), addLine("l", { x: 0, y: 0, length: 10, angle: 90 })));
    expect(handlesFor(res.shapes.c!).map((h) => h.point)).toEqual([[50, 50], [60, 50]]);
    expect(handlesFor(res.shapes.l!).map((h) => h.point)).toEqual([[0, 0], [0, 10]]);
  });
});

describe("resizeTo", () => {
  it("drags a rect corner keeping the opposite corner fixed, even across it", () => {
    const state = doc(addRect("r", { x: 10, y: 20, width: 100, height: 50 }));
    const [h] = handlesFor(resolve(state).shapes.r!);       // top-left, anchor bottom-right (110,70)
    let r = resolve(applyChange(state, resizeTo(state, "r", h!.handle, [0, 0], h!.anchor)!)).shapes.r as ResolvedRect;
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 0, 110, 70]);
    // Past the anchor: the rect flips rather than going negative.
    r = resolve(applyChange(state, resizeTo(state, "r", h!.handle, [150, 100], h!.anchor)!)).shapes.r as ResolvedRect;
    expect([r.x, r.y, r.width, r.height]).toEqual([110, 70, 40, 30]);
    expect(resizeTo(state, "r", h!.handle, [110, 0], h!.anchor)).toBeUndefined();   // zero width
  });

  it("routes a linked width through the variable", () => {
    const state = doc(addVariable("w", 100), addRect("r", { x: 10, y: 20, width: { ref: "w" }, height: 50 }));
    const h = handlesFor(resolve(state).shapes.r!)[2]!;     // bottom-right, anchor top-left
    const c = resizeTo(state, "r", h.handle, [210, 70], h.anchor)!;
    expect(c).toEqual({ type: "batch", changes: [
      { type: "props_changed", id: "r", props: { x: 10, y: 20 } },
      { type: "props_changed", id: "w", props: { value: 200 } },
      { type: "props_changed", id: "r", props: { height: 50 } },
    ] });
  });

  it("sets a circle's diameter from the radius handle and moves it from the centre", () => {
    const state = doc(addCircle("c", { cx: 50, cy: 50, diameter: 20 }));
    const [centre, radius] = handlesFor(resolve(state).shapes.c!);
    expect(resizeTo(state, "c", radius!.handle, [50, 80], radius!.anchor)).toEqual({ type: "props_changed", id: "c", props: { diameter: 60 } });
    expect(resizeTo(state, "c", centre!.handle, [1, 2], undefined)).toEqual({ type: "props_changed", id: "c", props: { cx: 1, cy: 2 } });
    expect(resizeTo(state, "c", radius!.handle, [50, 50], radius!.anchor)).toBeUndefined();
  });

  it("drags either end of a line, keeping the other fixed", () => {
    const state = doc(addLine("l", { x: 0, y: 0, length: 10, angle: 0 }));
    const [start, end] = handlesFor(resolve(state).shapes.l!);
    let l = resolve(applyChange(state, resizeTo(state, "l", end!.handle, [0, 20], end!.anchor)!)).shapes.l as ResolvedLine;
    expect(l.from).toEqual([0, 0]);
    expect(l.to).toEqual([0, 20]);
    expect(l.angle).toBe(90);
    l = resolve(applyChange(state, resizeTo(state, "l", start!.handle, [10, 10], start!.anchor)!)).shapes.l as ResolvedLine;
    expect(l.from).toEqual([10, 10]);
    expect(l.to).toEqual([10, 0]);
    expect(l.length).toBe(10);
    expect(l.angle).toBe(-90);
  });
});
