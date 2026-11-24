import { describe, it, expect } from "vitest";
import { editorReducer, initialEditor } from "../src/app/editor";
import panelSource from "../src/panels/SelectionPanel.tsx?raw";
import toolbarSource from "../src/panels/Toolbar.tsx?raw";

// Rotate and Duplicate live in small cards dropped from buttons in the top
// bar, after Undo and Redo, rather than in the selection panel. One card is
// open at a time; it stays open while there is a selection to act on (so
// you can turn or copy again, or pick other shapes on the drawing), and
// goes when the selection empties.

const selected = { ...initialEditor, selection: ["a"] };

describe("the open card", () => {
  it("is none at first, and one at a time", () => {
    expect(initialEditor.card).toBeNull();
    const rotate = editorReducer(selected, { type: "card", card: "rotate" });
    expect(rotate.card).toBe("rotate");
    expect(editorReducer(rotate, { type: "card", card: "duplicate" }).card).toBe("duplicate");
    expect(editorReducer(rotate, { type: "card", card: null }).card).toBeNull();
  });

  it("stays while the selection changes, and goes when it empties", () => {
    const open = editorReducer(selected, { type: "card", card: "duplicate" });
    expect(editorReducer(open, { type: "select", ids: ["b", "c"] }).card).toBe("duplicate");
    expect(editorReducer(open, { type: "select", ids: [] }).card).toBeNull();
  });

  it("doesn't open with nothing selected", () => {
    expect(editorReducer(initialEditor, { type: "card", card: "rotate" }).card).toBeNull();
  });
});

describe("where they live", () => {
  it("in the toolbar, not the selection panel", () => {
    expect(panelSource).not.toMatch(/<Rotate\b/);
    expect(panelSource).not.toMatch(/<Duplicate\b/);
    expect(toolbarSource).toMatch(/<RotateCard\b/);
    expect(toolbarSource).toMatch(/<DuplicateCard\b/);
    // After Undo and Redo.
    expect(toolbarSource.indexOf("<RotateCard")).toBeGreaterThan(toolbarSource.indexOf('label="Redo"'));
  });
});
