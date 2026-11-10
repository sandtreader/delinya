import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  KINDS, addPolyline, addRect, alignOnce, cubic, cubicPoint, deleteEntity, duplicateShapes, elementLength, handlesFor,
  insertPolyNode, linkAlign, moveTo, movePolyNode, resolve, setPolyHandle, unlinkAlign,
  splitCubic, type Cubic, type Path, type PolyNode, type ResolvedShape,
} from "../src/model";
import { shapeStatus } from "../src/view/format";
import { doc } from "./helpers";

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const curve = (x: number, y: number): PolyNode => ({ x, y, type: "curve" });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];

/** Two paths draw the same, element by element, to within 1e-9. */
function sameElements(a: Path, b: Path): void {
  expect(a).toHaveLength(b.length);
  a.forEach((e, i) => {
    const f = b[i]!;
    expect(e.kind).toBe(f.kind);
    if (e.kind !== "cubic" || f.kind !== "cubic") return;
    for (const k of ["from", "c1", "c2", "to"] as const) {
      expect(e[k][0]).toBeCloseTo(f[k][0], 9);
      expect(e[k][1]).toBeCloseTo(f[k][1], 9);
    }
  });
}

describe("path geometry details", () => {
  it("measures a cubic accurately", () => {
    const hump = cubic([0, 0], [0, 10], [10, 10], [10, 0]);
    let chords = 0;
    for (let i = 1, n = 20000; i <= n; i++) {
      const a = cubicPoint(hump, (i - 1) / n), b = cubicPoint(hump, i / n);
      chords += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    expect(elementLength(hump)).toBeCloseTo(chords, 5);
  });

  it("smooths an open path's end node along its one neighbour", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [curve(0, 0), cusp(30, 0)] }))).shapes.p!;
    expect(p.path[0]).toMatchObject({ kind: "cubic", c1: [10, 0], c2: [30, 0] });
  });

  it("smooths a closed path's nodes from both neighbours, wrapping round", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [curve(0, 0), curve(10, 0), curve(10, 10), curve(0, 10)], closed: true }))).shapes.p!;
    expect(p.path).toHaveLength(4);
    expect(p.path.every((e) => e.kind === "cubic")).toBe(true);
    // Symmetric, so it bulges equally past every side.
    expect(p.bounds.minX).toBeCloseTo(-(p.bounds.maxX - 10));
    expect(p.bounds.minY).toBeCloseTo(-(p.bounds.maxY - 10));
  });

  it("never throws on junk, flagging it", () => {
    const r = resolve(doc(
      addPolyline("a", { nodes: [cusp(0, 0), cusp(10, 0)], closed: true }),
      { type: "entity_added", id: "b", kind: KINDS.polyline, props: { nodes: [{ x: 0, y: 0, type: "curve", in: "x" }, null, [1, 2], { x: 5, y: 5, type: "curve", out: [1, 1] }], closed: "yes" } },
    ));
    expect(r.shapes.a!.kind === "polyline" && r.shapes.a!.closed).toBe(false);
    expect(r.shapes.b!.path).toHaveLength(1);
    for (const id of ["a", "b"]) expect(r.issues.some((i) => i.entity === id && i.code === "bad-value"), id).toBe(true);
  });

  it("has no resize handles and a short status", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 5), cusp(20, 0)] }))).shapes.p!;
    expect(handlesFor(p)).toEqual([]);
    expect(shapeStatus(p)).toBe("path · 3 nodes · from 0, 0 mm · 20 × 5 mm");
  });
});

describe("path editing details", () => {
  it("inserts into a curve between auto nodes without changing the drawn shape", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(20, 20), curve(40, 0), cusp(60, 20)] }));
    const before = resolve(st).shapes.p!.path;
    const after = apply(st, insertPolyNode(st, "p", 1, 0.3));
    expect(nodesOf(after)).toHaveLength(5);
    // The neighbours took their smoothed handles as their own.
    expect(nodesOf(after)[1]!.in).toBeDefined();
    expect(nodesOf(after)[3]!.in).toBeDefined();
    // Exactly the old path with its second curve split in two.
    const [l, r] = splitCubic(before[1] as Cubic, 0.3);
    sameElements(resolve(after).shapes.p!.path, [before[0]!, l, r, before[2]!]);
  });

  it("inserts into the closing segment of a closed path", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)], closed: true }));
    expect(nodesOf(apply(st, insertPolyNode(st, "p", 2)))).toEqual([cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(5, 5)]);
    const open = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0)] }));
    expect(insertPolyNode(open, "p", 1)).toBeUndefined();
  });

  it("carries gesture flags so a drag is one undo step", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    expect(movePolyNode(st, "p", 0, [1, 1], { start: true })).toMatchObject({ gestureStart: true });
    expect(setPolyHandle(st, "p", 1, "in", [-1, 0], { end: true })).toMatchObject({ gestureEnd: true });
  });

  it("moves to a position by its first node", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(5, 5), cusp(15, 10)] }));
    expect(nodesOf(apply(st, moveTo(st, "p", 0, 0)))).toEqual([cusp(0, 0), cusp(10, 5)]);
  });
});

describe("paths and links", () => {
  const linked = doc(
    addRect("anchor", { x: 100, y: 0, width: 10, height: 10 }),
    addPolyline("p", { nodes: [cusp(0, 50), cusp(20, 60)] }),
    linkAlign("al", "anchor", ["p"], "x", "start"),
  );
  const xy = (st: DocState) => nodesOf(st).map((n) => [n.x, n.y]);

  it("unlinking writes the derived position back on the link's axis only", () => {
    expect(xy(apply(linked, unlinkAlign(linked, "al")))).toEqual([[100, 50], [120, 60]]);
  });

  it("deleting the anchor keeps the path where the link put it", () => {
    expect(xy(apply(linked, deleteEntity(linked, "anchor")))).toEqual([[100, 50], [120, 60]]);
  });

  it("copies a linked path where it is drawn", () => {
    const out = duplicateShapes(linked, ["p"], [0, 20], (k) => `${k}-1`)!;
    expect(xy(applyChange(linked, out.change)).length).toBe(2);
    const copy = applyChange(linked, out.change).entities["polyline-1"]!.props.nodes as PolyNode[];
    expect(copy.map((n) => [n.x, n.y])).toEqual([[100, 70], [120, 80]]);
  });

  it("aligns once like any shape", () => {
    const st = doc(
      addRect("ref", { x: 0, y: 100, width: 10, height: 10 }),
      addPolyline("p", { nodes: [cusp(30, 0), curve(40, 10), cusp(50, 0)] }),
    );
    const after = apply(st, alignOnce(st, "ref", ["p"], "y", "end"));
    const s: ResolvedShape = resolve(after).shapes.p!;
    expect(s.bounds.maxY).toBeCloseTo(110);
    expect(s.bounds.minX).toBeCloseTo(30);
  });
});
