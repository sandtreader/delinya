import { describe, it, expect } from "vitest";
import { textWidth, toWinAnsi, wrapText } from "../../src/output/text";

describe("textWidth", () => {
  it("uses Helvetica widths", () => {
    expect(textWidth("0", 1)).toBeCloseTo(0.556);
    expect(textWidth("R10", 2)).toBeCloseTo(2 * (0.722 + 0.556 + 0.556));
    expect(textWidth("", 5)).toBe(0);
    expect(textWidth("5°", 1)).toBeCloseTo(0.556 + 0.4);
  });
});

describe("toWinAnsi", () => {
  it("passes ASCII and Latin-1 through and maps the WinAnsi extras", () => {
    expect(toWinAnsi("A~")).toEqual([65, 126]);
    expect(toWinAnsi("5°é")).toEqual([53, 0xb0, 0xe9]);
    expect(toWinAnsi("a…b–")).toEqual([97, 0x85, 98, 0x96]);
  });

  it("replaces what the encoding can't hold", () => {
    expect(toWinAnsi("✓\t")).toEqual([0x3f, 0x3f]);
  });
});

describe("wrapText", () => {
  it("fits words greedily to the width", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 3, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 3)).toBeLessThanOrEqual(30);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("keeps explicit line breaks and breaks over-long words", () => {
    expect(wrapText("a\n\nb", 3, 100)).toEqual(["a", "", "b"]);
    const long = wrapText("x".repeat(40), 3, 20);
    expect(long.length).toBeGreaterThan(1);
    for (const l of long) expect(textWidth(l, 3)).toBeLessThanOrEqual(20);
    expect(long.join("")).toBe("x".repeat(40));
  });
});
