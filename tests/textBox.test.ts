import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  addRect, addText, addVariable, duplicateShapes, fitTextSize, flipShapes, handlesFor, KINDS, LINE_SPACING, BASELINE,
  resizeTo, resolve, rotateShapes, setRotation, setText, setTextSize, setTextStyle, textAdvance, wrapText,
} from "../src/model";
import type { FontStyle, ResolvedText } from "../src/model";
import { drawingPrimitives } from "../src/output/primitives";
import { exportPdf } from "../src/output/pdf";
import { exportSvg } from "../src/output/svg";
import { exportDxf } from "../src/output/dxf";
import type { PageDrawing } from "../src/output/types";
import { doc } from "./helpers";

// Text boxes. A box is drawn and sized like a rect: x, y (a corner), width
// (where lines wrap) and height, turned by `rotation` about (x, y). The font
// size is not stored: it is the largest at which the text, wrapped to the
// width, fits the height (lines × LINE_SPACING × size). Fonts are the PDF
// standard families (sans = Helvetica, serif = Times, mono = Courier), with
// bold and italic for the whole box, measured with Adobe's metrics so every
// client and every output wraps the same. `mirror` draws the glyphs
// reflected within the box: a flip mirrors the text, it does not keep it
// readable.

const SANS: FontStyle = { family: "sans", bold: false, italic: false };
const MONO: FontStyle = { family: "mono", bold: false, italic: false };

const apply = (state: DocState, c: Change | undefined): DocState => {
  expect(c).toBeDefined();
  return applyChange(state, c!);
};
const text = (state: DocState, id = "t") => resolve(state).shapes[id] as ResolvedText;
const props = (state: DocState, id: string) => state.entities[id]!.props as Record<string, unknown>;

describe("font metrics (Adobe AFM, 1/1000 em)", () => {
  it("measures each standard family and style", () => {
    expect(textAdvance("Hello", SANS, 10)).toBeCloseTo(22.78, 9);
    expect(textAdvance("Hello", { family: "sans", bold: true, italic: false }, 10)).toBeCloseTo(24.45, 9);
    expect(textAdvance("Hello", { family: "sans", bold: false, italic: true }, 10)).toBeCloseTo(22.78, 9);   // Oblique: same widths
    expect(textAdvance("Hello", { family: "serif", bold: false, italic: false }, 10)).toBeCloseTo(22.22, 9);
    expect(textAdvance("Ab", { family: "serif", bold: true, italic: false }, 10)).toBeCloseTo(12.78, 9);
    expect(textAdvance("Ab", { family: "serif", bold: false, italic: true }, 10)).toBeCloseTo(11.11, 9);
    expect(textAdvance("Ab", { family: "serif", bold: true, italic: true }, 10)).toBeCloseTo(11.67, 9);
    expect(textAdvance("Hello", MONO, 10)).toBeCloseTo(30, 9);
    expect(textAdvance("Hello", { family: "mono", bold: true, italic: true }, 10)).toBeCloseTo(30, 9);
  });

  it("has a width for every WinAnsi character, not just ASCII", () => {
    const serif = { family: "serif", bold: false, italic: false } as const;
    expect(textAdvance("é", serif, 10)).toBeCloseTo(4.44, 9);      // eacute, not the missing "n" (500)
    expect(textAdvance("Œ", serif, 10)).toBeCloseTo(8.89, 9);      // OE, from 0x80-0x9F
    expect(textAdvance("Ÿ‰", SANS, 10)).toBeCloseTo(16.67, 9);     // Ydieresis 667, perthousand 1000
    expect(textAdvance("\u00a0", SANS, 10)).toBeCloseTo(2.78, 9);  // no-break space: a space
    expect(textAdvance("Ω", SANS, 10)).toBeCloseTo(5.56, 9);       // not in WinAnsi: the "n"
  });
});

describe("wrapText", () => {
  it("breaks at spaces to fit the width, and at newlines", () => {
    // Mono: every character 0.6 em, so 6 mm at size 10.
    expect(wrapText("abc def ghi", MONO, 10, 45)).toEqual(["abc def", "ghi"]);
    expect(wrapText("abc\ndef", MONO, 10, 1000)).toEqual(["abc", "def"]);
    expect(wrapText("abc\n\ndef", MONO, 10, 1000)).toEqual(["abc", "", "def"]);
  });

  it("leaves a word longer than the width on a line of its own", () => {
    expect(wrapText("a abcdefgh b", MONO, 10, 20)).toEqual(["a", "abcdefgh", "b"]);
  });

  it("gives one empty line for no text", () => {
    expect(wrapText("", MONO, 10, 50)).toEqual([""]);
  });
});

describe("fitTextSize", () => {
  it("is the height over the line spacing for one line with room", () => {
    expect(LINE_SPACING).toBe(1.2);
    expect(fitTextSize("abc def", MONO, 100, 12)).toBeCloseTo(10, 9);
  });

  it("is the largest size at which the wrapped lines fit the height", () => {
    // Width 18: one line needs 4.2 × size ≤ 18 (size ≤ 4.2857), two lines fit 12 high at size 5.
    expect(fitTextSize("abc def", MONO, 18, 12)).toBeCloseTo(5, 6);
    // 10 high: two lines only manage 4.1667, so one line at 4.2857 wins.
    expect(fitTextSize("abc def", MONO, 18, 10)).toBeCloseTo(18 / 4.2, 6);
  });

  it("never grows when the box gets shorter or narrower", () => {
    let last = Infinity;
    for (let h = 30; h > 2; h -= 0.7) {
      const s = fitTextSize("The quick brown fox jumps over the lazy dog", SANS, 60, h);
      expect(s).toBeLessThanOrEqual(last + 1e-12);
      last = s;
    }
  });
});

describe("a text box resolves", () => {
  it("lays its lines out from the top left, baselines a line apart", () => {
    expect(BASELINE).toBe(0.9);
    const t = text(doc(addText("t", { x: 10, y: 20, width: 100, height: 24, text: "Hi\nYo", font: "mono" })));
    expect(t.kind).toBe("text");
    expect(t.size).toBeCloseTo(10, 9);
    expect(t.font).toEqual(MONO);
    expect(t.lines.map((l) => l.text)).toEqual(["Hi", "Yo"]);
    expect(t.lines[0]!.width).toBeCloseTo(12, 9);
    expect(t.lines[0]!.at).toEqual([10, 29]);
    expect(t.lines[1]!.at).toEqual([10, 41]);
    expect(t.corners).toEqual([[10, 20], [110, 20], [110, 44], [10, 44]]);
    expect(t.bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 44 });
    expect([t.rotation, t.mirror]).toEqual([0, false]);
  });

  it("turns with its box", () => {
    const t = text(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", rotation: 90 })));
    // Down the page from (10, 20), the baseline 9 mm to the left.
    expect(t.lines[0]!.at).toEqual([1, 20]);
    expect(t.corners).toEqual([[10, 20], [10, 120], [-2, 120], [-2, 20]]);
  });

  it("starts a mirrored line from the far side, reading backwards", () => {
    const t = text(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", mirror: true })));
    expect(t.mirror).toBe(true);
    expect(t.lines[0]!.at).toEqual([110, 29]);
  });

  it("defaults bad props rather than throwing", () => {
    const st = doc({ type: "entity_added", id: "t", kind: KINDS.text, props: { x: 0, y: 0, width: 50, height: 12, text: 5, font: "comic", bold: "yes" } });
    const t = text(st);
    expect(t.lines.map((l) => l.text)).toEqual([""]);
    expect(t.font).toEqual(SANS);
  });

  it("takes linked lengths for width and height", () => {
    const t = text(doc(addVariable("h", 12), addText("t", { x: 0, y: 0, width: 100, height: { ref: "h" }, text: "Hi", font: "mono" })));
    expect(t.height).toBe(12);
    expect(t.size).toBeCloseTo(10, 9);
  });

  it("is copied by Duplicate", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "Hi", bold: true }));
    let n = 0;
    const out = duplicateShapes(st, ["t"], [60, 0], (p) => `${p}${++n}`)!;
    const copy = text(applyChange(st, out.change), out.ids[0]!);
    expect(copy.lines[0]!.text).toBe("Hi");
    expect(copy.font.bold).toBe(true);
    expect(copy.x).toBe(60);
  });
});

describe("editing a text box keeps its font size", () => {
  const base = doc(addText("t", { x: 0, y: 0, width: 100, height: 12, text: "Hi", font: "mono" }));

  it("grows the box as the text gains lines", () => {
    const st = apply(base, setText(base, "t", "Hi\nYo"));
    expect(props(st, "t")).toMatchObject({ text: "Hi\nYo", height: 24 });
    expect(text(st).size).toBeCloseTo(10, 9);
  });

  it("sets the size by setting the height", () => {
    const st = apply(base, setTextSize(base, "t", 5));
    expect(props(st, "t").height).toBe(6);
    expect(text(st).size).toBeCloseTo(5, 9);
  });

  it("refits the height for a new font or style", () => {
    const wide = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "Hello Hello", font: "sans" }));
    const before = text(wide).size;
    const st = apply(wide, setTextStyle(wide, "t", { font: "mono", bold: true }));
    expect(props(st, "t")).toMatchObject({ font: "mono", bold: true });
    expect(text(st).size).toBeCloseTo(before, 6);
  });

  it("routes a linked height through its variable", () => {
    const st0 = doc(addVariable("h", 12), addText("t", { x: 0, y: 0, width: 100, height: { ref: "h" }, text: "Hi", font: "mono" }));
    const st = apply(st0, setText(st0, "t", "Hi\nYo"));
    expect(props(st, "h").value).toBe(24);
    expect(props(st, "t").height).toEqual({ ref: "h" });
  });

  it("skips no change", () => {
    expect(setText(base, "t", "Hi")).toBeUndefined();
    expect(setText(base, "missing", "x")).toBeUndefined();
  });
});

describe("turning and flipping text", () => {
  const base = doc(addText("t", { x: 0, y: 0, width: 100, height: 20, text: "Hi" }));

  it("turns like a rect", () => {
    const st = apply(base, rotateShapes(base, ["t"], 90));
    expect(props(st, "t")).toMatchObject({ x: 60, y: -40, rotation: 90 });
    const spun = apply(base, setRotation(base, "t", 90));
    expect(props(spun, "t")).toMatchObject({ x: 60, y: -40, rotation: 90 });
  });

  it("mirrors the text left to right", () => {
    const st = apply(base, flipShapes(base, ["t"], "x"));
    expect(props(st, "t")).toMatchObject({ x: 0, y: 0, rotation: 0, mirror: true });
    expect(text(st).bounds).toEqual(text(base).bounds);
    const back = apply(st, flipShapes(st, ["t"], "x"));
    expect(props(back, "t")).toMatchObject({ x: 0, y: 0, rotation: 0, mirror: false });
  });

  it("mirrors it top to bottom: upside down, reading left to right", () => {
    const st = apply(base, flipShapes(base, ["t"], "y"));
    expect(props(st, "t")).toMatchObject({ x: 100, y: 20, rotation: 180, mirror: true });
    expect(text(st).bounds).toEqual(text(base).bounds);
  });

  it("flips about a shared pivot with other shapes", () => {
    const st0 = doc(addText("t", { x: 0, y: 0, width: 100, height: 20, text: "Hi" }), addRect("r", { x: 200, y: 0, width: 10, height: 20 }));
    const st = apply(st0, flipShapes(st0, ["t", "r"], "x"));
    expect(text(st).bounds).toEqual({ minX: 110, minY: 0, maxX: 210, maxY: 20 });
    expect(text(st).mirror).toBe(true);
  });
});

describe("resizing a text box", () => {
  it("has corner handles like a rect, setting width and height as dragged", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 100, height: 12, text: "Hi", font: "mono" }));
    const hs = handlesFor(text(st));
    expect(hs.map((h) => h.point)).toEqual([[0, 0], [100, 0], [100, 12], [0, 12]]);
    const br = hs[2]!;
    const big = apply(st, resizeTo(st, "t", br.handle, [80, 24], br.anchor));
    expect(props(big, "t")).toMatchObject({ x: 0, y: 0, width: 80, height: 24 });
    expect(text(big).size).toBeCloseTo(20, 9);
  });
});

describe("text in output", () => {
  const st = doc(
    addText("a", { x: 0, y: 0, width: 100, height: 24, text: "Hi\nYo", font: "mono" }),
    addText("b", { x: 0, y: 50, width: 100, height: 12, text: "Back", font: "serif", bold: true, italic: true, mirror: true }),
  );

  it("becomes a text primitive per line, styled, and no box outline", () => {
    const prims = drawingPrimitives(resolve(st), { dimensions: false, textSize: 3, tick: 1 });
    expect(prims.every((p) => p.kind === "text")).toBe(true);
    const texts = prims.filter((p) => p.kind === "text");
    expect(texts.map((p) => p.text)).toEqual(["Hi", "Yo", "Back"]);
    expect(texts[0]).toMatchObject({ at: [0, 9], angle: 0, anchor: "start", font: MONO });
    expect(texts[0]!.size).toBeCloseTo(10, 9);
    expect(texts[0]!.width).toBeCloseTo(12, 9);
    expect(texts[2]).toMatchObject({ mirror: true, font: { family: "serif", bold: true, italic: true } });
  });

  it("uses the PDF standard fonts, mirrored by the text matrix", () => {
    const prims = drawingPrimitives(resolve(st), { dimensions: false, textSize: 3, tick: 1 });
    const page: PageDrawing = { width: 210, height: 297, clip: { x: 0, y: 0, width: 210, height: 297 }, content: prims, furniture: [] };
    const pdf = new TextDecoder("latin1").decode(exportPdf([page], { title: "", author: "" }));
    expect(pdf).toContain("/BaseFont /Courier ");
    expect(pdf).toContain("/BaseFont /Times-BoldItalic ");
    expect(pdf).toContain("(Back) Tj");
  });

  it("asks SVG for the family, pins each line's width and mirrors by transform", () => {
    const svg = exportSvg(resolve(st), { dimensions: false })!;
    expect(svg).toMatch(/<text[^>]*font-family="[^"]*Courier[^"]*"[^>]*>Hi<\/text>/);
    expect(svg).toMatch(/<text[^>]*textLength="12"[^>]*>Hi<\/text>/);
    expect(svg).toMatch(/<text[^>]*font-weight="bold"[^>]*font-style="italic"[^>]*>Back<\/text>|<text[^>]*font-style="italic"[^>]*font-weight="bold"[^>]*>Back<\/text>/);
    expect(svg).toMatch(/<text[^>]*scale\(-1[ ,]1\)[^>]*>Back<\/text>/);
  });

  it("writes DXF TEXT, mirrored with the backward flag", () => {
    const dxf = exportDxf(resolve(st))!;
    const lines = dxf.split(/\r?\n/).map((l) => l.trim());
    const texts: Record<string, Record<number, string>> = {};
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] === "0" && lines[i + 1] === "TEXT") {
        const e: Record<number, string> = {};
        for (let j = i + 2; j < lines.length - 1 && lines[j] !== "0"; j += 2) e[Number(lines[j])] = lines[j + 1]!;
        texts[e[1]!] = e;
      }
    }
    expect(Object.keys(texts).sort()).toEqual(["Back", "Hi", "Yo"]);
    expect(Number(texts.Hi![40])).toBeGreaterThan(0);
    expect(texts.Back![71]).toBe("2");
    expect(texts.Hi![71] ?? "0").toBe("0");
  });
});
