import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  KINDS, addCircle, addLine, addRect, addVariable, alignOnce, deleteEntity, derivedAxes, equaliseOnce, freeDelta,
  linkAlign, linkLengths, linkSpacing, outerAnchors, resolve, spaceOnce, unlinkAlign,
  type Bounds, type Resolved,
} from "../src/model";
import { doc } from "./helpers";

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const b = (r: Resolved, id: string): Bounds => r.shapes[id]!.bounds;
const cx = (x: Bounds) => (x.minX + x.maxX) / 2;
const cy = (x: Bounds) => (x.minY + x.maxY) / 2;

/** A panel and a few things to line up against it. */
function base(...extra: Change[]) {
  return doc(
    addRect("panel", { x: 100, y: 50, width: 400, height: 200 }),
    addRect("r", { x: 10, y: 400, width: 60, height: 30 }),
    addCircle("c", { cx: 700, cy: 600, diameter: 20 }),
    addLine("l", { x: 0, y: 800, length: 50, angle: 0 }),
    ...extra,
  );
}

describe("live alignment links", () => {
  it("aligns item edges or centres to the anchor along one axis", () => {
    const cases: Array<[Parameters<typeof linkAlign>[3], Parameters<typeof linkAlign>[4], (r: Resolved, id: string) => number, number]> = [
      ["x", "start", (r, id) => b(r, id).minX, 100],
      ["x", "end", (r, id) => b(r, id).maxX, 500],
      ["x", "centre", (r, id) => cx(b(r, id)), 300],
      ["y", "start", (r, id) => b(r, id).minY, 50],
      ["y", "end", (r, id) => b(r, id).maxY, 250],
      ["y", "centre", (r, id) => cy(b(r, id)), 150],
    ];
    for (const [axis, mode, get, want] of cases) {
      const r = resolve(base(linkAlign("al", "panel", ["r", "c", "l"], axis, mode)));
      for (const id of ["r", "c", "l"]) expect(get(r, id), `${axis} ${mode} ${id}`).toBeCloseTo(want);
      // The other axis is untouched.
      expect(axis === "x" ? b(r, "r").minY : b(r, "r").minX).toBe(axis === "x" ? 400 : 10);
      expect(r.issues).toEqual([]);
    }
  });

  it("reports the derived positions and ignores the items' stored position on that axis", () => {
    let s = base(linkAlign("al", "panel", ["r"], "x", "start"));
    s = apply(s, { type: "props_changed", id: "r", props: { x: 999 } });
    const r = resolve(s);
    expect(b(r, "r").minX).toBe(100);
    expect(r.aligns).toEqual([{ id: "al", active: true, anchor: "panel", axis: "x", mode: "start", positions: { r: 100 } }]);
  });

  it("follows the anchor when it moves or resizes", () => {
    let s = base(linkAlign("ax", "panel", ["c"], "x", "centre"), linkAlign("ay", "panel", ["c"], "y", "centre"));
    s = apply(s, { type: "props_changed", id: "panel", props: { x: 0, width: 1000, height: 600 } });
    const r = resolve(s);
    expect(cx(b(r, "c"))).toBeCloseTo(500);
    expect(cy(b(r, "c"))).toBeCloseTo(350);
  });

  it("orders chained links by dependency, not by ID", () => {
    // "a0" sorts before "s9" but depends on it: x's position comes from the spacing link.
    const s = doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 500, y: 0, width: 20, height: 10 }),
      addRect("y", { x: 900, y: 100, width: 5, height: 5 }),
      linkSpacing("s9", "p", "q", ["x"], "x", "gaps"),
      linkAlign("a0", "x", ["y"], "x", "start"),
    );
    const r = resolve(s);
    expect(b(r, "x").minX).toBeCloseTo(50);
    expect(b(r, "y").minX).toBeCloseTo(50);
    expect(r.issues).toEqual([]);
  });

  it("chains alignment through alignment regardless of ID order", () => {
    const s = base(linkAlign("z1", "panel", ["r"], "x", "end"), linkAlign("a1", "r", ["c"], "x", "start"));
    const r = resolve(s);
    expect(b(r, "r").maxX).toBeCloseTo(500);
    expect(b(r, "c").minX).toBeCloseTo(440);
  });

  it("lets one shape be linked on x and on y by different links", () => {
    const r = resolve(base(linkAlign("ax", "panel", ["c"], "x", "start"), linkAlign("ay", "r", ["c"], "y", "end")));
    expect(b(r, "c").minX).toBeCloseTo(100);
    expect(b(r, "c").maxY).toBeCloseTo(430);
    expect(r.issues).toEqual([]);
  });

  it("refuses a second link positioning the same shape on the same axis", () => {
    const r = resolve(base(linkAlign("a1", "panel", ["c"], "x", "start"), linkAlign("a2", "r", ["c"], "x", "end")));
    expect(r.aligns.find((a) => a.id === "a1")!.active).toBe(true);
    expect(r.aligns.find((a) => a.id === "a2")!.active).toBe(false);
    expect(b(r, "c").minX).toBeCloseTo(100);
    expect(r.issues).toContainEqual(expect.objectContaining({ entity: "a2", code: "link-conflict" }));
  });

  it("conflicts with spacing too, first by ID winning", () => {
    const s = doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 500, y: 0, width: 20, height: 10 }),
      linkSpacing("s1", "p", "q", ["x"], "x", "gaps"),
      linkAlign("s2", "q", ["x"], "x", "end"),
    );
    const r = resolve(s);
    expect(b(r, "x").minX).toBeCloseTo(50);
    expect(r.issues).toContainEqual(expect.objectContaining({ entity: "s2", code: "link-conflict" }));
  });

  it("breaks cycles, leaving the links in the cycle inactive", () => {
    const r = resolve(base(linkAlign("a1", "r", ["c"], "x", "start"), linkAlign("a2", "c", ["r"], "x", "start")));
    expect(r.aligns.every((a) => !a.active)).toBe(true);
    expect(r.issues.filter((i) => i.code === "link-cycle").map((i) => i.entity).sort()).toEqual(["a1", "a2"]);
    expect(b(r, "r").minX).toBe(10);
    expect(b(r, "c").minX).toBe(690);
  });

  it("never throws on dangling or malformed links", () => {
    const bad: Change[] = [
      linkAlign("g1", "ghost", ["r"], "x", "start"),
      linkAlign("g2", "panel", ["ghost"], "y", "end"),
      { type: "entity_added", id: "g3", kind: KINDS.align, props: { anchor: 3, items: "r", axis: "z", mode: 1 } },
      linkAlign("g4", "panel", ["panel"], "x", "start"),
    ];
    for (const c of bad) {
      let r: Resolved | undefined;
      expect(() => { r = resolve(base(c)); }).not.toThrow();
      expect(r!.aligns.every((a) => !a.active)).toBe(true);
      expect(r!.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("align link actions", () => {
  it("unlinkAlign writes the derived positions back and removes the link", () => {
    const s = base(linkAlign("al", "panel", ["r", "c"], "x", "end"));
    const before = resolve(s);
    const after = apply(s, unlinkAlign(s, "al"));
    expect(after.entities.al).toBeUndefined();
    const r = resolve(after);
    expect(b(r, "r")).toEqual(b(before, "r"));
    expect(b(r, "c")).toEqual(b(before, "c"));
  });

  it("deleting the anchor removes the link; deleting the last item does too", () => {
    const s = base(linkAlign("al", "panel", ["r", "c"], "x", "start"));
    expect(apply(s, deleteEntity(s, "panel")).entities.al).toBeUndefined();
    let t = apply(s, deleteEntity(s, "r"));
    expect(t.entities.al!.props.items).toEqual(["c"]);
    t = apply(t, deleteEntity(t, "c"));
    expect(t.entities.al).toBeUndefined();
  });

  it("deleting an anchor leaves its items where the link put them", () => {
    const s = base(linkAlign("al", "panel", ["r", "c"], "x", "end"));
    const before = resolve(s);
    const after = apply(s, deleteEntity(s, "panel"));
    expect(after.entities.al).toBeUndefined();
    const r = resolve(after);
    expect(b(r, "r")).toEqual(b(before, "r"));
    expect(b(r, "c")).toEqual(b(before, "c"));
  });

  it("deleting a spacing anchor leaves the spaced items in place", () => {
    const s = doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 500, y: 0, width: 20, height: 10 }),
      linkSpacing("sp", "p", "q", ["x"], "x", "gaps"),
    );
    const r = resolve(apply(s, deleteEntity(s, "q")));
    expect(r.spacings).toEqual([]);
    expect(b(r, "x").minX).toBeCloseTo(50);
  });

  it("deleting the head of a chain keeps the whole chain in place", () => {
    const s = base(linkAlign("z1", "panel", ["r"], "x", "end"), linkAlign("a1", "r", ["c"], "x", "start"));
    const before = resolve(s);
    const r = resolve(apply(s, deleteEntity(s, "panel")));
    expect(b(r, "r")).toEqual(b(before, "r"));
    expect(b(r, "c")).toEqual(b(before, "c"));
    expect(r.aligns.map((a) => [a.id, a.active])).toEqual([["a1", true]]);
  });

  it("freeDelta drops movement on axes a link controls", () => {
    const r = resolve(base(linkAlign("ax", "panel", ["c"], "x", "start"), linkAlign("ay", "panel", ["r"], "y", "start"), linkAlign("ay2", "panel", ["c"], "y", "end")));
    expect(freeDelta(r, "panel", [5, 7])).toEqual([5, 7]);
    expect(freeDelta(r, "r", [5, 7])).toEqual([5, 0]);
    expect(freeDelta(r, "c", [5, 7])).toEqual([0, 0]);
    expect(freeDelta(r, "ghost", [5, 7])).toEqual([0, 0]);
  });

  it("derivedAxes says which axes a shape's position comes from a live link", () => {
    const r = resolve(base(linkAlign("al", "panel", ["c"], "y", "centre")));
    expect([...derivedAxes(r, "c")]).toEqual(["y"]);
    expect([...derivedAxes(r, "panel")]).toEqual([]);
  });
});

describe("one-shot operations", () => {
  it("alignOnce moves items to the reference and leaves no link", () => {
    const s = base();
    const after = apply(s, alignOnce(s, "panel", ["r", "c", "l"], "y", "end"));
    expect(Object.values(after.entities).some((e) => e.kind === KINDS.align)).toBe(false);
    const r = resolve(after);
    for (const id of ["r", "c", "l"]) expect(b(r, id).maxY).toBeCloseTo(250);
    expect(b(r, "panel")).toEqual(b(resolve(s), "panel"));
    expect(b(r, "r").minX).toBe(10);   // only the one axis moves
  });

  it("alignOnce centres a circle in a panel when used on both axes", () => {
    let s = base();
    s = apply(s, alignOnce(s, "panel", ["c"], "x", "centre"));
    s = apply(s, alignOnce(s, "panel", ["c"], "y", "centre"));
    const r = resolve(s);
    expect([cx(b(r, "c")), cy(b(r, "c"))]).toEqual([300, 150]);
  });

  it("alignOnce skips items whose position on that axis is derived, and returns undefined if nothing moves", () => {
    const s = base(linkAlign("al", "r", ["c"], "x", "start"));
    expect(alignOnce(s, "panel", ["c"], "x", "start")).toBeUndefined();
    const aligned = apply(base(), alignOnce(base(), "panel", ["r"], "x", "start"));
    expect(alignOnce(aligned, "panel", ["r"], "x", "start")).toBeUndefined();
  });

  it("spaceOnce gives the same positions as a live spacing link, without the link", () => {
    const s = doc(
      addRect("a", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("m", { x: 13, y: 40, width: 20, height: 10 }),
      addRect("n", { x: 70, y: 80, width: 5, height: 10 }),
      addRect("z", { x: 200, y: 0, width: 10, height: 10 }),
    );
    for (const mode of ["gaps", "centres"] as const) {
      const once = resolve(apply(s, spaceOnce(s, ["n", "z", "a", "m"], "x", mode)));
      const { anchorA, anchorB, items } = outerAnchors(resolve(s), ["n", "z", "a", "m"], "x");
      expect([anchorA, anchorB, items]).toEqual(["a", "z", ["m", "n"]]);
      const live = resolve(apply(s, linkSpacing("sp", anchorA, anchorB, items, "x", mode)));
      for (const id of ["a", "m", "n", "z"]) expect(b(once, id)).toEqual(b(live, id));
      expect(once.spacings).toEqual([]);
    }
    expect(spaceOnce(s, ["a", "z"], "x", "gaps")).toBeUndefined();
  });

  it("equaliseOnce copies the reference's value, through a variable where linked", () => {
    let s = base(addRect("r2", { x: 0, y: 0, width: 5, height: 5 }), addVariable("v", 7));
    s = apply(s, linkLengths(s, [{ id: "r2", prop: "height" }], "v"));
    s = apply(s, equaliseOnce(s, "panel", ["r", "r2", "c"], "height"));
    const r = resolve(s);
    expect(r.shapes.r!.bounds.maxY - r.shapes.r!.bounds.minY).toBe(200);
    expect(r.variables.v).toBe(200);            // r2's height is linked: its variable changed
    expect(b(r, "c")).toEqual(b(resolve(base()), "c"));   // circles have no height: skipped
    expect(equaliseOnce(s, "panel", ["r"], "height")).toBeUndefined();
  });
});
