import { describe, it, expect } from "vitest";
import { editorReducer, hoverShowsPosition, initialEditor, type EditorState } from "../src/app/editor";

const at = (s: EditorState, tool: EditorState["tool"]): EditorState => ({
  ...s, tool, cursor: [1, 2], snap: { point: [1, 2], type: "corner" }, draw: tool === "select" ? null : { tool, start: [0, 0] },
});

describe("pointer position in the status bar", () => {
  it("hovering shows it with a drawing tool, not with select", () => {
    expect(hoverShowsPosition("select")).toBe(false);
    expect(hoverShowsPosition("line")).toBe(true);
    expect(hoverShowsPosition("rect")).toBe(true);
    expect(hoverShowsPosition("circle")).toBe(true);
  });

  it("switching to select clears the position, snap and draw readout", () => {
    const s = editorReducer(at(initialEditor, "rect"), { type: "tool", tool: "select" });
    expect(s.cursor).toBeNull();
    expect(s.snap).toBeNull();
    expect(s.draw).toBeNull();
  });

  it("switching to a drawing tool keeps it until the pointer moves", () => {
    const s = editorReducer(at(initialEditor, "rect"), { type: "tool", tool: "line" });
    expect(s.cursor).toEqual([1, 2]);
  });

  it("clearing an already clear position changes nothing, so hovering doesn't re-render", () => {
    const clear = { ...initialEditor, cursor: null, snap: null, draw: null };
    expect(editorReducer(clear, { type: "pointer", cursor: null, snap: null })).toBe(clear);
    expect(editorReducer(at(initialEditor, "select"), { type: "pointer", cursor: null, snap: null }).cursor).toBeNull();
  });
});
