import { describe, it, expect } from "vitest";
import { addRect, resolve } from "../../src/model";
import { composePages } from "../../src/output/compose";
import { PAPERS } from "../../src/output/paper";
import { PAGE_MARGIN, TITLE_BLOCK } from "../../src/output/style";
import type { PrintOptions, TextPrim, TitleInfo } from "../../src/output/types";
import { doc } from "../helpers";

const A4 = PAPERS.find((p) => p.name === "A4")!;
const INFO: TitleInfo = { title: "Bench", author: "PRC", revision: "C", notes: "" };
const opts: PrintOptions = { paper: A4, orientation: "portrait", scale: 1, dimensions: false };

describe("print watermark", () => {
  it("puts a small \"Delinya\" just below the title block, right-aligned with it, on every page", () => {
    // Big enough to tile onto several sheets.
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 500, height: 300 })));
    const { pages } = composePages(r, opts, INFO)!;
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const right = page.width - PAGE_MARGIN, bottom = page.height - PAGE_MARGIN;
      const marks = page.furniture.filter((p): p is TextPrim => p.kind === "text" && p.text === "Delinya");
      expect(marks).toHaveLength(1);
      const m = marks[0]!;
      expect(m.anchor).toBe("end");
      expect(m.at[0]).toBeCloseTo(right);
      expect(right - TITLE_BLOCK.width).toBeLessThan(m.at[0]);
      // Below the block, with its cap height clear of the block's bottom rule...
      expect(m.at[1] - 0.75 * m.size).toBeGreaterThan(bottom);
      // ...but well inside the sheet, where printers still reach.
      expect(m.at[1]).toBeLessThan(page.height - PAGE_MARGIN / 2);
      expect(m.size).toBeLessThanOrEqual(2.5);
    }
  });
});
