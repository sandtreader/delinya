import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { addPolyline, resolve, setPolyHandle, type PolyNode } from "../src/model";
import { pullHandleSide } from "../src/canvas/polyEdit";
import { doc } from "./helpers";

// A handle dragged back onto its node goes (the corner is sharp on that
// side); Alt-dragging a node pulls a missing handle back out of it.

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const cusp = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "cusp", ...extra });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];
const pathOf = (st: DocState, id = "p") => {
  const s = resolve(st).shapes[id]!;
  if (s.kind !== "polyline") throw new Error("not a path");
  return s;
};

describe("dragging a handle onto its node", () => {
  it("takes a corner's handle off", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [-2, 0], out: [3, 0] }), cusp(20, 0)] }));
    expect(nodesOf(apply(st, setPolyHandle(st, "p", 1, "out", [0, 0])))[1]).toEqual(cusp(10, 10, { in: [-2, 0] }));
    const bare = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [-2, 0] }), cusp(20, 0)] }));
    expect(setPolyHandle(bare, "p", 1, "out", [0, 0])).toBeUndefined();
  });

  it("makes a smooth node a corner, keeping its other handle", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-2, 0], out: [3, 0] }), cusp(20, 0)] }));
    expect(nodesOf(apply(st, setPolyHandle(st, "p", 1, "out", [0, 0])))[1]).toEqual(cusp(10, 10, { in: [-2, 0] }));
    const auto = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0)] }));
    const smoothedIn = pathOf(auto).nodes[1]!.in!;
    const n = nodesOf(apply(auto, setPolyHandle(auto, "p", 1, "in", [0, 0])))[1]!;
    expect(n.type).toBe("cusp");
    expect(n.in).toBeUndefined();
    expect(n.out![0]).toBeCloseTo(-smoothedIn[0]);
    expect(n.out![1]).toBeCloseTo(-smoothedIn[1]);
  });

  it("then lets it be pulled out again", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 10, { in: [-2, 0] }), cusp(20, 0)] }));
    expect(nodesOf(apply(st, setPolyHandle(st, "p", 1, "out", [2, 1])))[1]).toEqual(cusp(10, 10, { in: [-2, 0], out: [2, 1] }));
  });
});

describe("which handle an Alt-drag pulls out of a node", () => {
  const p = pathOf(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(20, 0), cusp(30, 0, { out: [1, 1] }), cusp(40, 0)] })));

  it("with neither, the side the drag heads towards", () => {
    expect(pullHandleSide(p, 1, [1, 0.5])).toBe("out");
    expect(pullHandleSide(p, 1, [-1, 0.5])).toBe("in");
  });

  it("with one, the other, whichever way the drag goes", () => {
    expect(pullHandleSide(p, 3, [1, 0])).toBe("in");
  });

  it("only a side with a segment: an open path's ends have one", () => {
    expect(pullHandleSide(p, 0, [-1, 0])).toBe("out");
    expect(pullHandleSide(p, 4, [1, 0])).toBe("in");
  });

  it("none for a node with both handles, or a smooth one", () => {
    const q = pathOf(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0, { in: [-1, 0], out: [1, 1] }), curve(20, 5), cusp(30, 0)] })));
    expect(pullHandleSide(q, 1, [1, 0])).toBeNull();
    expect(pullHandleSide(q, 2, [1, 0])).toBeNull();
  });

  it("counts a handle of zero length as missing", () => {
    const z = pathOf(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0, { in: [-2, 0], out: [0, 0] }), cusp(20, 0)] })));
    expect(pullHandleSide(z, 1, [1, 0])).toBe("out");
  });
});
