import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyChange, emptyState, type DocState } from "@sandtreader/collab/protocol";
import {
  addPolyline, addRect, breakPolyNode, joinPolyEnds, linkAlign, resolve,
  type PathElement, type PolyNode,
} from "../src/model";
import { joinTarget, ownNodeSnaps } from "../src/canvas/polyEdit";
import { snapPoint } from "../src/canvas/snap";
import { EditorContext, initialEditor } from "../src/app/editor";
import { store } from "../src/app/store";
import { NodeCard } from "../src/panels/NodeCard";
import { doc } from "./helpers";

// Breaking a path apart at a node (two end nodes left on the same spot),
// and joining two end nodes that sit on the same spot back into one: the
// two ends of one path close it, ends of two paths make one path.

const cusp = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "cusp", ...extra });
const curve = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "curve", ...extra });
const nodesOf = (st: DocState, id = "p") => st.entities[id]!.props.nodes as PolyNode[];
const pathOf = (st: DocState, id = "p") => {
  const s = resolve(st).shapes[id]!;
  if (s.kind !== "polyline") throw new Error("not a path");
  return s;
};
/** Every drawn element's points, for comparing shapes. */
const pointsOf = (path: PathElement[]) => path.flatMap((e) => (e.kind === "cubic" ? [e.from, e.c1, e.c2, e.to] : e.kind === "segment" ? [e.from, e.from, e.to, e.to] : []));
const expectSameShape = (a: PathElement[], b: PathElement[]) => {
  const pa = pointsOf(a), pb = pointsOf(b);
  expect(pb).toHaveLength(pa.length);
  pa.forEach((p, i) => { expect(pb[i]![0]).toBeCloseTo(p[0], 2); expect(pb[i]![1]).toBeCloseTo(p[1], 2); });
};
let n = 0;
const makeId = (prefix: string) => `${prefix}-${++n}`;

describe("breaking a path apart at a node", () => {
  it("splits an open path in two, both ends left on the node, nothing moving", () => {
    const st = doc(
      { type: "entity_added", id: "L", kind: "layer", props: { name: "Cuts" } },
      addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10), cusp(20, 0), cusp(30, 0)], layer: "L" }),
    );
    const before = pathOf(st);
    const out = breakPolyNode(st, "p", 1, makeId)!;
    const after = applyChange(st, out.change);
    expect(out.ids).toHaveLength(2);
    expect(out.ids[0]).toBe("p");
    const other = out.ids[1]!;
    // The broken node becomes two corners, each with the handle its side uses.
    const head = nodesOf(after), tail = nodesOf(after, other);
    expect(head).toHaveLength(2);
    expect(tail).toHaveLength(3);
    expect(head[1]).toMatchObject({ x: 10, y: 10, type: "cusp" });
    expect(head[1]!.out).toBeUndefined();
    expect(head[1]!.in![0]).toBeCloseTo(before.nodes[1]!.in![0]);
    expect(tail[0]).toMatchObject({ x: 10, y: 10, type: "cusp" });
    expect(tail[0]!.in).toBeUndefined();
    expect(tail[0]!.out![0]).toBeCloseTo(before.nodes[1]!.out![0]);
    expect(after.entities[other]!.props.layer).toBe("L");
    expectSameShape(before.path, [...pathOf(after).path, ...pathOf(after, other).path]);
    // The end left on the original path stays selected.
    expect(out.node).toBe(1);
  });

  it("opens a closed path there, running from the node round to itself", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(0, 10)], closed: true }));
    const out = breakPolyNode(st, "p", 1, makeId)!;
    const after = applyChange(st, out.change);
    expect(out.ids).toEqual(["p"]);
    expect(after.entities.p!.props.closed).toBe(false);
    expect(nodesOf(after)).toEqual([cusp(10, 0), cusp(10, 10), cusp(0, 10), cusp(0, 0), cusp(10, 0)]);
    expect(out.node).toBe(4);
  });

  it("does nothing at an open path's end", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(20, 0)] }));
    expect(breakPolyNode(st, "p", 0, makeId)).toBeUndefined();
    expect(breakPolyNode(st, "p", 2, makeId)).toBeUndefined();
  });
});

describe("joining end nodes", () => {
  it("closes a path whose two ends meet, merging them", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0, { out: [2, 0] }), cusp(10, 0), cusp(10, 10), cusp(0, 0, { in: [0, 3] })] }));
    const out = joinPolyEnds(st, { shape: "p", index: 3 }, { shape: "p", index: 0 })!;
    const after = applyChange(st, out.change);
    expect(after.entities.p!.props.closed).toBe(true);
    expect(nodesOf(after)).toEqual([cusp(0, 0, { in: [0, 3], out: [2, 0] }), cusp(10, 0), cusp(10, 10)]);
    expect(out.node).toBe(0);
  });

  it("joins two paths into one, end to start, keeping the dragged one", () => {
    const st = doc(
      addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0)] }),
      addPolyline("q", { nodes: [cusp(10, 0), cusp(10, 10), cusp(20, 10)] }),
    );
    const out = joinPolyEnds(st, { shape: "p", index: 1 }, { shape: "q", index: 0 })!;
    const after = applyChange(st, out.change);
    expect(after.entities.q).toBeUndefined();
    expect(nodesOf(after)).toEqual([cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(20, 10)]);
    expect(after.entities.p!.props.closed).not.toBe(true);
    expect(out.node).toBe(1);
  });

  it("turns either path round as needed, its handles swapping sides", () => {
    const st = doc(
      addPolyline("p", { nodes: [cusp(10, 0), cusp(0, 0)] }),
      addPolyline("q", { nodes: [cusp(20, 10), cusp(10, 10, { in: [1, 1], out: [2, 2] }), cusp(10, 0)] }),
    );
    const out = joinPolyEnds(st, { shape: "p", index: 0 }, { shape: "q", index: 2 })!;
    const after = applyChange(st, out.change);
    expect(nodesOf(after)).toEqual([cusp(0, 0), cusp(10, 0), cusp(10, 10, { in: [2, 2], out: [1, 1] }), cusp(20, 10)]);
    expect(out.node).toBe(1);
  });

  it("undoes a break exactly, a smooth node coming back smooth", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), curve(10, 10, { in: [-4, 0], out: [4, 0] }), cusp(20, 0)] }));
    const broken = breakPolyNode(st, "p", 1, makeId)!;
    const mid = applyChange(st, broken.change);
    const joined = applyChange(mid, joinPolyEnds(mid, { shape: "p", index: broken.node }, { shape: broken.ids[1]!, index: 0 })!.change);
    expect(nodesOf(joined)).toEqual(nodesOf(st));
    expect(joined.entities[broken.ids[1]!]).toBeUndefined();
  });

  it("brings a linked path's nodes into the kept path's own frame", () => {
    const st = doc(
      addRect("anchor", { x: 100, y: 0, width: 10, height: 10 }),
      addPolyline("q", { nodes: [cusp(0, 50), cusp(20, 50)] }),
      linkAlign("al", "anchor", ["q"], "x", "start"),
      addPolyline("p", { nodes: [cusp(80, 40), cusp(100, 50)] }),
    );
    // q is drawn from x 100: its start meets p's end.
    const out = joinPolyEnds(st, { shape: "p", index: 1 }, { shape: "q", index: 0 })!;
    const drawn = pathOf(applyChange(st, out.change)).nodes.map((nd) => nd.point);
    expect(drawn).toEqual([[80, 40], [100, 50], [120, 50]]);
  });

  it("won't join a node that isn't an end, or close a path of fewer than 3 nodes", () => {
    const st = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(0, 0)] }));
    expect(joinPolyEnds(st, { shape: "p", index: 2 }, { shape: "p", index: 0 })).toBeUndefined();
    const four = doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(0, 0)] }));
    expect(joinPolyEnds(four, { shape: "p", index: 1 }, { shape: "p", index: 0 })).toBeUndefined();
  });
});

describe("finding an end to join to", () => {
  it("is another open end on the same spot: the path's own other end first", () => {
    const st = doc(
      addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(0, 0)] }),
      addPolyline("q", { nodes: [cusp(0, 0), cusp(-10, 0)] }),
      addPolyline("r", { nodes: [cusp(30, 30), cusp(10, 10)] }),
    );
    const r = resolve(st);
    expect(joinTarget(r, { shape: "p", index: 3 })).toEqual({ shape: "p", index: 0 });
    expect(joinTarget(r, { shape: "q", index: 0 })).not.toBeNull();
    expect(joinTarget(r, { shape: "r", index: 1 })).toBeNull();   // p's node 2 is not an end
    expect(joinTarget(r, { shape: "p", index: 1 })).toBeNull();   // not an end itself
  });

  it("lets a dragged node snap to its own path's other nodes", () => {
    const r = resolve(doc(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(5, 5)] })));
    const p = r.shapes.p!;
    const own = ownNodeSnaps(p, 3);
    expect(own.map((s) => s.point)).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(own[0]!.type).toBe("endpoint");
    const hit = snapPoint(r, [0.4, 0.3], 1, new Set(["p"]), 1, new Set(), own);
    expect(hit.point).toEqual([0, 0]);
  });
});

describe("the node card's join and break buttons", () => {
  function card(nodes: PolyNode[], index: number, closed = false) {
    store.replace(emptyState());
    store.commit(addPolyline("p", { nodes, closed }));
    const editor = { ...initialEditor, selection: ["p"], node: { shape: "p", index } };
    return renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor, dispatch: () => {} } }, createElement(NodeCard)));
  }
  const open = [cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(20, 10)];

  it("offers Break apart in the middle of a path, or anywhere on a closed one", () => {
    expect(card(open, 1)).toContain('aria-label="Break apart"');
    expect(card(open, 0, true)).toContain('aria-label="Break apart"');
    expect(card(open, 1)).not.toContain('aria-label="Join"');
  });

  it("offers Join on an end with another end on the same spot, and neither on a lone end", () => {
    const html = card([cusp(0, 0), cusp(10, 0), cusp(10, 10), cusp(0, 0)], 3);
    expect(html).toContain('aria-label="Join"');
    expect(html).not.toContain('aria-label="Break apart"');
    const lone = card(open, 3);
    expect(lone).not.toContain('aria-label="Join"');
    expect(lone).not.toContain('aria-label="Break apart"');
    // Before the bin.
    expect(html.indexOf('aria-label="Join"')).toBeLessThan(html.indexOf('aria-label="Delete node"'));
  });
});
