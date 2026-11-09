import { describe, it, expect } from "vitest";
import { addCircle, addDimension, addRect, resolve } from "../../src/model";
import { exportSvg, pageToSvg } from "../../src/output/svg";
import { STYLE, SVG_PADDING } from "../../src/output/style";
import type { PageDrawing } from "../../src/output/types";
import { pathToSvg } from "../../src/view/svgPath";
import { doc } from "../helpers";

const sample = () => resolve(doc(
  addRect("a", { x: 0, y: 0, width: 100, height: 50, r: [5, 5, 5, 5] }),
  addCircle("c", { cx: 150, cy: 25, diameter: 20 }),
  addDimension("dw", "a", "width"),
));

function attr(svg: string, name: string): string {
  const m = svg.match(new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`));
  if (!m) throw new Error(`no ${name}`);
  return m[1]!;
}

describe("exportSvg", () => {
  it("returns null with nothing to export", () => {
    expect(exportSvg(resolve(doc()), { dimensions: true })).toBeNull();
  });

  it("is one SVG at true size in mm, model units in the viewBox", () => {
    const svg = exportSvg(sample(), { dimensions: true })!;
    expect(svg.match(/<svg[\s>]/g)?.length).toBe(1);
    expect(svg.match(/<\/svg>/g)?.length).toBe(1);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    const [x, y, w, h] = attr(svg, "viewBox").split(/\s+/).map(Number) as [number, number, number, number];
    expect(attr(svg, "width")).toBe(`${w}mm`);
    expect(attr(svg, "height")).toBe(`${h}mm`);
    expect(x).toBeLessThanOrEqual(-SVG_PADDING);
    expect(y).toBeLessThanOrEqual(-10 - SVG_PADDING);    // the width dimension sits 10 mm above
    expect(x + w).toBeGreaterThanOrEqual(160 + SVG_PADDING);
    expect(y + h).toBeGreaterThanOrEqual(50 + SVG_PADDING);
  });

  it("has each shape's path exactly", () => {
    const r = sample();
    const svg = exportSvg(r, { dimensions: false })!;
    for (const id of r.order) expect(svg).toContain(`d="${pathToSvg(r.shapes[id]!.path)}"`);
  });

  it("draws dimensions in the dimension colour and shapes in black", () => {
    const r = sample();
    const svg = exportSvg(r, { dimensions: true })!;
    const blue = STYLE.colour.dimension;
    expect(svg).toMatch(new RegExp(`<text[^>]*fill="${blue}"[^>]*>100</text>`));
    expect(svg).toMatch(new RegExp(`<path[^>]*stroke="${blue}"`));
    for (const id of r.order) {
      const tag = svg.match(new RegExp(`<path d="${pathToSvg(r.shapes[id]!.path)}"[^>]*>`))![0];
      expect(tag).not.toContain(blue);
    }
  });

  it("includes dimension text only when asked", () => {
    expect(exportSvg(sample(), { dimensions: true })).toMatch(/<text[^>]*>100<\/text>/);
    expect(exportSvg(sample(), { dimensions: false })).not.toContain("<text");
  });
});

describe("pageToSvg", () => {
  const page: PageDrawing = {
    width: 210, height: 297,
    clip: { x: 10, y: 10, width: 190, height: 247 },
    content: [{ kind: "path", role: "shape", path: [{ kind: "segment", from: [20, 20], to: [120, 20] }] }],
    furniture: [
      { kind: "text", role: "furniture", at: [20, 280], text: "A&B <1>", angle: 0, size: 2.5, anchor: "start" },
      { kind: "path", role: "guide", path: [{ kind: "segment", from: [190, 10], to: [190, 257] }] },
    ],
  };

  it("is a page-sized SVG in mm with the content clipped", () => {
    const svg = pageToSvg(page);
    expect(attr(svg, "width")).toBe("210mm");
    expect(attr(svg, "height")).toBe("297mm");
    expect(attr(svg, "viewBox")).toBe("0 0 210 297");
    expect(svg).toMatch(/<clipPath[^>]*>\s*<rect[^>]*x="10"[^>]*y="10"[^>]*width="190"[^>]*height="247"/);
    expect(svg).toContain('d="M20 20L120 20"');
  });

  it("colours dimension paths and text but not shapes or furniture", () => {
    const blue = STYLE.colour.dimension;
    const svg = pageToSvg({
      ...page,
      content: [
        ...page.content,
        { kind: "path", role: "dimension", path: [{ kind: "segment", from: [20, 10], to: [120, 10] }] },
        { kind: "text", role: "dimension", at: [70, 9], text: "100", angle: 0, size: 3, anchor: "middle" },
      ],
    });
    expect(svg).toMatch(new RegExp(`<path d="M20 10L120 10"[^>]*stroke="${blue}"`));
    expect(svg).toMatch(new RegExp(`<text[^>]*fill="${blue}"[^>]*>100</text>`));
    expect(svg.match(/<path d="M20 20L120 20"[^>]*>/)![0]).not.toContain(blue);
    expect(svg.match(/<text[^>]*>A&amp;B &lt;1&gt;<\/text>/)![0]).not.toContain(blue);
  });

  it("escapes text and dashes guides", () => {
    const svg = pageToSvg(page);
    expect(svg).toContain("A&amp;B &lt;1&gt;");
    expect(svg).toMatch(/stroke-dasharray="2[ ,]1\.5"/);
  });
});
