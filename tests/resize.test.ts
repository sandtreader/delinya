import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  addCircle, addLine, addRect, addVariable, dragHandle, handlesFor, linkAlign, linkLocks, linkSpacing, resizeTo, resolve,
} from "../src/model";
import type { Point, Resolved, ResolvedCircle, ResolvedLine, ResolvedRect } from "../src/model";
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

describe("handles on linked shapes", () => {
  // A panel at 100..500 x 50..250 and things linked to it.
  const panel = addRect("panel", { x: 100, y: 50, width: 400, height: 200 });
  const r = addRect("r", { x: 10, y: 400, width: 60, height: 30 });
  const c = addCircle("c", { cx: 700, cy: 600, diameter: 20 });
  const l = addLine("l", { x: 0, y: 800, length: 50, angle: 0 });

  function setup(...links: Change[]) {
    const state = doc(panel, r, c, l, ...links);
    return { state, res: resolve(state) };
  }
  /** Drag handle `index` of `id` to `p` with the locks its links impose; the resolved result. */
  function drag(state: DocState, id: string, index: number, p: Point) {
    const res = resolve(state);
    const locks = linkLocks(res, id);
    const spot = handlesFor(res.shapes[id]!, locks)[index]!;
    const change = dragHandle(state, id, spot, p, locks);
    return change && resolve(applyChange(state, change));
  }
  const bounds = (res: Resolved | undefined, id: string) => {
    const b = res!.shapes[id]!.bounds;
    return [b.minX, b.minY, b.maxX, b.maxY];
  };

  it("linkLocks gives the point each link holds, per axis", () => {
    const { res } = setup(linkAlign("a", "panel", ["r"], "x", "end"), linkAlign("b", "panel", ["c"], "y", "centre"));
    expect(linkLocks(res, "r")).toEqual({ x: { mode: "end", at: 500 } });
    expect(linkLocks(res, "c")).toEqual({ y: { mode: "centre", at: 150 } });
    expect(linkLocks(res, "panel")).toEqual({});
    const sp = resolve(doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }), addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 500, y: 0, width: 20, height: 10 }), linkSpacing("s", "p", "q", ["x"], "x", "gaps"),
    ));
    expect(linkLocks(sp, "x")).toEqual({ x: { mode: "centre", at: 60 } });
  });

  it("with the left edge held, right handles resize from it and left handles only resize vertically", () => {
    const { state } = setup(linkAlign("a", "panel", ["r"], "x", "start"));     // r: 100..160 x 400..430
    expect(bounds(drag(state, "r", 1, [220, 380]), "r")).toEqual([100, 380, 220, 430]);
    expect(bounds(drag(state, "r", 0, [50, 390]), "r")).toEqual([100, 390, 160, 430]);
    expect(state.entities.r!.props.x).toBe(10);
  });

  it("with the right edge held, left handles resize from it and right handles only resize vertically", () => {
    const { state } = setup(linkAlign("a", "panel", ["r"], "x", "end"));       // r: 440..500
    expect(bounds(drag(state, "r", 0, [380, 400]), "r")).toEqual([380, 400, 500, 430]);
    expect(bounds(drag(state, "r", 1, [600, 380]), "r")).toEqual([440, 380, 500, 430]);
  });

  it("with the centre held, any handle resizes symmetrically", () => {
    const { state } = setup(linkAlign("a", "panel", ["r"], "x", "centre"));    // r: 270..330
    expect(bounds(drag(state, "r", 1, [360, 400]), "r")).toEqual([240, 400, 360, 430]);
    expect(bounds(drag(state, "r", 0, [250, 400]), "r")).toEqual([250, 400, 350, 430]);
  });

  it("a corner held on both axes can't be dragged; the opposite one can", () => {
    const { state } = setup(linkAlign("a", "panel", ["r"], "x", "start"), linkAlign("b", "panel", ["r"], "y", "start"));
    expect(drag(state, "r", 0, [0, 0])).toBeUndefined();
    expect(bounds(drag(state, "r", 2, [200, 150]), "r")).toEqual([100, 50, 200, 150]);
  });

  it("says with the cursor which way each handle can go", () => {
    const { res } = setup(linkAlign("a", "panel", ["r"], "x", "start"), linkAlign("b", "panel", ["r"], "y", "start"));
    const cursors = handlesFor(res.shapes.r!, linkLocks(res, "r")).map((h) => h.cursor);
    expect(cursors).toEqual(["not-allowed", "ew-resize", "nwse-resize", "ns-resize"]);
    const x = setup(linkAlign("a", "panel", ["r"], "x", "start"));
    expect(handlesFor(x.res.shapes.r!, linkLocks(x.res, "r")).map((h) => h.cursor)).toEqual(["ns-resize", "nesw-resize", "nwse-resize", "ns-resize"]);
  });

  it("moves a circle's centre handle only the free way", () => {
    const { state } = setup(linkAlign("a", "panel", ["c"], "x", "start"));     // c: 100..120
    const res = drag(state, "c", 0, [300, 650]);
    expect((res!.shapes.c as ResolvedCircle).centre).toEqual([110, 650]);
    const both = setup(linkAlign("a", "panel", ["c"], "x", "start"), linkAlign("b", "panel", ["c"], "y", "start"));
    expect(drag(both.state, "c", 0, [300, 650])).toBeUndefined();
    expect(handlesFor(both.res.shapes.c!, linkLocks(both.res, "c"))[0]!.cursor).toBe("not-allowed");
  });

  it("keeps a circle's radius handle under the pointer, on the side that can move", () => {
    let { state, res } = setup(linkAlign("a", "panel", ["c"], "x", "start"));   // c: 100..120
    expect(handlesFor(res.shapes.c!, linkLocks(res, "c"))[1]!.point).toEqual([120, 600]);
    expect(bounds(drag(state, "c", 1, [160, 610]), "c")).toEqual([100, 570, 160, 630]);

    ({ state, res } = setup(linkAlign("a", "panel", ["c"], "x", "end")));       // c: 480..500
    expect(handlesFor(res.shapes.c!, linkLocks(res, "c"))[1]!.point).toEqual([480, 600]);
    expect(bounds(drag(state, "c", 1, [440, 600]), "c")).toEqual([440, 570, 500, 630]);

    ({ state } = setup(linkAlign("a", "panel", ["c"], "x", "centre")));         // c: 290..310
    expect(bounds(drag(state, "c", 1, [330, 600]), "c")).toEqual([270, 570, 330, 630]);
  });

  it("lets a line's ends move only the free way", () => {
    const { state, res } = setup(linkAlign("a", "panel", ["l"], "y", "start")); // l: (0,50)-(50,50)
    const after = drag(state, "l", 1, [80, 70])!;
    expect((after.shapes.l as ResolvedLine).from).toEqual([0, 50]);
    expect((after.shapes.l as ResolvedLine).to).toEqual([80, 50]);
    expect(handlesFor(res.shapes.l!, linkLocks(res, "l")).map((h) => h.cursor)).toEqual(["ew-resize", "ew-resize"]);
  });

  it("behaves exactly as before with no links", () => {
    const { state, res } = setup();
    const spot = handlesFor(res.shapes.r!)[0]!;
    expect(dragHandle(state, "r", spot, [0, 0], {})).toEqual(resizeTo(state, "r", spot.handle, [0, 0], spot.anchor));
  });
});
