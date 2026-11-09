import { describe, it, expect } from "vitest";
import { exportPdf } from "../../src/output/pdf";
import type { PageDrawing } from "../../src/output/types";

const PT = 72 / 25.4;

function page(width: number, height: number, text = "R10"): PageDrawing {
  return {
    width, height,
    clip: { x: 10, y: 10, width: width - 20, height: height - 50 },
    content: [
      { kind: "path", role: "shape", path: [{ kind: "segment", from: [20, 20], to: [120, 20] }] },
      { kind: "path", role: "shape", path: [{ kind: "arc", centre: [60, 80], radius: 20, start: 0, end: 360 }] },
      { kind: "path", role: "dimension", path: [{ kind: "arc", centre: [60, 150], radius: 10, start: 270, end: 360 }] },
      { kind: "text", role: "dimension", at: [60, 40], text, angle: 270, size: 3, anchor: "middle" },
    ],
    furniture: [
      { kind: "text", role: "furniture", at: [12, 280], text: "f(x) \\ 5°", angle: 0, size: 2.5, anchor: "start" },
      { kind: "path", role: "guide", path: [{ kind: "segment", from: [190, 10], to: [190, 257] }] },
    ],
  };
}

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("exportPdf", () => {
  const bytes = exportPdf([page(210, 297), page(297, 210, "50")], { title: "Bench (v2)", author: "PRC" });
  const pdf = latin1(bytes);

  it("is ASCII-only, with a header and trailer", () => {
    expect(bytes.every((b) => b < 128)).toBe(true);
    expect(pdf.startsWith("%PDF-1.")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("has a cross-reference table whose offsets are right", () => {
    const startxref = Number(pdf.match(/startxref\s+(\d+)\s+%%EOF\s*$/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const m = pdf.slice(startxref).match(/^xref\s+0\s+(\d+)\s+/)!;
    const count = Number(m[1]);
    const entries = pdf.slice(startxref + m[0].length).split(/\r?\n|\r/).filter(Boolean).slice(0, count);
    expect(entries[0]).toMatch(/^0000000000 65535 f\s*$/);
    for (let n = 1; n < count; n++) {
      const [off, gen, kind] = entries[n]!.trim().split(" ");
      expect(off).toMatch(/^\d{10}$/);
      expect(kind).toBe("n");
      expect(pdf.slice(Number(off)).startsWith(`${n} ${Number(gen)} obj`), `object ${n}`).toBe(true);
    }
    expect(pdf).toMatch(new RegExp(`/Size ${count}\\b`));
  });

  it("has stream lengths that match", () => {
    const re = /\/Length (\d+)[^]*?stream\r?\n/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(pdf))) {
      const start = m.index + m[0].length;
      const len = Number(m[1]);
      expect(pdf.slice(start + len).trimStart().startsWith("endstream")).toBe(true);
      n++;
    }
    expect(n).toBe(2);
  });

  it("has one page object per page, each sized in points", () => {
    expect(pdf).toMatch(/\/Count 2\b/);
    expect(pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length).toBe(2);
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(boxes.length).toBe(2);
    expect(boxes[0]![0]).toBeCloseTo(210 * PT, 1);
    expect(boxes[0]![1]).toBeCloseTo(297 * PT, 1);
    expect(boxes[1]![0]).toBeCloseTo(297 * PT, 1);
    expect(boxes[1]![1]).toBeCloseTo(210 * PT, 1);
  });

  it("uses standard Helvetica and records the title and author", () => {
    expect(pdf).toMatch(/\/BaseFont\s*\/Helvetica\b/);
    expect(pdf).toMatch(/\/Encoding\s*\/WinAnsiEncoding/);
    expect(pdf).toContain("/Title (Bench \\(v2\\))");
    expect(pdf).toContain("/Author (PRC)");
  });

  it("clips content, draws arcs as curves and dashes guides", () => {
    expect(pdf).toMatch(/re\s+W\s+n/);
    // A full circle needs at least four cubic segments; the quarter arc one more.
    expect(pdf.match(/ c\r?\n/g)!.length).toBeGreaterThanOrEqual(2 * 5);
    expect(pdf).toMatch(/\[\s*[\d.]+\s+[\d.]+\s*\]\s*0\s+d/);
  });

  it("writes text escaped and in WinAnsi", () => {
    expect(pdf).toContain("(R10) Tj");
    expect(pdf).toContain("(50) Tj");
    expect(pdf).toContain("(f\\(x\\) \\\\ 5\\260) Tj");
  });

  it("handles no pages by making an empty one rather than an invalid file", () => {
    const empty = latin1(exportPdf([], { title: "", author: "" }));
    expect(empty).toMatch(/\/Count 1\b/);
  });
});
