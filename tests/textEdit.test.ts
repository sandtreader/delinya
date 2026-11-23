import { describe, it, expect } from "vitest";
import { applyChange, type Change } from "@sandtreader/collab/protocol";
import { DrawingStore, addRect, addText, endTextEdit, resolve, setText } from "../src/model";
import type { ResolvedText } from "../src/model";
import { editorReducer, initialEditor } from "../src/app/editor";
import { fontStack } from "../src/view/textSvg";
import { textBoxAt, textEditorBox } from "../src/view/textEdit";
import { doc } from "./helpers";

// Editing a text box on the drawing: an HTML text field laid exactly over
// the box (same font, size and line spacing, turned with it, never
// mirrored so it reads while typed), committing live as the panel does.
// A new box goes straight into it; double-click edits an existing one.

const view = { scale: 2, ox: 60, oy: 60 };
const box = (props: Partial<Parameters<typeof addText>[1]> = {}) =>
  resolve(doc(addText("t", { x: 10, y: 20, width: 100, height: 24, text: "Hi\nYo", font: "mono", ...props }))).shapes.t as ResolvedText;

describe("the on-drawing text field", () => {
  it("sits over the box in screen px, with the box's font and line spacing", () => {
    expect(textEditorBox(box({ bold: true }), view)).toEqual({
      left: 80, top: 100, width: 200, height: 48,
      transform: "rotate(0deg)", transformOrigin: "0 0",
      fontFamily: fontStack("mono"), fontSize: 20, lineHeight: 1.2,
      fontWeight: "bold", fontStyle: "normal",
    });
  });

  it("turns with the box about its (x, y) corner", () => {
    const e = textEditorBox(box({ rotation: 30, italic: true }), view);
    expect([e.left, e.top, e.transform]).toEqual([80, 100, "rotate(30deg)"]);
    expect(e.fontStyle).toBe("italic");
  });

  it("reads the right way round for a mirrored box", () => {
    expect(textEditorBox(box({ mirror: true }), view).transform).toBe("rotate(0deg)");
  });

  it("follows zoom and pan", () => {
    const e = textEditorBox(box(), { scale: 4, ox: 0, oy: -10 });
    expect([e.left, e.top, e.width, e.height, e.fontSize]).toEqual([40, 70, 400, 96, 40]);
  });
});

describe("editor state while editing text", () => {
  const editing = editorReducer({ ...initialEditor, selection: ["t"] }, { type: "editText", id: "t" });

  it("names the box being edited", () => {
    expect(editing.editText).toBe("t");
    expect(editorReducer(editing, { type: "editText", id: null }).editText).toBeNull();
  });

  it("stops when the selection or tool changes", () => {
    expect(editorReducer(editing, { type: "select", ids: ["other"] }).editText).toBeNull();
    expect(editorReducer(editing, { type: "select", ids: [] }).editText).toBeNull();
    expect(editorReducer(editing, { type: "tool", tool: "rect" }).editText).toBeNull();
    // Re-selecting the box itself keeps editing.
    expect(editorReducer(editing, { type: "select", ids: ["t"] }).editText).toBe("t");
  });
});

describe("endTextEdit", () => {
  it("removes a box left empty", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "" }));
    const c = endTextEdit(st, "t");
    expect(c).toBeDefined();
    expect(applyChange(st, c!).entities.t).toBeUndefined();
  });

  it("keeps a box with text, and leaves other shapes alone", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "Hi" }), addRect("r", { x: 0, y: 0, width: 1, height: 1 }));
    expect(endTextEdit(st, "t")).toBeUndefined();
    expect(endTextEdit(st, "r")).toBeUndefined();
    expect(endTextEdit(st, "missing")).toBeUndefined();
  });

  it("counts only-whitespace as empty", () => {
    const st = doc(addText("t", { x: 0, y: 0, width: 50, height: 12, text: " \n " }));
    expect(endTextEdit(st, "t")).toBeDefined();
  });
});

describe("textBoxAt: the text box under a point (double-click to edit)", () => {
  const st = doc(
    addText("a", { x: 0, y: 0, width: 100, height: 20, text: "A" }),
    addText("b", { x: 50, y: 10, width: 100, height: 20, text: "B" }),
    addText("turned", { x: 300, y: 0, width: 100, height: 20, text: "T", rotation: 45 }),
    addRect("r", { x: 500, y: 0, width: 50, height: 50 }),
  );
  const r = resolve(st);

  it("finds the topmost box containing the point, anywhere inside it", () => {
    expect(textBoxAt(r, [10, 10])).toBe("a");
    expect(textBoxAt(r, [60, 15])).toBe("b");
    expect(textBoxAt(r, [140, 25])).toBe("b");
  });

  it("goes by the turned box, not its bounds", () => {
    // 45° about (300, 0): (330, 40) is inside the turned box; (360, 10) is inside its bounds only.
    expect(textBoxAt(r, [330, 40])).toBe("turned");
    expect(textBoxAt(r, [360, 10])).toBeNull();
  });

  it("ignores other shapes, empty space and hidden or locked layers", () => {
    expect(textBoxAt(r, [520, 20])).toBeNull();
    expect(textBoxAt(r, [10, 200])).toBeNull();
    expect(textBoxAt(r, [10, 10], { hidden: new Set(["layer"]) })).toBeNull();
    expect(textBoxAt(r, [10, 10], { locked: new Set(["layer"]) })).toBeNull();
  });
});

describe("undo around editing a text box", () => {
  it("leaves nothing, in the drawing or the history, when a new box is abandoned empty", () => {
    const store = new DrawingStore();
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.markSaved();
    const emitted: Change[] = [];
    store.onEmit((c) => emitted.push(c));

    store.beginGesture();
    expect(store.gestureOpen).toBe(true);
    store.commit(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "" }));
    store.commit(setText(store.state, "t", "Hi")!);
    store.commit(setText(store.state, "t", "")!);
    store.abandonGesture();

    expect(store.gestureOpen).toBe(false);
    expect(store.state.entities.t).toBeUndefined();
    expect(store.dirty).toBe(false);
    expect(store.canRedo).toBe(false);
    // Undo goes straight to what came before: the rect.
    store.undo();
    expect(store.state.entities.r).toBeUndefined();
    // Peers saw the box come and go.
    expect(emitted.length).toBeGreaterThanOrEqual(6);
  });

  it("makes drawing a box and typing into it one undo step", () => {
    const store = new DrawingStore();
    store.beginGesture();
    store.commit(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "" }));
    store.commit(setText(store.state, "t", "Hi")!);
    store.endGesture();
    expect(store.state.entities.t).toBeDefined();
    store.undo();
    expect(store.state.entities.t).toBeUndefined();
    expect(store.canUndo).toBe(false);
  });

  it("deletes a box cleared by an edit in the edit's own step, so one undo brings it back", () => {
    const store = new DrawingStore();
    store.commit(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "Hi" }));
    store.beginGesture();
    store.commit(setText(store.state, "t", "")!);
    store.commit(endTextEdit(store.state, "t")!);
    store.endGesture();
    expect(store.state.entities.t).toBeUndefined();
    store.undo();
    expect(store.state.entities.t?.props.text).toBe("Hi");
  });

  it("does nothing when no gesture is open", () => {
    const store = new DrawingStore();
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.abandonGesture();
    expect(store.state.entities.r).toBeDefined();
    expect(store.canUndo).toBe(true);
  });
});

describe("editor state for a new box", () => {
  it("marks an edit as of a box just drawn, until editing stops", () => {
    const fresh = editorReducer({ ...initialEditor, selection: ["t"] }, { type: "editText", id: "t", fresh: true });
    expect([fresh.editText, fresh.editFresh]).toEqual(["t", true]);
    expect(editorReducer(fresh, { type: "editText", id: null }).editFresh).toBe(false);
    expect(editorReducer(fresh, { type: "select", ids: [] }).editFresh).toBe(false);
    expect(editorReducer(initialEditor, { type: "editText", id: "t" }).editFresh).toBe(false);
  });
});

describe("abandoning counts, so an Undo press that abandoned a box undoes nothing more", () => {
  it("counts each gesture abandoned, and only those", () => {
    const store = new DrawingStore();
    const before = store.abandoned;
    store.abandonGesture();
    expect(store.abandoned).toBe(before);
    store.beginGesture();
    store.commit(addText("t", { x: 0, y: 0, width: 50, height: 12, text: "" }));
    store.abandonGesture();
    expect(store.abandoned).toBe(before + 1);
  });
});
