import { describe, it, expect } from "vitest";
import { applyChange, emptyState } from "@sandtreader/collab/protocol";
import {
  DOCUMENT_ID, DrawingStore, KINDS, addRect, parseDrawing, resolve, serializeDrawing, setDocumentProps,
} from "../src/model";
import { doc } from "./helpers";

const BLANK = { title: "", author: "", revision: "", notes: "" };

describe("document properties", () => {
  it("resolve gives blank properties for a document without any", () => {
    expect(resolve(emptyState()).document).toEqual(BLANK);
    expect(resolve(doc(addRect("a", { x: 0, y: 0, width: 1, height: 1 }))).document).toEqual(BLANK);
  });

  it("the first set adds the singleton entity", () => {
    const change = setDocumentProps(emptyState(), { title: "Bench" });
    expect(change).toEqual({ type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: { title: "Bench" } });
    const state = applyChange(emptyState(), change!);
    expect(resolve(state).document).toEqual({ ...BLANK, title: "Bench" });
  });

  it("later sets change only the given props, and nothing if they are unchanged", () => {
    let state = applyChange(emptyState(), setDocumentProps(emptyState(), { title: "Bench", author: "PRC" })!);
    const change = setDocumentProps(state, { revision: "B", author: "PRC" });
    expect(change).toEqual({ type: "props_changed", id: DOCUMENT_ID, props: { revision: "B" } });
    state = applyChange(state, change!);
    expect(resolve(state).document).toEqual({ title: "Bench", author: "PRC", revision: "B", notes: "" });
    expect(setDocumentProps(state, { title: "Bench" })).toBeUndefined();
  });

  it("keeps notes verbatim, newlines included", () => {
    const notes = "Glue up after dry fit.\nOak, 18 mm.";
    const state = applyChange(emptyState(), setDocumentProps(emptyState(), { notes })!);
    expect(resolve(state).document.notes).toBe(notes);
  });

  it("undoes through the store like any edit", () => {
    const store = new DrawingStore();
    store.commit(setDocumentProps(store.state, { title: "One" })!);
    store.commit(setDocumentProps(store.state, { title: "Two" })!);
    store.undo();
    expect(store.resolved.document.title).toBe("One");
    store.undo();
    expect(store.resolved.document.title).toBe("");
  });

  it("treats non-string values as blank and reports them, never throwing", () => {
    const state = doc({ type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: { title: 42, author: "PRC" } });
    const r = resolve(state);
    expect(r.document).toEqual({ ...BLANK, author: "PRC" });
    expect(r.issues).toContainEqual(expect.objectContaining({ entity: DOCUMENT_ID, code: "bad-value" }));
  });

  it("is not a shape and survives a save/load round trip", () => {
    const state = applyChange(emptyState(), setDocumentProps(emptyState(), { title: "Bench", notes: "x" })!);
    expect(resolve(state).order).toEqual([]);
    const loaded = parseDrawing(serializeDrawing(state));
    expect(loaded.ok && resolve(loaded.state).document.title).toBe("Bench");
  });
});
