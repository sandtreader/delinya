import { describe, it, expect } from "vitest";
import { addText, resolve } from "../src/model";
import type { ResolvedText } from "../src/model";
import { editorReducer, hoverShowsPosition, initialEditor, panelFor } from "../src/app/editor";
import { drawStatus, shapeStatus } from "../src/view/format";
import { fontStack, newTextProps, textElementAttrs } from "../src/view/textSvg";
import { doc } from "./helpers";

// Text boxes, stage 2: the Text tool (T) draws a box like the Rectangle
// tool; the canvas and SVG output draw each line with the same attributes;
// the status bar shows the font size the box gives.

describe("the Text tool", () => {
  it("is a drawing tool that shows the pointer position", () => {
    expect(editorReducer(initialEditor, { type: "tool", tool: "text" }).tool).toBe("text");
    expect(hoverShowsPosition("text")).toBe(true);
    expect(panelFor("text", ["t"], { t: {} })).toBe("shape");
  });

  it("makes an empty sans box from a drag, either way round", () => {
    expect(newTextProps([110, 32], [10, 20], "layer")).toEqual({ x: 10, y: 20, width: 100, height: 12, text: "", font: "sans", layer: "layer" });
    expect(newTextProps([10, 20], [10, 40], "layer")).toBeUndefined();
    expect(newTextProps([10, 20], [50, 20], "layer")).toBeUndefined();
  });

  it("says while drawing what size the text will be", () => {
    expect(drawStatus("text", [10, 20], [110, 32])).toBe("from 10, 20 mm · 100 × 12 mm · text 10 mm");
  });
});

describe("a selected text box in the status bar", () => {
  it("shows its box and font size, and its turn", () => {
    const r = resolve(doc(
      addText("a", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono" }),
      addText("b", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", rotation: 30 }),
    ));
    expect(shapeStatus(r.shapes.a!)).toBe("from 10, 20 mm · 100 × 12 mm · text 10 mm");
    expect(shapeStatus(r.shapes.b!)).toBe("from 10, 20 mm · 100 × 12 mm · text 10 mm at 30°");
  });
});

describe("text element attributes, shared by the canvas and SVG output", () => {
  it("names portable font stacks", () => {
    expect(fontStack("sans")).toMatch(/^Helvetica, Arial/);
    expect(fontStack("serif")).toMatch(/Times/);
    expect(fontStack("mono")).toMatch(/Courier/);
    expect(fontStack("mono")).toMatch(/monospace$/);
  });

  it("places, styles and pins the width of a line", () => {
    const t = resolve(doc(addText("t", { x: 10, y: 20, width: 100, height: 12, text: "Hi", font: "mono", bold: true }))).shapes.t as ResolvedText;
    const a = textElementAttrs({ at: t.lines[0]!.at, angle: t.rotation, size: t.size, font: t.font, mirror: t.mirror, width: t.lines[0]!.width });
    expect(a).toMatchObject({
      "font-family": fontStack("mono"), "font-size": "10", "font-weight": "bold",
      textLength: "12", lengthAdjust: "spacing", transform: "translate(10 29)",
    });
    expect(a["font-style"]).toBeUndefined();
  });

  it("turns and mirrors by transform", () => {
    const a = textElementAttrs({ at: [5, 6], angle: 30, size: 4, font: { family: "serif", bold: false, italic: true }, mirror: true, width: 20 });
    expect(a.transform).toBe("translate(5 6) rotate(30) scale(-1 1)");
    expect(a["font-style"]).toBe("italic");
    expect(a["font-weight"]).toBeUndefined();
  });
});
