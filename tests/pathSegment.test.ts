import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  addPolyline, bendPolySegment, cubicPoint, deletePolySegment, resolve, setPolySegmentCurved,
  type Cubic, type PathElement, type PolyNode,
} from "../src/model";
import { segmentHandles } from "../src/canvas/polyEdit";
import { editorReducer, initialEditor, selectedPathSegment } from "../src/app/editor";
import { positionStatus } from "../src/view/format";
import { doc } from "./helpers";

// A path's segments: selected on their own (select tool, the path
// selected), made straight or curved, bent by dragging, deleted.
// A segment is named by the stored index of its start node, as
// insertPolyNode takes; the closing segment of a closed path by its last.

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const cusp = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "cusp", ...extra });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];
const pathOf = (st: DocState, id = "p") => {
  const s = resolve(st).shapes[id]!;
  if (s.kind !== "polyline") throw new Error("not a path");
  return s;
};
const asCubic = (e: PathElement | undefined): Cubic => {
  expect(e?.kind).toBe("cubic");
  return e as Cubic;
};

describe("making a segment straight or curved", () => {
  const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(30, 0), cusp(30, 30)] }));

  it("curves a straight segment with handles a third of the way along, so it doesn't move yet", () => {
    const after = apply(st, setPolySegmentCurved(st, "p", 0, true));
    expect(nodesOf(after)).toEqual([cusp(0, 0, { out: [10, 0] }), cusp(30, 0, { in: [-10, 0] }), cusp(30, 30)]);
    expect(asCubic(pathOf(after).path[0])).toMatchObject({ from: [0, 0], c1: [10, 0], c2: [20, 0], to: [30, 0] });
    expect(pathOf(after).path[1]!.kind).toBe("segment");
    expect(setPolySegmentCurved(after, "p", 0, true)).toBeUndefined();
  });

  it("straightens a curved segment, taking the handles at its ends off", () => {
    const curved = doc(addPolyline("p", { nodes: [cusp(0, 0, { out: [5, 5] }), cusp(30, 0, { in: [-5, 5], out: [0, 4] }), cusp(30, 30)] }));
    const after = apply(curved, setPolySegmentCurved(curved, "p", 0, false));
    expect(nodesOf(after)).toEqual([cusp(0, 0), cusp(30, 0, { out: [0, 4] }), cusp(30, 30)]);
    expect(pathOf(after).path[0]).toEqual({ kind: "segment", from: [0, 0], to: [30, 0] });
    expect(setPolySegmentCurved(after, "p", 0, false)).toBeUndefined();
  });

  it("a smooth node at a straightened end becomes a corner, keeping its other side's curve", () => {
    const st2 = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    const otherBefore = asCubic(pathOf(st2).path[1]);
    const after = apply(st2, setPolySegmentCurved(st2, "p", 0, false));
    const n = nodesOf(after)[1]!;
    expect(n.type).toBe("cusp");
    expect(n.in).toBeUndefined();
    expect(pathOf(after).path[0]!.kind).toBe("segment");
    const other = asCubic(pathOf(after).path[1]);
    expect(other.c1[0]).toBeCloseTo(otherBefore.c1[0]);
    expect(other.c1[1]).toBeCloseTo(otherBefore.c1[1]);
  });

  it("works on a closed path's closing segment", () => {
    const tri = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(30, 0), cusp(30, 30)], closed: true }));
    const after = apply(tri, setPolySegmentCurved(tri, "p", 2, true));
    expect(nodesOf(after)).toEqual([cusp(0, 0, { in: [10, 10] }), cusp(30, 0), cusp(30, 30, { out: [-10, -10] })]);
  });
});

describe("bending a segment by dragging it", () => {
  it("moves the grabbed point by the drag, ends staying put", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0, { out: [10, 0] }), cusp(30, 0, { in: [-10, 0] }), cusp(30, 30)] }));
    for (const t of [0.5, 0.3, 0.8]) {
      const before = cubicPoint(asCubic(pathOf(st).path[0]), t);
      const after = asCubic(pathOf(apply(st, bendPolySegment(st, "p", 0, t, [0, 6]))).path[0]);
      const p = cubicPoint(after, t);
      expect(p[0]).toBeCloseTo(before[0], 1);
      expect(p[1]).toBeCloseTo(before[1] + 6, 1);
      expect(after.from).toEqual([0, 0]);
      expect(after.to).toEqual([30, 0]);
    }
  });

  it("curves a straight segment as it bends", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(30, 0), cusp(30, 30)] }));
    const after = asCubic(pathOf(apply(st, bendPolySegment(st, "p", 0, 0.5, [0, -6]))).path[0]);
    expect(cubicPoint(after, 0.5)[1]).toBeCloseTo(-6, 1);
    expect(pathOf(apply(st, bendPolySegment(st, "p", 0, 0.5, [0, -6]))).path[1]!.kind).toBe("segment");
  });

  it("keeps a smooth end smooth, its other handle turning to match", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(30, 0, { in: [-10, 0], out: [5, 0] }), cusp(60, 0)] }));
    const n = nodesOf(apply(st, bendPolySegment(st, "p", 0, 0.5, [0, 6])))[1]!;
    expect(n.type).toBe("curve");
    expect(n.in![0] * n.out![1] - n.in![1] * n.out![0]).toBeCloseTo(0);
    expect(Math.hypot(...n.out!)).toBeCloseTo(5);
  });

  it("does nothing for no drag", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(30, 0)] }));
    expect(bendPolySegment(st, "p", 0, 0.5, [0, 0])).toBeUndefined();
    expect(bendPolySegment(st, "p", 1, 0.5, [0, 5])).toBeUndefined();   // no segment after the last node of an open path
  });
});

describe("deleting a segment", () => {
  let n = 0;
  const makeId = (prefix: string) => `${prefix}-${++n}`;

  it("opens a closed path there, the path now running from the segment's end round to its start", () => {
    const sq = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(0, 10)], closed: true }));
    const out = deletePolySegment(sq, "p", 1, makeId)!;
    const after = applyChange(sq, out.change);
    expect(nodesOf(after)).toEqual([cusp(10, 10), cusp(0, 10), cusp(0, 0), cusp(10, 0)]);
    expect(after.entities.p!.props.closed).toBe(false);
    expect(out.ids).toEqual(["p"]);
  });

  it("splits an open path in two, the new part on the same layer", () => {
    const st = doc(
      { type: "entity_added", id: "L", kind: "layer", props: { name: "Cuts" } },
      addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(20, 0), cusp(30, 0)], layer: "L" }),
    );
    const out = deletePolySegment(st, "p", 1, makeId)!;
    const after = applyChange(st, out.change);
    expect(out.ids).toHaveLength(2);
    expect(out.ids[0]).toBe("p");
    const other = out.ids[1]!;
    expect(other).toMatch(/^polyline-/);
    expect(nodesOf(after)).toEqual([cusp(0, 0), cusp(10, 0)]);
    expect(nodesOf(after, other)).toEqual([cusp(20, 0), cusp(30, 0)]);
    expect(after.entities[other]!.props.layer).toBe("L");
  });

  it("leaves what's left as it was: a smooth node smoothed from its neighbours keeps those handles at the cut", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0), cusp(30, 0)] }));
    const before = asCubic(pathOf(st).path[0]);
    const out = deletePolySegment(st, "p", 1, makeId)!;
    const after = asCubic(pathOf(applyChange(st, out.change)).path[0]);
    for (const k of ["c1", "c2", "to"] as const) {
      expect(after[k][0]).toBeCloseTo(before[k][0], 2);
      expect(after[k][1]).toBeCloseTo(before[k][1], 2);
    }
    // And on a closed path, both new ends.
    const ring = doc(addPolyline("p", { nodes: [curve(0, 0), curve(20, 0), curve(20, 20), curve(0, 20)], closed: true }));
    const kept = pathOf(ring).path.filter((_, i) => i !== 1);
    const opened = pathOf(applyChange(ring, deletePolySegment(ring, "p", 1, makeId)!.change)).path;
    expect(opened).toHaveLength(3);
    // Opened runs from node 2 round to node 1: the kept segments in that order.
    const order = [kept[1]!, kept[2]!, kept[0]!].map(asCubic);
    opened.map(asCubic).forEach((e, i) => {
      for (const k of ["from", "c1", "c2", "to"] as const) {
        expect(e[k][0]).toBeCloseTo(order[i]![k][0], 2);
        expect(e[k][1]).toBeCloseTo(order[i]![k][1], 2);
      }
    });
  });

  it("drops a part left with a single node, and the whole path if nothing is left", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(20, 0)] }));
    const first = deletePolySegment(st, "p", 0, makeId)!;
    expect(first.ids).toEqual(["p"]);
    expect(nodesOf(applyChange(st, first.change))).toEqual([cusp(10, 0), cusp(20, 0)]);
    const last = deletePolySegment(st, "p", 1, makeId)!;
    expect(nodesOf(applyChange(st, last.change))).toEqual([cusp(0, 0), cusp(10, 0)]);
    const two = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0)] }));
    const gone = deletePolySegment(two, "p", 0, makeId)!;
    expect(gone.ids).toEqual([]);
    expect(applyChange(two, gone.change).entities.p).toBeUndefined();
    expect(deletePolySegment(two, "p", 1, makeId)).toBeUndefined();
  });
});

describe("the selected segment", () => {
  const r = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { out: [4, 0] }), cusp(20, 0, { in: [0, 3] }), cusp(30, 0)] })));
  const p = r.shapes.p!;
  if (p.kind !== "polyline") throw new Error("not a path");

  it("is editor state, apart from a selected node, cleared when the selection changes", () => {
    const e = editorReducer({ ...initialEditor, selection: ["p"] }, { type: "segment", segment: { shape: "p", index: 1 } });
    expect(e.segment).toEqual({ shape: "p", index: 1 });
    expect(editorReducer(e, { type: "node", node: { shape: "p", index: 0 } }).segment).toBeNull();
    expect(editorReducer({ ...e, node: { shape: "p", index: 0 } }, { type: "segment", segment: { shape: "p", index: 1 } }).node).toBeNull();
    expect(editorReducer(e, { type: "select", ids: ["p"] }).segment).toEqual({ shape: "p", index: 1 });
    expect(editorReducer(e, { type: "select", ids: ["q"] }).segment).toBeNull();
    expect(editorReducer(e, { type: "tool", tool: "rect" }).segment).toBeNull();
    expect(initialEditor.segment).toBeNull();
  });

  it("is found with its drawn element and place along the path", () => {
    const e = { ...initialEditor, selection: ["p"], segment: { shape: "p", index: 1 } };
    const s = selectedPathSegment(r, e)!;
    expect(s.position).toBe(1);
    expect(s.element).toEqual(p.path[1]);
    expect(selectedPathSegment(r, { ...e, segment: { shape: "p", index: 3 } })).toBeNull();
    expect(selectedPathSegment(r, { ...e, tool: "rect" })).toBeNull();
  });

  it("shows the handles at its two ends", () => {
    expect(segmentHandles(p, 1)).toEqual([
      { node: 1, which: "out", point: [14, 10] },
      { node: 2, which: "in", point: [20, 3] },
    ]);
    expect(segmentHandles(p, 2)).toEqual([]);
  });

  it("shows in the status bar with its length", () => {
    const idle = { tool: "select" as const, selection: ["p"], cursor: null, draw: null, measure: null, node: null };
    expect(positionStatus({ ...idle, segment: { shape: "p", index: 2 } }, r)).toBe("segment 3 of 3 · 10 mm");
  });
});
