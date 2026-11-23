import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { addText, addVariable, dragHandle, fitTextSize, handlesFor, longestWord, resizeTo, resolve, setText, setTextWidth } from "../src/model";
import type { FontStyle, ResolvedText, TextProps } from "../src/model";
import { doc } from "./helpers";

// A text box is never narrower than its longest word (see textAlign.test.ts
// for the rule): here, which corner stays put when a drag would make it so.

const MONO: FontStyle = { family: "mono", bold: false, italic: false };

const apply = (state: DocState, c: Change | undefined): DocState => {
  expect(c).toBeDefined();
  return applyChange(state, c!);
};
const text = (st: DocState) => resolve(st).shapes.t as ResolvedText;
// Mono at size 10: "abcdefgh" is 48 wide.
const wide = (props: Partial<TextProps> = {}) =>
  doc(addText("t", { x: 0, y: 0, width: 100, height: 12, text: "abcdefgh", font: "mono", ...props }));

describe("the longest word", () => {
  it("is measured in em, as wrapping splits words", () => {
    expect(longestWord("ab  abcdefgh\tabc\nabcd", MONO) * 10).toBe(48);
    expect(longestWord("", MONO)).toBe(0);
  });

  it("widens the box the size is fitted to", () => {
    // 20 wide by 24 high: "abcdefgh" on one line, "ab cd" on the next, at 10.
    expect(fitTextSize("abcdefgh ab cd", MONO, 20, 24)).toBeCloseTo(10, 9);
  });
});

describe("dragging a text box narrower than its longest word", () => {
  it("stops a left handle at the word, its right side staying put", () => {
    const st = wide();
    const tl = handlesFor(text(st))[0]!;
    const narrowed = apply(st, resizeTo(st, "t", tl.handle, [80, 0], tl.anchor));
    expect(narrowed.entities.t!.props).toMatchObject({ x: 52, y: 0, width: 48, height: 12 });
    expect(text(narrowed).corners[2]).toEqual([100, 12]);
  });

  it("leaves a drag that stays wider than the word as dragged", () => {
    const st = wide();
    const tl = handlesFor(text(st))[0]!;
    expect(apply(st, resizeTo(st, "t", tl.handle, [40, 0], tl.anchor)).entities.t!.props).toMatchObject({ x: 40, width: 60 });
  });

  it("grows a turned box away from its anchor, along its own width", () => {
    // Turned 90°: its width runs down the page from (0, 0), its height off to the left.
    const st = wide({ rotation: 90 });
    const tl = handlesFor(text(st))[0]!;
    expect(tl.anchor).toEqual([-12, 100]);
    const narrowed = apply(st, resizeTo(st, "t", tl.handle, [0, 80], tl.anchor));
    expect(narrowed.entities.t!.props).toMatchObject({ x: 0, y: 52, width: 48, height: 12, rotation: 90 });
    expect(text(narrowed).corners[2]).toEqual([-12, 100]);

    const br = handlesFor(text(st))[2]!;
    const fromRight = apply(st, resizeTo(st, "t", br.handle, [-12, 20], br.anchor));
    expect(fromRight.entities.t!.props).toMatchObject({ x: 0, y: 0, width: 48, height: 12 });
  });

  it("keeps the side a link holds, the free side stopping at the word", () => {
    // Its top is held (a link on y): the top-left corner moves only on x.
    const st = wide();
    const tl = handlesFor(text(st), { y: { mode: "start", at: 0 } })[0]!;
    const c = dragHandle(st, "t", tl, [80, 0], { y: { mode: "start", at: 0 } });
    expect(apply(st, c).entities.t!.props).toMatchObject({ x: 52, width: 48, height: 12 });
  });

  it("edits a linked width's variable", () => {
    const linked = (value: number, t: string) =>
      doc(addVariable("v", value, "w"), addText("t", { x: 0, y: 0, width: { ref: "v" }, height: 12, text: t, font: "mono" }));
    const st = linked(20, "ab");
    const typed = apply(st, setText(st, "t", "abcdefgh"));
    expect(typed.entities.t!.props.width).toEqual({ ref: "v" });
    expect(typed.entities.v!.props.value).toBe(48);

    const roomy = linked(100, "abcdefgh");
    const br = handlesFor(text(roomy))[2]!;
    const narrowed = apply(roomy, resizeTo(roomy, "t", br.handle, [20, 12], br.anchor));
    expect(narrowed.entities.t!.props.width).toEqual({ ref: "v" });
    expect(narrowed.entities.v!.props.value).toBe(48);
  });
});

describe("setTextWidth: the panel's width field", () => {
  const two = doc(addText("t", { x: 0, y: 0, width: 48, height: 24, text: "abcdefgh ab", font: "mono" }));

  it("rewraps at the new width, keeping the font size", () => {
    const st = applyChange(two, setTextWidth(two, "t", 100)!);
    expect(st.entities.t!.props).toMatchObject({ width: 100, height: 12 });
    expect((resolve(st).shapes.t as ResolvedText).size).toBeCloseTo(10, 9);
  });

  it("stops at the longest word", () => {
    expect(setTextWidth(two, "t", 20)).toBeUndefined();
    const wide = doc(addText("t", { x: 0, y: 0, width: 100, height: 12, text: "abcdefgh", font: "mono" }));
    expect(applyChange(wide, setTextWidth(wide, "t", 30)!).entities.t!.props).toMatchObject({ width: 48, height: 12 });
  });

  it("goes through a linked width's variable", () => {
    const st0 = doc(addVariable("w", 48), addText("t", { x: 0, y: 0, width: { ref: "w" }, height: 24, text: "abcdefgh ab", font: "mono" }));
    const st = applyChange(st0, setTextWidth(st0, "t", 100)!);
    expect(st.entities.w!.props.value).toBe(100);
    expect(st.entities.t!.props.width).toEqual({ ref: "w" });
  });

  it("ignores what isn't a text box, and bad widths", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "a", font: "mono" }));
    expect(setTextWidth(st, "missing", 10)).toBeUndefined();
    expect(setTextWidth(st, "t", 0)).toBeUndefined();
    expect(setTextWidth(st, "t", Number.NaN)).toBeUndefined();
  });
});
