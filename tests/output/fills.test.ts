import { describe, it, expect } from "vitest";
import { applyChange, type DocState } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, FILL_OPACITY, addRect, resolve, setLayerFill, setLayerHatch } from "../../src/model";
import { exportDxf } from "../../src/output/dxf";
import { exportPdf } from "../../src/output/pdf";
import { exportSvg, pageToSvg } from "../../src/output/svg";
import type { PageDrawing } from "../../src/output/types";
import { doc } from "../helpers";

// Fills in each output: see-through colour and clipped patterns in SVG and
// PDF; nothing at all in DXF.

const PINK = "#ffaaaa";
const rectPath = [
  { kind: "segment" as const, from: [20, 20] as [number, number], to: [60, 20] as [number, number] },
  { kind: "segment" as const, from: [60, 20] as [number, number], to: [60, 40] as [number, number] },
  { kind: "segment" as const, from: [60, 40] as [number, number], to: [20, 40] as [number, number] },
  { kind: "segment" as const, from: [20, 40] as [number, number], to: [20, 20] as [number, number] },
];

function page(fill: { fill?: string; hatch?: "lines" | "dots" }): PageDrawing {
  return {
    width: 210, height: 297, clip: { x: 10, y: 10, width: 190, height: 247 },
    content: [
      ...(fill.fill || fill.hatch ? [{ kind: "fill" as const, path: rectPath, ...fill }] : []),
      { kind: "path", role: "shape", path: rectPath },
    ],
    furniture: [],
  };
}

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const pdfOf = (p: PageDrawing) => latin1(exportPdf([p], { title: "t", author: "a" }));

function filled(fill: string | null, hatch: "lines" | null): DocState {
  let s = doc(addRect("r", { x: 0, y: 0, width: 40, height: 20 }));
  const c1 = setLayerFill(s, BASE_LAYER_ID, fill);
  if (c1) s = applyChange(s, c1);
  const c2 = setLayerHatch(s, BASE_LAYER_ID, hatch);
  if (c2) s = applyChange(s, c2);
  return s;
}

describe("fills in SVG", () => {
  it("fills with the colour, see-through, under the outline", () => {
    const svg = pageToSvg(page({ fill: PINK }));
    const fillAt = svg.indexOf(`fill="${PINK}"`);
    expect(fillAt).toBeGreaterThan(-1);
    expect(svg).toContain(`fill-opacity="${FILL_OPACITY}"`);
    expect(fillAt).toBeLessThan(svg.indexOf("stroke-width"));
  });

  it("draws a pattern clipped to the shape", () => {
    expect(pageToSvg(page({ hatch: "lines" }))).toMatch(/<pattern|<clipPath[^>]*>\s*<path/);
  });

  it("carries fills into the true-size export", () => {
    const svg = exportSvg(resolve(filled(PINK, "lines")), { dimensions: false })!;
    expect(svg).toContain(`fill="${PINK}"`);
    expect(svg).toMatch(/<pattern|<clipPath/);
  });

  it("is unchanged for a drawing with no fills", () => {
    expect(exportSvg(resolve(filled(null, null)), { dimensions: false })).not.toMatch(/fill-opacity|<pattern|<clipPath/);
  });
});

describe("fills in PDF", () => {
  it("fills see-through through a graphics state, then strokes the outline", () => {
    const pdf = pdfOf(page({ fill: PINK }));
    expect(pdf).toMatch(new RegExp(`/ca ${FILL_OPACITY}\\b`));
    expect(pdf).toMatch(/\/ExtGState/);
    expect(pdf).toMatch(/\/\w+ gs/);
    // A fill operator, on its own line, before the outline's stroke.
    const fillAt = pdf.search(/\nf\*?\n/);
    expect(fillAt).toBeGreaterThan(-1);
    expect(fillAt).toBeLessThan(pdf.indexOf("\nS\n"));
  });

  it("clips a pattern's marks to the shape", () => {
    // The page's own drawing-area clip is one; the pattern adds its own.
    const clips = (pdf: string) => (pdf.match(/\bW\*?\s+n\b/g) ?? []).length;
    expect(clips(pdfOf(page({ hatch: "lines" })))).toBeGreaterThan(clips(pdfOf(page({}))));
  });

  it("needs no graphics states without fills", () => {
    expect(pdfOf(page({}))).not.toMatch(/ExtGState/);
  });
});

describe("fills in DXF", () => {
  it("leaves them out: they are indicative, not for plotting", () => {
    expect(exportDxf(resolve(filled(PINK, "lines")))).toBe(exportDxf(resolve(filled(null, null))));
  });
});
