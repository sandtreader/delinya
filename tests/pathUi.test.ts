import { describe, it, expect } from "vitest";
import { addPolyline, addRect, resolve, type PolyNode } from "../src/model";
import { draftAdd, draftShape } from "../src/canvas/polyDraft";
import { nodeHandles, segmentAt } from "../src/canvas/polyEdit";
import { editorReducer, initialEditor, selectedPathNode } from "../src/app/editor";
import { placeNear } from "../src/view/placeNear";
import { positionStatus } from "../src/view/format";
import { doc } from "./helpers";

const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const curve = (x: number, y: number): PolyNode => ({ x, y, type: "curve" });

describe("drawing a path, more", () => {
  it("ignores a click within the given distance of the last node", () => {
    const d = draftAdd(null, [0, 0], false);
    expect(draftAdd(d, [0.3, 0], false, 0.5)).toBe(d);
    expect(draftAdd(d, [0.6, 0], false, 0.5).nodes).toHaveLength(2);
  });

  it("resolves the draft for the preview, auto curves smoothed; nothing below two nodes", () => {
    expect(draftShape([cusp(0, 0)])).toBeUndefined();
    const s = draftShape([cusp(0, 0), curve(10, 10), cusp(20, 0)])!;
    expect(s.path.map((e) => e.kind)).toEqual(["cubic", "cubic"]);
    expect(draftShape([cusp(0, 0), cusp(10, 0), cusp(10, 10)], true)!.path).toHaveLength(3);
  });
});

describe("a path's handles and segments", () => {
  it("shows an open path's end curve node only the handle its segment uses", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [curve(0, 0), curve(10, 10), curve(20, 0)] }))).shapes.p!;
    if (p.kind !== "polyline") throw new Error("not a path");
    expect(nodeHandles(p, 0).map((h) => h.which)).toEqual(["out"]);
    expect(nodeHandles(p, 1).map((h) => h.which)).toEqual(["in", "out"]);
    expect(nodeHandles(p, 2).map((h) => h.which)).toEqual(["in"]);
    const closed = resolve(doc(addPolyline("c", { nodes: [curve(0, 0), curve(10, 10), curve(20, 0)], closed: true }))).shapes.c!;
    if (closed.kind !== "polyline") throw new Error("not a path");
    expect(nodeHandles(closed, 0).map((h) => h.which)).toEqual(["in", "out"]);
  });

  it("finds a point on a curved segment, and the closing segment of a closed path", () => {
    const nodes = [cusp(0, 0), { x: 10, y: 0, type: "curve", in: [-3, 0], out: [3, 0] } as PolyNode, cusp(20, 0)];
    const p = resolve(doc(addPolyline("p", { nodes }))).shapes.p!;
    if (p.kind !== "polyline") throw new Error("not a path");
    const hit = segmentAt(p, [15, 0.2], 1)!;
    expect(hit.segment).toBe(1);
    expect(hit.t).toBeGreaterThan(0.3);
    expect(hit.t).toBeLessThan(0.7);
    const tri = resolve(doc(addPolyline("t", { nodes: [cusp(0, 0), cusp(10, 0), cusp(0, 10)], closed: true }))).shapes.t!;
    if (tri.kind !== "polyline") throw new Error("not a path");
    expect(segmentAt(tri, [0, 5], 0.5)).toEqual({ segment: 2, t: 0.5 });
  });
});

describe("the selected node, more", () => {
  const r = resolve(doc(
    addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(12.5, 7)] }),
    addRect("r", { x: 0, y: 0, width: 5, height: 5 }),
  ));
  const e = { ...initialEditor, selection: ["p"], node: { shape: "p", index: 1 } };

  it("survives selecting its path again, but not leaving the select tool", () => {
    expect(editorReducer(e, { type: "select", ids: ["p"] }).node).toEqual({ shape: "p", index: 1 });
    expect(editorReducer(e, { type: "select", ids: ["p", "r"] }).node).toBeNull();
    expect(editorReducer(e, { type: "toggleSelect", id: "r" }).node).toBeNull();
    expect(editorReducer(e, { type: "tool", tool: "polyline" }).node).toBeNull();
    expect(editorReducer(e, { type: "tool", tool: "select" }).node).toEqual({ shape: "p", index: 1 });
  });

  it("is editable only with select, its path the selection and the node still there", () => {
    expect(selectedPathNode(r, e)).toMatchObject({ position: 1, node: { index: 1, point: [10, 0] } });
    expect(selectedPathNode(r, { ...e, tool: "line" })).toBeNull();
    expect(selectedPathNode(r, { ...e, selection: ["p", "r"] })).toBeNull();
    expect(selectedPathNode(r, { ...e, node: { shape: "p", index: 5 } })).toBeNull();
    expect(selectedPathNode(r, { ...e, selection: ["r"], node: { shape: "r", index: 0 } })).toBeNull();
  });
});

describe("the status bar while drawing a path", () => {
  it("shows the segment from the last node to the pointer, as for a line", () => {
    const r = resolve(doc());
    const e = { tool: "polyline" as const, selection: [], cursor: [13, 4] as [number, number], draw: { tool: "polyline" as const, start: [10, 0] as [number, number] }, measure: null };
    expect(positionStatus(e, r)).toBe("from 10, 0 mm · 5 mm at 53.13°");
  });
});

describe("placing a card near a point", () => {
  it("goes below right of the point, flips when it would leave the area, and stays inside", () => {
    expect(placeNear([100, 100], [200, 40], [800, 600])).toEqual({ left: 116, top: 116 });
    expect(placeNear([700, 100], [200, 40], [800, 600])).toEqual({ left: 484, top: 116 });
    expect(placeNear([100, 590], [200, 40], [800, 600])).toEqual({ left: 116, top: 534 });
    // Too big either way: kept inside, from the top left.
    expect(placeNear([10, 10], [900, 40], [800, 600])).toEqual({ left: 4, top: 26 });
  });
});
