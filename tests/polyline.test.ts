import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  KINDS, addPolyline, addRect, cubicPoint, deletePolyNode, duplicateShapes, insertPolyNode, linkAlign, moveBy,
  movePolyNode, pathBounds, resolve, setPolyClosed, setPolyHandle, setPolyNodeType, type PolyNode,
} from "../src/model";
import { doc } from "./helpers";

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];

describe("resolving a path", () => {
  it("joins cusp nodes with straight segments, open or closed", () => {
    const open = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)] })));
    const p = open.shapes.p!;
    expect(p.kind).toBe("polyline");
    expect(p.path).toEqual([
      { kind: "segment", from: [0, 0], to: [10, 0] },
      { kind: "segment", from: [10, 0], to: [10, 10] },
    ]);
    expect(p.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const closed = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)], closed: true })));
    expect(closed.shapes.p!.path).toHaveLength(3);
    expect(closed.shapes.p!.path[2]).toEqual({ kind: "segment", from: [10, 10], to: [0, 0] });
  });

  it("snaps to every node, and the middle of straight segments", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)] }))).shapes.p!;
    const at = p.snaps.map((s) => s.point);
    for (const n of [[0, 0], [10, 0], [10, 10], [5, 0], [10, 5]]) expect(at).toContainEqual(n);
  });

  it("curves either side of a curve node, smoothing it from its neighbours when it has no handles of its own", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }))).shapes.p!;
    const third = Math.hypot(10, 10) / 3;
    expect(p.path).toHaveLength(2);
    const [a, b] = p.path as [Extract<typeof p.path[number], { kind: "cubic" }>, Extract<typeof p.path[number], { kind: "cubic" }>];
    expect(a.kind).toBe("cubic");
    expect(a.from).toEqual([0, 0]);
    expect(a.c1).toEqual([0, 0]);
    expect(a.c2[0]).toBeCloseTo(10 - third);
    expect(a.c2[1]).toBeCloseTo(10);
    expect(a.to).toEqual([10, 10]);
    expect(b.c1[0]).toBeCloseTo(10 + third);
    expect(b.c1[1]).toBeCloseTo(10);
    // The curve peaks at the node, so the bounds stop there.
    expect(p.bounds.maxY).toBeCloseTo(10);
    expect(p.bounds.minY).toBeCloseTo(0);
  });

  it("uses a curve node's own handles when it has them", () => {
    const p = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-2, 0], out: [5, 0] }), cusp(20, 0)] }))).shapes.p!;
    expect(p.path[0]).toMatchObject({ kind: "cubic", c2: [8, 10] });
    expect(p.path[1]).toMatchObject({ kind: "cubic", c1: [15, 10] });
  });

  it("drops bad nodes with an issue, and a path left with fewer than 2 nodes altogether", () => {
    const r = resolve(doc(
      addPolyline("p", { nodes: [cusp(0, 0), { x: "a", y: 0, type: "cusp" } as unknown as PolyNode, cusp(10, 0)] }),
      addPolyline("q", { nodes: [cusp(0, 0)] }),
      { type: "entity_added", id: "z", kind: KINDS.polyline, props: { nodes: "nope" } },
    ));
    expect(r.shapes.p!.path).toHaveLength(1);
    expect(r.shapes.q).toBeUndefined();
    expect(r.shapes.z).toBeUndefined();
    for (const id of ["p", "q", "z"]) expect(r.issues.some((i) => i.entity === id && i.code === "bad-value"), id).toBe(true);
  });
});

describe("moving and copying a path", () => {
  const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-2, 0], out: [2, 0] }), cusp(20, 0)] }));

  it("moves every node, carrying its handles", () => {
    const after = apply(st, moveBy(st, "p", 5, -1));
    expect(nodesOf(after)).toEqual([cusp(5, -1), curve(15, 9, { in: [-2, 0], out: [2, 0] }), cusp(25, -1)]);
  });

  it("duplicates like any shape", () => {
    const out = duplicateShapes(st, ["p"], [0, 30], (k) => `${k}-1`)!;
    expect(nodesOf(applyChange(st, out.change), "polyline-1").map((n) => [n.x, n.y])).toEqual([[0, 30], [10, 40], [20, 30]]);
  });

  it("follows an align link, all its nodes together", () => {
    const linked = doc(
      addRect("anchor", { x: 100, y: 0, width: 10, height: 10 }),
      addPolyline("p", { nodes: [cusp(0, 50), cusp(20, 60)] }),
      linkAlign("al", "anchor", ["p"], "x", "start"),
    );
    expect(resolve(linked).shapes.p!.bounds).toMatchObject({ minX: 100, maxX: 120, minY: 50 });
  });
});

describe("editing nodes", () => {
  const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10), cusp(20, 0)] }));

  it("moves one node", () => {
    expect(nodesOf(apply(st, movePolyNode(st, "p", 1, [12, 15])))[1]).toEqual(cusp(12, 15));
    expect(movePolyNode(st, "p", 1, [10, 10])).toBeUndefined();
    expect(movePolyNode(st, "p", 9, [0, 0])).toBeUndefined();
  });

  it("makes a node a curve (smoothed from its neighbours) or a cusp (dropping its handles)", () => {
    const curved = apply(st, setPolyNodeType(st, "p", 1, "curve"));
    expect(nodesOf(curved)[1]).toEqual(curve(10, 10));
    expect(resolve(curved).shapes.p!.path[0]!.kind).toBe("cubic");
    const manual = apply(curved, setPolyHandle(curved, "p", 1, "out", [3, 0]));
    const back = apply(manual, setPolyNodeType(manual, "p", 1, "cusp"));
    expect(nodesOf(back)[1]).toEqual(cusp(10, 10));
    expect(setPolyNodeType(back, "p", 1, "cusp")).toBeUndefined();
  });

  it("drags a handle smoothly: the other turns opposite, keeping its own length", () => {
    const manual = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-3, 0], out: [5, 0] }), cusp(20, 0)] }));
    const n = nodesOf(apply(manual, setPolyHandle(manual, "p", 1, "out", [0, 4])))[1]!;
    expect(n.out).toEqual([0, 4]);
    expect(n.in![0]).toBeCloseTo(0);
    expect(n.in![1]).toBeCloseTo(-3);
  });

  it("dragging a handle of an auto curve node fixes both handles, starting from the smoothed ones", () => {
    const auto = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    const n = nodesOf(apply(auto, setPolyHandle(auto, "p", 1, "out", [0, 4])))[1]!;
    expect(n.out).toEqual([0, 4]);
    expect(n.in![0]).toBeCloseTo(0);
    expect(n.in![1]).toBeCloseTo(-Math.hypot(10, 10) / 3);
    expect(setPolyHandle(st, "p", 1, "out", [1, 1])).toBeUndefined();   // a cusp has no handles
  });

  it("deletes a node; a path left with one node goes, a closed one left with two opens", () => {
    expect(nodesOf(apply(st, deletePolyNode(st, "p", 1)))).toEqual([cusp(0, 0), cusp(20, 0)]);
    const two = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0)] }));
    expect(apply(two, deletePolyNode(two, "p", 0)).entities.p).toBeUndefined();
    const tri = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)], closed: true }));
    const opened = apply(tri, deletePolyNode(tri, "p", 2));
    expect(opened.entities.p!.props).toMatchObject({ nodes: [cusp(0, 0), cusp(10, 0)], closed: false });
  });

  it("inserts a node into a straight segment at its middle", () => {
    expect(nodesOf(apply(st, insertPolyNode(st, "p", 0)))).toEqual([cusp(0, 0), cusp(5, 5), cusp(10, 10), cusp(20, 0)]);
  });

  it("inserts a node into a curve without changing its shape", () => {
    const c = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-4, 0], out: [4, 0] }), cusp(20, 0)] }));
    const before = resolve(c).shapes.p!;
    const after = resolve(apply(c, insertPolyNode(c, "p", 0, 0.5))).shapes.p!;
    expect(nodesOf(apply(c, insertPolyNode(c, "p", 0, 0.5)))).toHaveLength(4);
    const seg = before.path[0]! as Extract<typeof before.path[number], { kind: "cubic" }>;
    const mid = cubicPoint(seg, 0.5);
    const inserted = nodesOf(apply(c, insertPolyNode(c, "p", 0, 0.5)))[1]!;
    expect(inserted.type).toBe("curve");
    expect(inserted.x).toBeCloseTo(mid[0]);
    expect(inserted.y).toBeCloseTo(mid[1]);
    const b0 = pathBounds(before.path), b1 = pathBounds(after.path);
    for (const k of ["minX", "minY", "maxX", "maxY"] as const) expect(b1[k]).toBeCloseTo(b0[k], 6);
  });

  it("opens and closes a path of three or more nodes", () => {
    const closed = apply(st, setPolyClosed(st, "p", true));
    expect(closed.entities.p!.props.closed).toBe(true);
    expect(setPolyClosed(closed, "p", true)).toBeUndefined();
    const two = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0)] }));
    expect(setPolyClosed(two, "p", true)).toBeUndefined();
  });
});
