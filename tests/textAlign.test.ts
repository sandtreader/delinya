import { describe, it, expect } from "vitest";
import { applyChange } from "@sandtreader/collab/protocol";
import { addText, handlesFor, resizeTo, resolve, setText, setTextSize, setTextStyle } from "../src/model";
import type { ResolvedText, TextProps } from "../src/model";
import { drawingPrimitives } from "../src/output/primitives";
import { exportDxf } from "../src/output/dxf";
import { textEditorBox } from "../src/view/textEdit";
import { doc } from "./helpers";

// Text alignment: each line placed left, centred or right within the box's
// width, measured with the same metrics as the wrap, so every output agrees.
// A mirrored box mirrors its alignment with everything else.

// Mono: 6 mm a character at size 10. Box 100 wide from x = 10; "Hi" is 12 wide.
const box = (props: Partial<TextProps>) =>
  resolve(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", ...props }))).shapes.t as ResolvedText;

describe("aligned lines", () => {
  it("start at the left by default", () => {
    const t = box({});
    expect(t.align).toBe("left");
    expect(t.lines[0]!.at).toEqual([10, 29]);
  });

  it("centre or right each line in the width", () => {
    expect(box({ align: "centre" }).lines[0]!.at).toEqual([54, 29]);
    expect(box({ align: "right" }).lines[0]!.at).toEqual([98, 29]);
    const two = box({ align: "centre", text: "Hi\nHello", height: 24 });
    expect(two.lines.map((l) => l.at[0])).toEqual([54, 45]);
  });

  it("turn with the box", () => {
    // 90°: along the box is down the page, its baseline offset to the left.
    expect(box({ align: "centre", rotation: 90 }).lines[0]!.at).toEqual([1, 64]);
  });

  it("mirror with the box: right-aligned text mirrored sits at the left", () => {
    // The mirrored line runs leftwards from its start, so it covers x 10..22.
    expect(box({ align: "right", mirror: true }).lines[0]!.at).toEqual([22, 29]);
    expect(box({ align: "left", mirror: true }).lines[0]!.at).toEqual([110, 29]);
  });

  it("take a bad value as left", () => {
    const st = doc({ type: "entity_added", id: "t", kind: "text", props: { x: 0, y: 0, width: 100, height: 12, text: "Hi", align: "middle" } });
    expect((resolve(st).shapes.t as ResolvedText).align).toBe("left");
  });
});

describe("setting the alignment", () => {
  const base = doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono" }));

  it("writes it with the other style settings, leaving the size alone", () => {
    const c = setTextStyle(base, "t", { align: "right" });
    expect(c).toEqual({ type: "props_changed", id: "t", props: { align: "right" } });
    const st = applyChange(base, c!);
    expect((resolve(st).shapes.t as ResolvedText).size).toBeCloseTo(10, 9);
    expect(setTextStyle(st, "t", { align: "right" })).toBeUndefined();
  });
});

describe("alignment elsewhere", () => {
  it("places output text where the canvas does", () => {
    const r = resolve(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", align: "right" })));
    const [p] = drawingPrimitives(r, { dimensions: false, textSize: 3, tick: 1 });
    expect(p).toMatchObject({ kind: "text", at: [98, 29], anchor: "start" });
  });

  it("aligns the on-drawing field the same way", () => {
    const view = { scale: 2, ox: 0, oy: 0 };
    expect(textEditorBox(box({ align: "centre" }), view).textAlign).toBe("center");
    expect(textEditorBox(box({ align: "right" }), view).textAlign).toBe("right");
  });
});

describe("a line wider than the box", () => {
  // "abcdefgh" in mono at size 10 is 48 wide; the box is 20.
  const wide = (props: Partial<TextProps>) => box({ width: 20, text: "abcdefgh", ...props });

  it("starts at the left edge whatever the alignment, as the typing field does", () => {
    expect(wide({ align: "centre" }).lines[0]!.at[0]).toBe(10);
    expect(wide({ align: "right" }).lines[0]!.at[0]).toBe(10);
  });

  it("starts at the right edge when mirrored", () => {
    // The box widens to the word (48), so its right edge is at 58.
    expect(wide({ align: "right", mirror: true }).lines[0]!.at[0]).toBe(58);
  });
});

describe("aligned text in DXF", () => {
  /** The TEXT entities' groups, by their text (code 1). */
  function texts(dxf: string): Record<string, Record<number, string>> {
    const lines = dxf.split(/\r?\n/).map((l) => l.trim());
    const out: Record<string, Record<number, string>> = {};
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] !== "0" || lines[i + 1] !== "TEXT") continue;
      const e: Record<number, string> = {};
      for (let j = i + 2; j < lines.length - 1 && lines[j] !== "0"; j += 2) e[Number(lines[j])] = lines[j + 1]!;
      out[e[1]!] = e;
    }
    return out;
  }
  const dxfOf = (props: Partial<TextProps>) =>
    texts(exportDxf(resolve(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", ...props }))))!).Hi!;

  it("leaves left-aligned text justified at its start", () => {
    const e = dxfOf({});
    expect(e[72] ?? "0").toBe("0");
    expect(e[11]).toBeUndefined();
    expect([Number(e[10]), Number(e[20])]).toEqual([10, -29]);
  });

  it("justifies centred and right-aligned text by DXF's own codes, at the line's middle or end", () => {
    const c = dxfOf({ align: "centre" });
    expect(c[72]).toBe("1");
    expect([Number(c[11]), Number(c[21])]).toEqual([60, -29]);
    const r = dxfOf({ align: "right" });
    expect(r[72]).toBe("2");
    expect([Number(r[11]), Number(r[21])]).toEqual([110, -29]);
  });

  it("measures a mirrored line's middle or end along its own, backward, direction", () => {
    // Mirrored right-aligned "Hi" covers x 10..22, reading from 22 leftwards: its end is at 10.
    const r = dxfOf({ align: "right", mirror: true });
    expect(r[71]).toBe("2");
    expect(r[72]).toBe("2");
    expect([Number(r[11]), Number(r[21])]).toEqual([10, -29]);
  });
});

describe("the box is never narrower than its longest word", () => {
  // Mono at size 10: "abcdefgh" is 48 wide, "ab" 12, "ab cd" 30.
  it("widens to the longest word, so lines align to its end, not ragged", () => {
    const t = box({ width: 20, height: 24, text: "abcdefgh\nab", align: "right" });
    expect(t.size).toBeCloseTo(10, 9);
    expect(t.width).toBe(48);
    expect(t.corners[1]).toEqual([58, 20]);
    expect(t.lines.map((l) => l.at[0] + l.width)).toEqual([58, 58]);
  });

  it("wraps the other words to that width", () => {
    const t = box({ width: 20, height: 24, text: "abcdefgh ab cd" });
    expect(t.lines.map((l) => l.text)).toEqual(["abcdefgh", "ab cd"]);
    expect(t.size).toBeCloseTo(10, 9);
  });

  it("keeps the width it has when that is wider", () => {
    expect(box({ width: 100, text: "abcdefgh" }).width).toBe(100);
  });

  it("is widened in the document by typing, sizing and resizing", () => {
    const st = doc(addText("t", { x: 10, y: 20, width: 20, height: 12, text: "ab", font: "mono" }));
    const typed = applyChange(st, setText(st, "t", "abcdefgh")!);
    expect(typed.entities.t!.props).toMatchObject({ width: 48, height: 12 });

    const bigger = applyChange(typed, setTextSize(typed, "t", 20)!);
    expect(bigger.entities.t!.props).toMatchObject({ width: 96, height: 24 });
    // Smaller text leaves the width alone: it only ever grows to fit.
    const smaller = applyChange(typed, setTextSize(typed, "t", 5)!);
    expect(smaller.entities.t!.props).toMatchObject({ width: 48, height: 6 });

    const wide = doc(addText("t", { x: 0, y: 0, width: 100, height: 12, text: "abcdefgh", font: "mono" }));
    const br = handlesFor(resolve(wide).shapes.t!)[2]!;
    const narrowed = applyChange(wide, resizeTo(wide, "t", br.handle, [20, 12], br.anchor)!);
    expect(narrowed.entities.t!.props).toMatchObject({ width: 48, height: 12 });
  });
});
