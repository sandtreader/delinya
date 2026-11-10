import { describe, it, expect } from "vitest";
import { addCircle, addLine, addRect, resolve } from "../src/model";
import { shapeStatus } from "../src/view/format";
import { editorReducer, initialEditor } from "../src/app/editor";
import { doc } from "./helpers";

// Dragging a selected shape (moving it or a handle) shows its position and
// size in the status bar, as drawing one does.

describe("shapeStatus", () => {
  const r = resolve(doc(
    addRect("a", { x: 10, y: 20, width: 50, height: 30 }),
    addCircle("c", { cx: 10, cy: 20, diameter: 10 }),
    addLine("l", { x: 0, y: 0, length: 50, angle: 53.13 }),
  ));

  it("reads like drawing the shape: where it starts and how big it is", () => {
    expect(shapeStatus(r.shapes.a!)).toBe("from 10, 20 mm · 50 × 30 mm");
    expect(shapeStatus(r.shapes.c!)).toBe("centre 10, 20 mm · ⌀ 10 mm");
    expect(shapeStatus(r.shapes.l!)).toBe("from 0, 0 mm · 50 mm at 53.13°");
  });
});

describe("pointer while dragging a shape", () => {
  it("names the shape being dragged for the status bar, and forgets it after", () => {
    const moving = editorReducer(initialEditor, { type: "pointer", cursor: [60, 50], snap: null, measure: "a" });
    expect(moving.measure).toBe("a");
    expect(editorReducer(moving, { type: "pointer", cursor: null, snap: null }).measure).toBeNull();
    expect(initialEditor.measure).toBeNull();
  });
});
