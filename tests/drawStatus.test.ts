import { describe, it, expect } from "vitest";
import { drawStatus } from "../src/view/format";
import { editorReducer, initialEditor } from "../src/app/editor";

// While a new shape is dragged out, the status bar shows where it started
// and how big it is, instead of the bare pointer position.

describe("drawStatus", () => {
  it("a rectangle: the corner it started from and its width × height", () => {
    expect(drawStatus("rect", [10, 20], [60, 50])).toBe("from 10, 20 mm · 50 × 30 mm");
    expect(drawStatus("rect", [60, 50], [10, 20])).toBe("from 60, 50 mm · 50 × 30 mm");
  });

  it("a circle: its centre and diameter", () => {
    expect(drawStatus("circle", [10, 20], [13, 24])).toBe("centre 10, 20 mm · ⌀ 10 mm");
  });

  it("a line: its start, length and angle (as the shape panel shows it)", () => {
    expect(drawStatus("line", [0, 0], [30, 40])).toBe("from 0, 0 mm · 50 mm at 53.13°");
    expect(drawStatus("line", [5, 5], [5, -5])).toBe("from 5, 5 mm · 10 mm at -90°");
  });
});

describe("pointer while drawing", () => {
  it("remembers the drag's start for the status bar, and forgets it once the pointer moves on its own", () => {
    const drawing = editorReducer(initialEditor, { type: "pointer", cursor: [60, 50], snap: null, draw: { tool: "rect", start: [10, 20] } });
    expect(drawing.draw).toEqual({ tool: "rect", start: [10, 20] });
    expect(editorReducer(drawing, { type: "pointer", cursor: [70, 50], snap: null }).draw).toBeNull();
    expect(initialEditor.draw).toBeNull();
  });
});
