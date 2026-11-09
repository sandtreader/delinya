import { describe, it, expect } from "vitest";
import { emptyState } from "@sandtreader/collab/protocol";
import {
  DrawingStore, FILE_FORMAT, FILE_VERSION, addCircle, addDimension, addLine, addRadiusLabel,
  addRect, addVariable, linkSpacing, parseDrawing, resolve, serializeDrawing,
} from "../src/model";
import { doc } from "./helpers";

/** A document using every kind, including refs and spacing. */
function everything() {
  return doc(
    addVariable("v", 40, "leg"),
    addRect("a", { x: 0, y: 0, width: { ref: "v" }, height: 30, r: [2, { ref: "v" }, 0, 5] }),
    addRect("b", { x: 100, y: 0, width: { ref: "v" }, height: 30 }),
    addCircle("c", { cx: 50, cy: 15, diameter: 12 }),
    addLine("l", { x: 0, y: 50, length: 140, angle: -30 }),
    addDimension("dw", "a", "width"),
    addRadiusLabel("rl", "a", 3),
    linkSpacing("s", "a", "b", ["c"], "x", "centres"),
  );
}

describe("serializeDrawing", () => {
  it("wraps the document in a format/version envelope as readable JSON", () => {
    const text = serializeDrawing(everything());
    const json = JSON.parse(text);
    expect(json.format).toBe(FILE_FORMAT);
    expect(json.format).toBe("delinya");
    expect(json.version).toBe(FILE_VERSION);
    expect(json.doc).toEqual(everything());
    expect(text).toContain("\n");          // pretty-printed, diffable
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("parseDrawing", () => {
  it("round-trips every kind exactly", () => {
    const state = everything();
    const result = parseDrawing(serializeDrawing(state));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(state);
    expect(resolve(result.state)).toEqual(resolve(state));
  });

  it("round-trips an empty document", () => {
    const result = parseDrawing(serializeDrawing(emptyState()));
    expect(result).toEqual({ ok: true, state: emptyState() });
  });

  it("does not share structure with the input it was given", () => {
    const state = everything();
    const result = parseDrawing(serializeDrawing(state));
    if (!result.ok) throw new Error(result.error);
    (result.state.entities.a!.props as Record<string, unknown>).x = 999;
    expect(state.entities.a!.props.x).toBe(0);
  });

  it("keeps entities of kinds it does not know, for forward compatibility", () => {
    const text = JSON.stringify({
      format: "delinya", version: FILE_VERSION,
      doc: { entities: { t: { kind: "text", props: { x: 1, body: "hi" } } } },
    });
    const result = parseDrawing(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.entities.t).toEqual({ kind: "text", props: { x: 1, body: "hi" } });
  });

  it("ignores unknown top-level keys", () => {
    const text = JSON.stringify({ format: "delinya", version: FILE_VERSION, app: "0.0.1", doc: { entities: {} } });
    expect(parseDrawing(text).ok).toBe(true);
  });

  it("rejects bad input with a message and never throws", () => {
    const bad: Array<[string, string]> = [
      ["not json", "not json {"],
      ["not an object", "[1, 2]"],
      ["null", "null"],
      ["wrong format", JSON.stringify({ format: "synflo", version: 1, doc: { entities: {} } })],
      ["missing format", JSON.stringify({ version: 1, doc: { entities: {} } })],
      ["missing version", JSON.stringify({ format: "delinya", doc: { entities: {} } })],
      ["version not a number", JSON.stringify({ format: "delinya", version: "1", doc: { entities: {} } })],
      ["missing doc", JSON.stringify({ format: "delinya", version: 1 })],
      ["entities not an object", JSON.stringify({ format: "delinya", version: 1, doc: { entities: [] } })],
      ["entity not an object", JSON.stringify({ format: "delinya", version: 1, doc: { entities: { a: 3 } } })],
      ["entity without kind", JSON.stringify({ format: "delinya", version: 1, doc: { entities: { a: { props: {} } } } })],
      ["kind not a string", JSON.stringify({ format: "delinya", version: 1, doc: { entities: { a: { kind: 1, props: {} } } } })],
      ["props not an object", JSON.stringify({ format: "delinya", version: 1, doc: { entities: { a: { kind: "rect", props: [] } } } })],
    ];
    for (const [label, text] of bad) {
      let result: ReturnType<typeof parseDrawing> | undefined;
      expect(() => { result = parseDrawing(text); }, label).not.toThrow();
      expect(result!.ok, label).toBe(false);
      if (result && !result.ok) expect(result.error.length, label).toBeGreaterThan(0);
    }
  });

  it("refuses files from a newer version and says so", () => {
    const result = parseDrawing(JSON.stringify({ format: "delinya", version: FILE_VERSION + 1, doc: { entities: {} } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer/i);
  });

  it("loads into a store as a fresh document with no undo history", () => {
    const store = new DrawingStore();
    store.commit(addRect("old", { x: 0, y: 0, width: 1, height: 1 }));
    const result = parseDrawing(serializeDrawing(everything()));
    if (!result.ok) throw new Error(result.error);
    store.replace(result.state);
    expect(store.state).toEqual(everything());
    expect(store.canUndo).toBe(false);
  });
});

describe("DrawingStore dirty tracking", () => {
  const rect = (id: string) => addRect(id, { x: 0, y: 0, width: 10, height: 10 });

  it("starts clean and becomes dirty on a local edit", () => {
    const store = new DrawingStore();
    expect(store.dirty).toBe(false);
    store.commit(rect("a"));
    expect(store.dirty).toBe(true);
  });

  it("markSaved makes it clean and notifies listeners", () => {
    const store = new DrawingStore();
    store.commit(rect("a"));
    let notified = 0;
    store.subscribe(() => { notified++; });
    store.markSaved();
    expect(store.dirty).toBe(false);
    expect(notified).toBe(1);
  });

  it("is clean again after undoing back to the saved point, dirty after redoing past it", () => {
    const store = new DrawingStore();
    store.commit(rect("a"));
    store.markSaved();
    store.commit(rect("b"));
    expect(store.dirty).toBe(true);
    store.undo();
    expect(store.dirty).toBe(false);
    store.redo();
    expect(store.dirty).toBe(true);
  });

  it("is dirty after undoing past the saved point, clean after redoing back to it", () => {
    const store = new DrawingStore();
    store.commit(rect("a"));
    store.commit(rect("b"));
    store.markSaved();
    store.undo();
    expect(store.dirty).toBe(true);
    store.redo();
    expect(store.dirty).toBe(false);
  });

  it("stays dirty when a new edit replaces the undone saved branch", () => {
    const store = new DrawingStore();
    store.commit(rect("a"));
    store.markSaved();
    store.undo();
    store.commit(rect("b"));
    expect(store.dirty).toBe(true);
  });

  it("is clean after undoing every edit made since saving a freshly loaded document", () => {
    const store = new DrawingStore();
    store.replace(everything());
    store.markSaved();
    store.commit(rect("a"));
    expect(store.dirty).toBe(true);
    store.undo();
    expect(store.dirty).toBe(false);
  });

  it("is dirty while a drag gesture is open", () => {
    const store = new DrawingStore();
    store.commit(rect("a"));
    store.markSaved();
    store.commit({ type: "props_changed", id: "a", props: { x: 1 }, gestureStart: true });
    expect(store.dirty).toBe(true);
    store.commit({ type: "props_changed", id: "a", props: { x: 2 }, gestureEnd: true });
    expect(store.dirty).toBe(true);
    store.undo();
    expect(store.dirty).toBe(false);
  });

  it("is dirty after a remote change, which undo cannot take back", () => {
    const store = new DrawingStore();
    store.markSaved();
    store.applyRemote(rect("r"));
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
  });

  it("is dirty after replace until marked saved", () => {
    const store = new DrawingStore();
    store.replace(everything());
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
  });

  it("is clean after undoing to a saved point whose entry fell off a limited history", () => {
    const store = new DrawingStore({ historyLimit: 2 });
    store.commit(rect("a"));
    store.markSaved();                // saved {a}
    store.commit(rect("b"));
    store.commit(rect("c"));          // history now [b, c]; a's entry dropped
    store.undo();
    store.undo();
    expect(store.canUndo).toBe(false);
    expect(Object.keys(store.state.entities)).toEqual(["a"]);
    expect(store.dirty).toBe(false);
  });

  it("is dirty when the oldest undo still stops short of the saved point", () => {
    const store = new DrawingStore({ historyLimit: 2 });
    store.commit(rect("a"));
    store.markSaved();                // saved {a}
    store.commit(rect("b"));
    store.commit(rect("c"));
    store.commit(rect("d"));          // history [c, d]; b's entry dropped too
    store.undo();
    store.undo();
    expect(store.canUndo).toBe(false);
    expect(Object.keys(store.state.entities)).toEqual(["a", "b"]);
    expect(store.dirty).toBe(true);
  });
});
