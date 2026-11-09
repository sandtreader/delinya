import { describe, it, expect } from "vitest";
import { editorReducer, initialEditor, panelFor } from "../src/app/editor";

const shapes = { a: {}, b: {}, c: {} };

describe("panelFor", () => {
  it("shows nothing with nothing selected", () => {
    expect(panelFor("select", [], shapes)).toBeNull();
  });

  it("shows one shape's fields whatever the tool, so a just-drawn shape can be sized", () => {
    expect(panelFor("select", ["a"], shapes)).toBe("shape");
    expect(panelFor("rect", ["a"], shapes)).toBe("shape");
  });

  it("shows the arrange panel for two or more shapes, only with the select tool", () => {
    expect(panelFor("select", ["a", "b"], shapes)).toBe("arrange");
    expect(panelFor("select", ["a", "b", "c"], shapes)).toBe("arrange");
    expect(panelFor("line", ["a", "b"], shapes)).toBeNull();
  });

  it("counts only ids that are still shapes", () => {
    expect(panelFor("select", ["a", "gone"], shapes)).toBe("shape");
    expect(panelFor("select", ["gone"], shapes)).toBeNull();
  });
});

describe("properties dialog", () => {
  it("opens and closes like the output dialog", () => {
    const open = editorReducer(initialEditor, { type: "dialog", dialog: "properties" });
    expect(open.dialog).toBe("properties");
    expect(editorReducer(open, { type: "dialog", dialog: null }).dialog).toBeNull();
  });
});
