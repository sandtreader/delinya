import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { addPolyline, insertPolyNode, pathBounds, resolve, setPolyHandle, setPolyNodeType, type PolyNode } from "../src/model";
import { nodeHandles } from "../src/canvas/polyEdit";
import { doc } from "./helpers";

// Two kinds of node: a corner ("cusp": its in and out handles are each
// optional and move independently) and a smooth curve ("curve": handles
// opposite each other, auto when it has none of its own). Whether a
// segment is straight or curved is down to the handles at its two ends.

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const cusp = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "cusp", ...extra });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];
const pathOf = (st: DocState, id = "p") => {
  const s = resolve(st).shapes[id]!;
  if (s.kind !== "polyline") throw new Error("not a path");
  return s;
};
const third = 10 / 3;

describe("resolving a corner", () => {
  it("curves either side using its own handles, which needn't line up", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [-2, 3], out: [4, 1] }), cusp(20, 0)] }));
    const p = pathOf(st);
    expect(p.path[0]).toMatchObject({ kind: "cubic", c1: [0, 0], c2: [8, 13], to: [10, 10] });
    expect(p.path[1]).toMatchObject({ kind: "cubic", from: [10, 10], c1: [14, 11], c2: [20, 0] });
    expect(p.nodes[1]).toMatchObject({ type: "cusp", in: [-2, 3], out: [4, 1], auto: false });
    expect(p.snaps.find((s) => s.point[0] === 10 && s.point[1] === 10)!.type).toBe("corner");
    expect(resolve(st).issues).toEqual([]);
  });

  it("is straight on a side with no handle", () => {
    const one = pathOf(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { out: [4, 1] }), cusp(20, 0)] })));
    expect(one.path[0]).toEqual({ kind: "segment", from: [0, 0], to: [10, 10] });
    expect(one.path[1]!.kind).toBe("cubic");
  });

  it("there is no third type", () => {
    const r = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), { x: 10, y: 10, type: "curvedCusp" } as unknown as PolyNode, cusp(20, 0)] })));
    expect(r.issues.some((i) => i.entity === "p" && i.code === "bad-value")).toBe(true);
  });
});

describe("changing a node's type", () => {
  it("smooth to corner keeps the handles it has, smoothed ones included, so the shape stays", () => {
    const auto = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    const before = pathOf(auto).nodes[1]!;
    const n = nodesOf(apply(auto, setPolyNodeType(auto, "p", 1, "cusp")))[1]!;
    expect(n.type).toBe("cusp");
    expect(n.in![0]).toBeCloseTo(before.in![0]);
    expect(n.in![1]).toBeCloseTo(before.in![1]);
    expect(n.out![0]).toBeCloseTo(before.out![0]);
    expect(n.out![1]).toBeCloseTo(before.out![1]);
  });

  it("corner with both handles to smooth: turns them into line, each keeping its length", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [0, -2], out: [4, 0] }), cusp(20, 0)] }));
    const n = nodesOf(apply(st, setPolyNodeType(st, "p", 1, "curve")))[1]!;
    expect(n.type).toBe("curve");
    expect(Math.hypot(...n.in!)).toBeCloseTo(2);
    expect(Math.hypot(...n.out!)).toBeCloseTo(4);
    expect(n.in![0] * n.out![1] - n.in![1] * n.out![0]).toBeCloseTo(0);
    expect(n.in![0] * n.out![0] + n.in![1] * n.out![1]).toBeLessThan(0);
    const u = [4 / Math.hypot(4, 2), 2 / Math.hypot(4, 2)];
    expect(n.out![0]).toBeCloseTo(4 * u[0]!);
    expect(n.out![1]).toBeCloseTo(4 * u[1]!);
  });

  it("corner with one handle to smooth: the other turns opposite, a third of the way to its neighbour", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 10), cusp(10, 10, { out: [3, 0] }), cusp(20, 0)] }));
    const n = nodesOf(apply(st, setPolyNodeType(st, "p", 1, "curve")))[1]!;
    expect(n.out).toEqual([3, 0]);
    expect(n.in![0]).toBeCloseTo(-third);
    expect(n.in![1]).toBeCloseTo(0);
  });

  it("corner with no handles to smooth: auto", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10), cusp(20, 0)] }));
    expect(nodesOf(apply(st, setPolyNodeType(st, "p", 1, "curve")))[1]).toEqual(curve(10, 10));
  });
});

describe("dragging a corner's handles", () => {
  it("moves only the one dragged", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [0, -2], out: [4, 0] }), cusp(20, 0)] }));
    expect(nodesOf(apply(st, setPolyHandle(st, "p", 1, "out", [1, 5])))[1]).toEqual(cusp(10, 10, { in: [0, -2], out: [1, 5] }));
    const one = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { out: [4, 0] }), cusp(20, 0)] }));
    expect(nodesOf(apply(one, setPolyHandle(one, "p", 1, "out", [1, 5])))[1]).toEqual(cusp(10, 10, { out: [1, 5] }));
    expect(setPolyHandle(one, "p", 1, "out", [4, 0])).toBeUndefined();
  });

  it("breaks a smooth curve into a corner when asked (Alt-drag), the other handle staying put", () => {
    const auto = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    const smoothIn = pathOf(auto).nodes[1]!.in!;
    const n = nodesOf(apply(auto, setPolyHandle(auto, "p", 1, "out", [0, 4], {}, true)))[1]!;
    expect(n.type).toBe("cusp");
    expect(n.out).toEqual([0, 4]);
    expect(n.in![0]).toBeCloseTo(smoothIn[0]);
    expect(n.in![1]).toBeCloseTo(smoothIn[1]);
  });

  it("shows the handles it has, for dragging", () => {
    const p = pathOf(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [0, -2], out: [4, 0] }), cusp(20, 0, { out: [1, 1] }), cusp(30, 0)] })));
    expect(nodeHandles(p, 1)).toEqual([{ which: "in", point: [10, 8] }, { which: "out", point: [14, 10] }]);
    expect(nodeHandles(p, 2)).toEqual([{ which: "out", point: [21, 1] }]);
    expect(nodeHandles(p, 3)).toEqual([]);
  });
});

describe("inserting a node next to a corner with handles", () => {
  it("leaves the shape and the corner's other handle as they were", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [0, -2], out: [4, 3] }), cusp(20, 0)] }));
    const before = pathBounds(pathOf(st).path);
    const after = apply(st, insertPolyNode(st, "p", 1, 0.5));
    expect(nodesOf(after)).toHaveLength(4);
    expect(nodesOf(after)[1]!.in).toEqual([0, -2]);
    const b = pathBounds(pathOf(after).path);
    for (const k of ["minX", "minY", "maxX", "maxY"] as const) expect(b[k]).toBeCloseTo(before[k], 6);
  });
});
