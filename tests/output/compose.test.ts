import { describe, it, expect } from "vitest";
import { type Segment, addDimension, addRect, pathBounds, resolve } from "../../src/model";
import { composePages, titleInfo } from "../../src/output/compose";
import { PAPERS } from "../../src/output/paper";
import { FOOTER_HEIGHT, PAGE_MARGIN, RULER_LENGTH, STYLE, TITLE_BLOCK } from "../../src/output/style";
import { textWidth } from "../../src/output/text";
import type { PageDrawing, PathPrim, PrintOptions, TextPrim, TitleInfo } from "../../src/output/types";
import { doc } from "../helpers";

const A4 = PAPERS.find((p) => p.name === "A4")!;
const INFO: TitleInfo = { title: "Bench", author: "PRC", revision: "C", notes: "Glue up after dry fit" };
const opts = (o: Partial<PrintOptions> = {}): PrintOptions => ({ paper: A4, orientation: "portrait", scale: 1, dimensions: false, ...o });

const rect = (w: number, h: number) => resolve(doc(addRect("a", { x: 0, y: 0, width: w, height: h })));
const withDims = (w: number, h: number) => resolve(doc(
  addRect("a", { x: 0, y: 0, width: w, height: h }), addDimension("dw", "a", "width"), addDimension("dh", "a", "height"),
));

const pathsOf = (ps: PageDrawing["content"], role: string) => ps.filter((p): p is PathPrim => p.kind === "path" && p.role === role);
const textsOf = (ps: PageDrawing["content"]) => ps.filter((p): p is TextPrim => p.kind === "text");

function blockRect(page: PageDrawing) {
  const right = page.width - PAGE_MARGIN, bottom = page.height - PAGE_MARGIN;
  return { minX: right - TITLE_BLOCK.width, minY: bottom - TITLE_BLOCK.height, maxX: right, maxY: bottom };
}

/** Texts whose anchor lies in the title block. */
function blockTexts(page: PageDrawing) {
  const b = blockRect(page);
  return textsOf(page.furniture).filter((t) => t.at[0] >= b.minX - 1e-9 && t.at[0] <= b.maxX + 1e-9 && t.at[1] >= b.minY - 1e-9 && t.at[1] <= b.maxY + 1e-9);
}

function horizontalExtent(t: TextPrim): [number, number] {
  const w = textWidth(t.text, t.size);
  const x0 = t.anchor === "start" ? t.at[0] : t.anchor === "middle" ? t.at[0] - w / 2 : t.at[0] - w;
  return [x0, x0 + w];
}

describe("composePages", () => {
  it("returns null when there is nothing to print", () => {
    expect(composePages(resolve(doc()), opts({ dimensions: true }), INFO)).toBeNull();
  });

  it("makes one page per tile, with the drawing area as the clip", () => {
    const out = composePages(rect(100, 50), opts(), INFO)!;
    expect(out.plan.tiles.length).toBe(1);
    expect(out.pages.length).toBe(1);
    const page = out.pages[0]!;
    expect([page.width, page.height]).toEqual([210, 297]);
    expect(page.clip).toEqual(out.plan.area);
    expect(page.clip).toEqual({ x: 10, y: 10, width: 190, height: 297 - 20 - FOOTER_HEIGHT });
  });

  it("places the drawing centred in the area at full size", () => {
    const page = composePages(rect(100, 50), opts(), INFO)!.pages[0]!;
    const shapes = pathsOf(page.content, "shape");
    expect(shapes.length).toBe(1);
    const b = pathBounds(shapes[0]!.path);
    const cx = 10 + 190 / 2, cy = 10 + (297 - 20 - FOOTER_HEIGHT) / 2;
    expect(b.minX).toBeCloseTo(cx - 50);
    expect(b.maxX).toBeCloseTo(cx + 50);
    expect(b.minY).toBeCloseTo(cy - 25);
    expect(b.maxY).toBeCloseTo(cy + 25);
  });

  it("scales the drawing but keeps text a fixed size on paper", () => {
    for (const scale of [1, 0.5, 0.1]) {
      const page = composePages(withDims(400, 200), opts({ scale, dimensions: true }), INFO)!.pages[0]!;
      const b = pathBounds(pathsOf(page.content, "shape")[0]!.path);
      if (scale !== 1) {
        expect(b.maxX - b.minX).toBeCloseTo(400 * scale);
        expect(b.maxY - b.minY).toBeCloseTo(200 * scale);
      }
      const dimTexts = textsOf(page.content);
      expect(dimTexts.length).toBeGreaterThan(0);
      for (const t of dimTexts) expect(t.size).toBeCloseTo(STYLE.textSize);
    }
  });

  it("puts a 100 mm check ruler in the footer band, left of the title block", () => {
    const page = composePages(rect(100, 50), opts(), INFO)!.pages[0]!;
    const areaBottom = page.clip.y + page.clip.height;
    const segs = pathsOf(page.furniture, "furniture").flatMap((p) => p.path).filter((e): e is Segment => e.kind === "segment");
    const ruler = segs.find((s) => s.from[1] === s.to[1] && Math.abs(Math.abs(s.to[0] - s.from[0]) - RULER_LENGTH) < 1e-9
      && s.from[1] > areaBottom && s.from[1] <= page.height - PAGE_MARGIN);
    expect(ruler).toBeDefined();
    expect(Math.min(ruler!.from[0], ruler!.to[0])).toBeGreaterThanOrEqual(PAGE_MARGIN - 1e-9);
    expect(Math.max(ruler!.from[0], ruler!.to[0])).toBeLessThanOrEqual(blockRect(page).minX + 1e-9);
    expect(textsOf(page.furniture).some((t) => /100 mm/.test(t.text))).toBe(true);
  });

  it("draws a title block in the bottom-right corner with the document properties, scale and sheet", () => {
    const page = composePages(rect(100, 50), opts({ scale: 0.5 }), INFO)!.pages[0]!;
    const b = blockRect(page);
    const outline = pathsOf(page.furniture, "furniture").find((p) => {
      const pb = pathBounds(p.path);
      return [pb.minX - b.minX, pb.minY - b.minY, pb.maxX - b.maxX, pb.maxY - b.maxY].every((d) => Math.abs(d) < 1e-9);
    });
    expect(outline).toBeDefined();
    const all = blockTexts(page).map((t) => t.text).join("\n");
    for (const s of ["Bench", "PRC", "C", "Glue up after dry fit", "1:2", "1 of 1"]) expect(all).toContain(s);
  });

  it("keeps every title block text inside the block, wrapping and cutting long notes", () => {
    const notes = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const page = composePages(rect(100, 50), opts(), { ...INFO, notes, title: "A rather long title for a small bench" })!.pages[0]!;
    const b = blockRect(page);
    const ts = blockTexts(page);
    expect(ts.length).toBeGreaterThan(4);
    for (const t of ts) {
      const [x0, x1] = horizontalExtent(t);
      expect(x0, t.text).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(x1, t.text).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(t.at[1] - t.size * 0.75, t.text).toBeGreaterThanOrEqual(b.minY - 1e-9);
    }
    expect(ts.some((t) => t.text.endsWith("…"))).toBe(true);
  });

  it("tiles a large drawing and marks the overlaps", () => {
    const out = composePages(rect(400, 100), opts(), INFO)!;
    expect(out.pages.length).toBe(3);
    const guideXs = out.pages.map((p) => pathsOf(p.furniture, "guide").flatMap((g) => g.path)
      .filter((e): e is Segment => e.kind === "segment" && e.from[0] === e.to[0]).map((s) => s.from[0]));
    expect(guideXs[0]).toEqual([10 + 190 - 10]);
    expect(guideXs[1]).toEqual([10 + 190 - 10]);
    expect(guideXs[2]).toEqual([]);
    const sheet2 = blockTexts(out.pages[1]!).map((t) => t.text).join("\n");
    expect(sheet2).toContain("A2");
    expect(sheet2).toContain("2 of 3");
  });

  it("honours auto orientation", () => {
    const out = composePages(rect(400, 100), opts({ orientation: "auto" }), INFO)!;
    expect(out.plan.orientation).toBe("landscape");
    expect([out.pages[0]!.width, out.pages[0]!.height]).toEqual([297, 210]);
  });
});

describe("titleInfo", () => {
  it("falls back to the file name for a blank title and trims", () => {
    expect(titleInfo({ title: "", author: "a", revision: "", notes: "" }, "bench")).toEqual({ title: "bench", author: "a", revision: "", notes: "" });
    expect(titleInfo({ title: "  Shelf ", author: "", revision: "", notes: "" }, "bench").title).toBe("Shelf");
  });
});
