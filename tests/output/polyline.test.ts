import { describe, it, expect } from "vitest";
import { addPolyline, resolve, type PolyNode } from "../../src/model";
import { composePages } from "../../src/output/compose";
import { exportDxf } from "../../src/output/dxf";
import { PAPERS } from "../../src/output/paper";
import { exportPdf } from "../../src/output/pdf";
import { exportSvg } from "../../src/output/svg";
import type { PrintOptions } from "../../src/output/types";
import { doc } from "../helpers";

const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const curve = (x: number, y: number): PolyNode => ({ x, y, type: "curve" });

const triangle = resolve(doc(addPolyline("t", { nodes: [cusp(0, 0), cusp(40, 0), cusp(20, 30)], closed: true })));
const wave = resolve(doc(addPolyline("w", { nodes: [cusp(0, 0), curve(20, 20), curve(40, 0), cusp(60, 20)] })));

const A4 = PAPERS.find((p) => p.name === "A4")!;
const opts: PrintOptions = { paper: A4, orientation: "portrait", scale: 1, dimensions: false };
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/** DXF group/value pairs. */
function pairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split(/\r?\n/).map((l) => l.trim());
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!]);
  return out;
}

describe("paths in output", () => {
  it("SVG draws curves as cubic Béziers and straight runs as lines", () => {
    expect(exportSvg(wave, { dimensions: false })).toMatch(/d="M[^"]*C[^"]*"/);
    const tri = exportSvg(triangle, { dimensions: false })!;
    expect(tri).toMatch(/d="M[^"]*L[^"]*"/);
    expect(tri).not.toMatch(/d="M[^"]*C/);
  });

  it("prints, mapping the curves onto the page", () => {
    const composed = composePages(wave, opts, { title: "", author: "", revision: "", notes: "" })!;
    const cubics = composed.pages[0]!.content.flatMap((p) => (p.kind === "path" ? p.path : [])).filter((e) => e.kind === "cubic");
    expect(cubics).toHaveLength(3);
    // PDF curves are its own cubic operator.
    const pdf = latin1(exportPdf(composed.pages, { title: "", author: "" }));
    expect((pdf.match(/ c\n/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("DXF writes a closed straight path as one closed POLYLINE", () => {
    const p = pairs(exportDxf(triangle)!);
    const start = p.findIndex(([c, v]) => c === 0 && v === "POLYLINE");
    expect(start).toBeGreaterThan(-1);
    const flags = p.slice(start).find(([c]) => c === 70)!;
    expect(flags[1]).toBe("1");
    const end = p.findIndex(([c, v], i) => i > start && c === 0 && v === "SEQEND");
    expect(p.slice(start, end).filter(([c, v]) => c === 0 && v === "VERTEX")).toHaveLength(3);
  });

  it("DXF flattens curves into many vertices along the curve", () => {
    const p = pairs(exportDxf(wave)!);
    const vertices = p.flatMap(([c, v], i) => (c === 0 && v === "VERTEX" ? [i] : []));
    expect(vertices.length).toBeGreaterThan(10);
    // Every vertex lies within the path's bounds (y flipped in DXF).
    const b = wave.shapes.w!.bounds;
    for (const i of vertices) {
      const x = Number(p.slice(i).find(([c]) => c === 10)![1]);
      const y = -Number(p.slice(i).find(([c]) => c === 20)![1]);
      expect(x).toBeGreaterThanOrEqual(b.minX - 1e-6);
      expect(x).toBeLessThanOrEqual(b.maxX + 1e-6);
      expect(y).toBeGreaterThanOrEqual(b.minY - 1e-6);
      expect(y).toBeLessThanOrEqual(b.maxY + 1e-6);
    }
  });
});
