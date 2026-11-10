import { describe, it, expect } from "vitest";
import { addPolyline, resolve, type PolyNode } from "../src/model";
import { draftAdd, draftCloses, draftFinish, draftPreview, draftUndo } from "../src/canvas/polyDraft";
import { handleAt, nodeAt, segmentAt } from "../src/canvas/polyEdit";
import { editorReducer, initialEditor } from "../src/app/editor";
import { positionStatus } from "../src/view/format";
import { doc } from "./helpers";

const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });

describe("drawing a path", () => {
  it("starts with a click and adds a straight node per click, a curve node per Shift-click", () => {
    let d = draftAdd(null, [0, 0], false);
    d = draftAdd(d, [10, 0], false);
    d = draftAdd(d, [10, 10], true);
    expect(d.nodes).toEqual([cusp(0, 0), cusp(10, 0), curve(10, 10)]);
  });

  it("ignores a click on the last node (the second click of a double-click)", () => {
    const d = draftAdd(draftAdd(null, [0, 0], false), [10, 0], false);
    expect(draftAdd(d, [10, 0], false)).toBe(d);
  });

  it("previews the next segment to the pointer as a provisional node", () => {
    const d = draftAdd(draftAdd(null, [0, 0], false), [10, 0], false);
    expect(draftPreview(d, [20, 5], false)).toEqual([cusp(0, 0), cusp(10, 0), cusp(20, 5)]);
    expect(draftPreview(d, [20, 5], true)).toEqual([cusp(0, 0), cusp(10, 0), curve(20, 5)]);
  });

  it("closes when the start is clicked again, once there are three nodes", () => {
    let d = draftAdd(draftAdd(null, [0, 0], false), [10, 0], false);
    expect(draftCloses(d, [0.5, 0.5], 2)).toBe(false);
    d = draftAdd(d, [10, 10], false);
    expect(draftCloses(d, [0.5, 0.5], 2)).toBe(true);
    expect(draftCloses(d, [3, 3], 2)).toBe(false);
    expect(draftFinish(d, true)).toEqual({ nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)], closed: true });
  });

  it("finishes open, and draws nothing with fewer than two nodes", () => {
    const one = draftAdd(null, [0, 0], false);
    expect(draftFinish(one, false)).toBeNull();
    expect(draftFinish(draftAdd(one, [5, 5], true), false)).toEqual({ nodes: [cusp(0, 0), curve(5, 5)], closed: false });
  });

  it("takes back the last node with Backspace, and the whole draft with the first", () => {
    const d = draftAdd(draftAdd(null, [0, 0], false), [10, 0], false);
    expect(draftUndo(d)!.nodes).toEqual([cusp(0, 0)]);
    expect(draftUndo(draftUndo(d)!)).toBeNull();
  });
});

describe("hit-testing a path's nodes, handles and segments", () => {
  const p = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-4, 0], out: [4, 0] }), cusp(20, 0)] }))).shapes.p!;

  it("finds the node under the pointer, nearest first", () => {
    expect(nodeAt(p, [10.5, 9.5], 2)).toBe(1);
    expect(nodeAt(p, [0, 1], 2)).toBe(0);
    expect(nodeAt(p, [5, 5], 2)).toBeNull();
  });

  it("finds a curve node's handle", () => {
    expect(handleAt(p, 1, [14, 10.5], 1)).toBe("out");
    expect(handleAt(p, 1, [6, 10], 1)).toBe("in");
    expect(handleAt(p, 1, [10, 10], 1)).toBeNull();
    expect(handleAt(p, 0, [0, 0], 1)).toBeNull();
  });

  it("finds the segment under the pointer and where along it, for inserting a node", () => {
    const straight = resolve(doc(addPolyline("s", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)] }))).shapes.s!;
    expect(segmentAt(straight, [5, 0.5], 1)).toEqual({ segment: 0, t: 0.5 });
    expect(segmentAt(straight, [10.4, 2.5], 1)!.segment).toBe(1);
    expect(segmentAt(straight, [10.4, 2.5], 1)!.t).toBeCloseTo(0.25);
    expect(segmentAt(straight, [5, 5], 1)).toBeNull();
  });
});

describe("the selected node", () => {
  it("is editor state, cleared when the selection changes", () => {
    const e = editorReducer({ ...initialEditor, selection: ["p"] }, { type: "node", node: { shape: "p", index: 2 } });
    expect(e.node).toEqual({ shape: "p", index: 2 });
    expect(editorReducer(e, { type: "select", ids: ["q"] }).node).toBeNull();
    expect(editorReducer(e, { type: "node", node: null }).node).toBeNull();
    expect(initialEditor.node).toBeNull();
  });

  it("shows in the status bar", () => {
    const r = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(12.5, 7)] })));
    const idle = { tool: "select" as const, selection: ["p"], cursor: null, draw: null, measure: null };
    expect(positionStatus({ ...idle, node: { shape: "p", index: 2 } }, r)).toBe("node 3 of 3 · 12.5, 7 mm");
  });
});
