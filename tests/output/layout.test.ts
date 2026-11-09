import { describe, it, expect } from "vitest";
import type { Bounds } from "../../src/model";
import { PAPERS, SCALES, formatScale } from "../../src/output/paper";
import { fitScale, planPages } from "../../src/output/layout";
import { FOOTER_HEIGHT, PAGE_MARGIN } from "../../src/output/style";
import type { PagePlan } from "../../src/output/types";

const A4 = PAPERS.find((p) => p.name === "A4")!;
const box = (w: number, h: number, x = 0, y = 0): Bounds => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });

function expectCovers(plan: PagePlan, b: Bounds) {
  expect(plan.tiles.length).toBe(plan.rows * plan.cols);
  for (const t of plan.tiles) {
    // Every window fills the drawing area exactly at this scale.
    expect((t.window.maxX - t.window.minX) * plan.scale).toBeCloseTo(plan.area.width);
    expect((t.window.maxY - t.window.minY) * plan.scale).toBeCloseTo(plan.area.height);
  }
  expect(Math.min(...plan.tiles.map((t) => t.window.minX))).toBeLessThanOrEqual(b.minX + 1e-9);
  expect(Math.min(...plan.tiles.map((t) => t.window.minY))).toBeLessThanOrEqual(b.minY + 1e-9);
  expect(Math.max(...plan.tiles.map((t) => t.window.maxX))).toBeGreaterThanOrEqual(b.maxX - 1e-9);
  expect(Math.max(...plan.tiles.map((t) => t.window.maxY))).toBeGreaterThanOrEqual(b.maxY - 1e-9);
}

describe("paper and scales", () => {
  it("lists portrait sizes in mm", () => {
    expect(A4).toEqual({ name: "A4", width: 210, height: 297 });
    expect(PAPERS.find((p) => p.name === "A3")).toEqual({ name: "A3", width: 297, height: 420 });
    expect(PAPERS.find((p) => p.name === "Letter")).toEqual({ name: "Letter", width: 215.9, height: 279.4 });
    for (const p of PAPERS) expect(p.width).toBeLessThan(p.height);
  });

  it("offers standard scales, largest first", () => {
    expect(SCALES).toEqual([2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]);
  });

  it("formats scales as ratios", () => {
    expect(formatScale(1)).toBe("1:1");
    expect(formatScale(0.5)).toBe("1:2");
    expect(formatScale(0.2)).toBe("1:5");
    expect(formatScale(0.1)).toBe("1:10");
    expect(formatScale(0.05)).toBe("1:20");
    expect(formatScale(0.01)).toBe("1:100");
    expect(formatScale(2)).toBe("2:1");
  });
});

describe("planPages", () => {
  it("leaves the margins and the footer band out of the drawing area", () => {
    const portrait = planPages(box(10, 10), { paper: A4, orientation: "portrait", scale: 1 });
    expect(portrait).toMatchObject({ width: 210, height: 297, orientation: "portrait" });
    expect(portrait.area).toEqual({ x: PAGE_MARGIN, y: PAGE_MARGIN, width: 190, height: 297 - 2 * PAGE_MARGIN - FOOTER_HEIGHT });
    const landscape = planPages(box(10, 10), { paper: A4, orientation: "landscape", scale: 1 });
    expect(landscape).toMatchObject({ width: 297, height: 210, orientation: "landscape" });
    expect(landscape.area).toEqual({ x: PAGE_MARGIN, y: PAGE_MARGIN, width: 277, height: 210 - 2 * PAGE_MARGIN - FOOTER_HEIGHT });
  });

  it("centres a drawing that fits on one page", () => {
    const plan = planPages(box(100, 50), { paper: A4, orientation: "portrait", scale: 1 });
    expect([plan.rows, plan.cols, plan.tiles.length]).toEqual([1, 1, 1]);
    const t = plan.tiles[0]!;
    expect(t.label).toBe("A1");
    expect(t.window.minX).toBeCloseTo(50 - 95);
    expect(t.window.maxX).toBeCloseTo(50 + 95);
    expect(t.window.minY).toBeCloseTo(25 - 123.5);
    expect(t.window.maxY).toBeCloseTo(25 + 123.5);
  });

  it("tiles a drawing too big for one page, with overlapping windows", () => {
    const b = box(400, 100);
    const plan = planPages(b, { paper: A4, orientation: "portrait", scale: 1 });
    expect([plan.rows, plan.cols]).toEqual([1, 3]);
    expect(plan.tiles.map((t) => t.label)).toEqual(["A1", "A2", "A3"]);
    expect(plan.tiles.map((t) => t.window.minX)).toEqual([0, 180, 360].map((v) => expect.closeTo(v)));
    // A single row is centred across the page height.
    expect(plan.tiles[0]!.window.minY).toBeCloseTo(50 - 123.5);
    expectCovers(plan, b);
  });

  it("tiles in both directions, row-major", () => {
    const b = box(400, 600);
    const plan = planPages(b, { paper: A4, orientation: "portrait", scale: 1 });
    expect([plan.rows, plan.cols]).toEqual([3, 3]);
    expect(plan.tiles[3]).toMatchObject({ row: 1, col: 0, label: "B1" });
    expect(plan.tiles[3]!.window.minY).toBeCloseTo(237);
    expect(plan.tiles[8]!.label).toBe("C3");
    expectCovers(plan, b);
  });

  it("scales the drawing onto the paper", () => {
    const b = box(400, 100);
    expect(planPages(b, { paper: A4, orientation: "portrait", scale: 0.5 }).tiles.length).toBe(2);
    expect(planPages(b, { paper: A4, orientation: "landscape", scale: 0.5 }).tiles.length).toBe(1);
    expect(planPages(b, { paper: A4, orientation: "portrait", scale: 0.1 }).tiles.length).toBe(1);
    const enlarged = planPages(box(50, 20), { paper: A4, orientation: "portrait", scale: 2 });
    expectCovers(enlarged, box(50, 20));
  });

  it("auto picks the orientation needing fewer pages, portrait on a tie", () => {
    const wide = planPages(box(400, 100), { paper: A4, orientation: "auto", scale: 1 });
    expect(wide.orientation).toBe("landscape");
    expect(wide.tiles.length).toBe(2);
    expect(planPages(box(100, 50), { paper: A4, orientation: "auto", scale: 1 }).orientation).toBe("portrait");
  });

  it("covers awkward bounds at awkward scales", () => {
    for (const [b, scale] of [[box(1234, 567, -300, 80), 1], [box(3000, 2000, 10, 10), 0.2], [box(190.0001, 247, 0, 0), 1]] as const) {
      for (const orientation of ["portrait", "landscape"] as const) {
        expectCovers(planPages(b, { paper: A4, orientation, scale }), b);
      }
    }
  });
});

describe("fitScale", () => {
  it("picks the largest standard scale that fits one page", () => {
    expect(fitScale(box(400, 100), A4, "auto")).toBe(0.5);
    expect(fitScale(box(400, 100), A4, "portrait")).toBe(0.2);
    expect(fitScale(box(50, 50), A4, "auto")).toBe(2);
    expect(fitScale(box(190, 247), A4, "portrait")).toBe(1);
  });

  it("falls back to the smallest scale when nothing fits", () => {
    expect(fitScale(box(100000, 100000), A4, "auto")).toBe(SCALES[SCALES.length - 1]);
  });
});
