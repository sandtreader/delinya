import { describe, it, expect } from "vitest";
import {
  addCircle, addDimension, addLine, addRadiusLabel, addRect, addSpacing, addVariable,
  clampRadii, resolve,
} from "../src/model";
import type { ResolvedRect, ResolvedCircle, ResolvedLine } from "../src/model";
import { doc } from "./helpers";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe("resolve shapes", () => {
  it("builds a sharp rectangle: four segments, corner and midpoint snaps", () => {
    const r = resolve(doc(addRect("r", { x: 10, y: 20, width: 100, height: 50 }))).shapes.r as ResolvedRect;
    expect(r.kind).toBe("rect");
    expect(r.path).toHaveLength(4);
    expect(r.path.every((e) => e.kind === "segment")).toBe(true);
    expect(r.corners).toEqual([[10, 20], [110, 20], [110, 70], [10, 70]]);
    expect(r.bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    expect(r.snaps.filter((s) => s.type === "corner")).toHaveLength(4);
    expect(r.snaps.filter((s) => s.type === "midpoint").map((s) => s.point)).toContainEqual([60, 20]);
    expect(r.snaps.find((s) => s.type === "centre")?.point).toEqual([60, 45]);
  });

  it("rounds corners into arcs with tangent snaps", () => {
    const r = resolve(doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, r: [10, 0, 0, 0] }))).shapes.r as ResolvedRect;
    expect(r.path).toHaveLength(5);
    const a = r.arcs[0]!;
    expect(a.centre).toEqual([10, 10]);
    expect(a.radius).toBe(10);
    expect([a.start, a.end]).toEqual([180, 270]);
    const tangents = r.snaps.filter((s) => s.type === "tangent").map((s) => s.point);
    expect(tangents.some(([x, y]) => near(x, 0) && near(y, 10))).toBe(true);   // left edge meets arc
    expect(tangents.some(([x, y]) => near(x, 10) && near(y, 0))).toBe(true);   // top edge meets arc
    expect(r.snaps.filter((s) => s.type === "corner")).toHaveLength(3);
    // The first path element is the top edge, starting after the arc.
    expect(r.path[0]).toEqual({ kind: "segment", from: [10, 0], to: [100, 0] });
  });

  it("clamps oversize radii by one factor and reports it", () => {
    expect(clampRadii([40, 40, 0, 0], 100, 100)).toEqual([40, 40, 0, 0]);
    expect(clampRadii([60, 60, 0, 0], 100, 100)).toEqual([50, 50, 0, 0]);
    expect(clampRadii([30, 30, 30, 30], 100, 40)).toEqual([20, 20, 20, 20]);
    const res = resolve(doc(addRect("r", { x: 0, y: 0, width: 20, height: 100, r: [30, 30, 30, 30] })));
    expect((res.shapes.r as ResolvedRect).r).toEqual([10, 10, 10, 10]);
    expect(res.issues).toEqual([expect.objectContaining({ entity: "r", code: "radius-clamped" })]);
  });

  it("builds a circle as one full arc with centre and quadrant snaps", () => {
    const c = resolve(doc(addCircle("c", { cx: 50, cy: 50, diameter: 20 }))).shapes.c as ResolvedCircle;
    expect(c.radius).toBe(10);
    expect(c.path).toEqual([{ kind: "arc", centre: [50, 50], radius: 10, start: 0, end: 360 }]);
    expect(c.bounds).toEqual({ minX: 40, minY: 40, maxX: 60, maxY: 60 });
    expect(c.snaps.map((s) => s.type)).toEqual(["centre", "quadrant", "quadrant", "quadrant", "quadrant"]);
  });

  it("builds a line from origin, length and angle", () => {
    const l = resolve(doc(addLine("l", { x: 0, y: 0, length: 100, angle: 90 }))).shapes.l as ResolvedLine;
    expect(l.from).toEqual([0, 0]);
    expect(l.to).toEqual([0, 100]);
    expect(l.snaps.find((s) => s.type === "midpoint")?.point).toEqual([0, 50]);
  });

  it("keeps shapes in document order and ignores non-shape entities", () => {
    const res = resolve(doc(addVariable("v", 5), addRect("b", { x: 0, y: 0, width: 1, height: 1 }), addCircle("a", { cx: 0, cy: 0, diameter: 1 })));
    expect(res.order).toEqual(["b", "a"]);
    expect(Object.keys(res.shapes)).toEqual(["b", "a"]);
  });
});

describe("resolve variables and references", () => {
  it("dereferences linked lengths from a shared variable", () => {
    const res = resolve(doc(
      addVariable("w", 300, "shelf width"),
      addRect("a", { x: 0, y: 0, width: { ref: "w" }, height: 18 }),
      addRect("b", { x: 0, y: 100, width: { ref: "w" }, height: 18 }),
      addCircle("c", { cx: 0, cy: 0, diameter: { ref: "w" } }),
      addRect("d", { x: 0, y: 0, width: 10, height: 10, r: [{ ref: "w" }, 0, 0, 0] }),
    ));
    expect(res.variables).toEqual({ w: 300 });
    expect((res.shapes.a as ResolvedRect).width).toBe(300);
    expect((res.shapes.b as ResolvedRect).width).toBe(300);
    expect((res.shapes.c as ResolvedCircle).diameter).toBe(300);
    expect((res.shapes.d as ResolvedRect).r[0]).toBe(10);  // a lone corner may use the whole side
  });

  it("treats a dangling reference as zero with an issue, never throwing", () => {
    const res = resolve(doc(addRect("a", { x: 0, y: 0, width: { ref: "gone" }, height: 18 })));
    expect((res.shapes.a as ResolvedRect).width).toBe(0);
    expect(res.issues).toEqual([expect.objectContaining({ entity: "a", code: "dangling-ref" })]);
  });

  it("flags non-numeric values rather than producing NaN", () => {
    const res = resolve(doc({ type: "entity_added", id: "a", kind: "rect", props: { x: "1", y: 0, width: 10, height: 10 } }));
    expect((res.shapes.a as ResolvedRect).x).toBe(0);
    expect(res.issues[0]).toMatchObject({ entity: "a", code: "bad-value" });
    const b = (res.shapes.a as ResolvedRect).bounds;
    expect([b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)).toBe(true);
  });
});

describe("resolve spacing links", () => {
  // Two 18mm uprights 500 apart, inner faces at 18 and 518: clear span 500.
  const uprights = [
    addRect("L", { x: 0, y: 0, width: 18, height: 300 }),
    addRect("R", { x: 518, y: 0, width: 18, height: 300 }),
  ];

  it("spaces items by equal gaps between the anchors' inner faces", () => {
    const res = resolve(doc(
      ...uprights,
      addRect("s1", { x: 999, y: 100, width: 100, height: 18 }),
      addRect("s2", { x: 999, y: 200, width: 100, height: 18 }),
      addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["s1", "s2"], axis: "x", mode: "gaps" }),
    ));
    // gap = (500 - 200) / 3 = 100
    const sp = res.spacings[0]!;
    expect(sp.active).toBe(true);
    expect(sp.step).toBe(100);
    expect(sp.positions).toEqual({ s1: 118, s2: 318 });
    expect((res.shapes.s1 as ResolvedRect).x).toBe(118);
    expect((res.shapes.s1 as ResolvedRect).y).toBe(100);      // cross-axis stays authored
    expect((res.shapes.s2 as ResolvedRect).bounds.minX).toBe(318);
    expect(res.issues).toEqual([]);
  });

  it("spaces by centres for hole rows", () => {
    const res = resolve(doc(
      ...uprights,
      addCircle("h1", { cx: 0, cy: 50, diameter: 5 }),
      addCircle("h2", { cx: 0, cy: 50, diameter: 5 }),
      addCircle("h3", { cx: 0, cy: 50, diameter: 5 }),
      addSpacing("sp", { anchorA: "R", anchorB: "L", items: ["h1", "h2", "h3"], axis: "x", mode: "centres" }),
    ));
    // pitch = 500 / 4 = 125; centres at 143, 268, 393 regardless of anchor order
    expect(res.spacings[0]!.step).toBe(125);
    expect((res.shapes.h1 as ResolvedCircle).centre).toEqual([143, 50]);
    expect((res.shapes.h2 as ResolvedCircle).centre).toEqual([268, 50]);
    expect((res.shapes.h3 as ResolvedCircle).centre).toEqual([393, 50]);
  });

  it("works along y as well", () => {
    const res = resolve(doc(
      addRect("top", { x: 0, y: 0, width: 300, height: 18 }),
      addRect("bot", { x: 0, y: 418, width: 300, height: 18 }),
      addRect("shelf", { x: 0, y: 0, width: 300, height: 18 }),
      addSpacing("sp", { anchorA: "top", anchorB: "bot", items: ["shelf"], axis: "y", mode: "gaps" }),
    ));
    // span 400, gap = (400 - 18) / 2 = 191 → shelf y = 18 + 191
    expect((res.shapes.shelf as ResolvedRect).y).toBe(209);
  });

  it("goes inactive, not wrong, when an anchor is missing", () => {
    const res = resolve(doc(
      uprights[0]!,
      addRect("s1", { x: 7, y: 0, width: 100, height: 18 }),
      addSpacing("sp", { anchorA: "L", anchorB: "nope", items: ["s1"], axis: "x", mode: "gaps" }),
    ));
    expect(res.spacings[0]!.active).toBe(false);
    expect((res.shapes.s1 as ResolvedRect).x).toBe(7);
    expect(res.issues).toContainEqual(expect.objectContaining({ entity: "sp", code: "spacing-inactive" }));
  });

  it("skips missing items and reports overflow", () => {
    const res = resolve(doc(
      ...uprights,
      addRect("big", { x: 0, y: 0, width: 600, height: 18 }),
      addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["big", "ghost"], axis: "x", mode: "gaps" }),
    ));
    expect(res.spacings[0]!.active).toBe(true);
    expect(res.spacings[0]!.step).toBe(-50);
    expect(res.issues.map((i) => i.code).sort()).toEqual(["dangling-target", "spacing-overflow"]);
  });
});

describe("resolve dimensions and labels", () => {
  it("measures rect width and height with an offset line", () => {
    const res = resolve(doc(
      addRect("r", { x: 10, y: 10, width: 100, height: 50 }),
      addDimension("dw", "r", "width", 8),
      addDimension("dh", "r", "height", 8),
    ));
    const [dw, dh] = res.dimensions;
    expect(dw).toMatchObject({ value: 100, anchors: [[10, 10], [110, 10]] });
    expect(dw!.line).toEqual({ kind: "segment", from: [10, 2], to: [110, 2] });
    expect(dh).toMatchObject({ value: 50, anchors: [[10, 10], [10, 60]] });
    expect(dh!.line).toEqual({ kind: "segment", from: [2, 10], to: [2, 60] });
  });

  it("follows the variable when the measured prop is linked", () => {
    const res = resolve(doc(
      addVariable("v", 42),
      addCircle("c", { cx: 0, cy: 0, diameter: { ref: "v" } }),
      addDimension("d", "c", "diameter", 5),
    ));
    expect(res.dimensions[0]!.value).toBe(42);
  });

  it("measures a line perpendicular to itself", () => {
    const res = resolve(doc(addLine("l", { x: 0, y: 0, length: 10, angle: 0 }), addDimension("d", "l", "length", 3)));
    expect(res.dimensions[0]!.line).toEqual({ kind: "segment", from: [0, -3], to: [10, -3] });
  });

  it("drops a dimension whose target is gone or has no such prop", () => {
    const res = resolve(doc(
      addCircle("c", { cx: 0, cy: 0, diameter: 1 }),
      addDimension("d1", "c", "width", 5),
      addDimension("d2", "missing", "width", 5),
    ));
    expect(res.dimensions).toEqual([]);
    expect(res.issues.map((i) => i.code).sort()).toEqual(["bad-value", "dangling-target"]);
  });

  it("places a radius label at the arc midpoint", () => {
    const res = resolve(doc(
      addRect("r", { x: 0, y: 0, width: 100, height: 100, r: [0, 10, 0, 0] }),
      addRadiusLabel("lab", "r", 1),
      addRadiusLabel("sharp", "r", 2),
    ));
    const [lab, sharp] = res.radiusLabels;
    expect(lab!.radius).toBe(10);
    const [x, y] = lab!.at;   // arc centre (90,10), angle 315
    expect(near(x, 90 + 10 * Math.SQRT1_2)).toBe(true);
    expect(near(y, 10 - 10 * Math.SQRT1_2)).toBe(true);
    expect(sharp).toMatchObject({ radius: 0, at: [100, 100] });
  });
});
