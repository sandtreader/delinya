import { describe, it, expect } from "vitest";
import type { Change } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, KINDS, addRect, linkAlign, resolve } from "../src/model";
import { snapPoint } from "../src/canvas/snap";
import { linkGuides } from "../src/view/linkGuides";
import { dropIndex } from "../src/view/reorder";
import { currentLayer, editorReducer, initialEditor, selectableOnly } from "../src/app/editor";
import { doc } from "./helpers";

const layer = (id: string, order: number, props: Record<string, unknown> = {}): Change =>
  ({ type: "entity_added", id, kind: KINDS.layer, props: { order, ...props } });

const st = doc(
  layer(BASE_LAYER_ID, 0),
  layer("hid", 1),
  layer("lock", 2),
  addRect("base", { x: 0, y: 0, width: 10, height: 10 }),
  addRect("h", { x: 100, y: 0, width: 10, height: 10, layer: "hid" }),
  addRect("l", { x: 200, y: 0, width: 10, height: 10, layer: "lock" }),
);
const r = resolve(st);
/** This viewer's choice, in editor state. */
const view = { hidden: new Set(["hid"]), locked: new Set(["lock"]) };

describe("snapping with layers", () => {
  it("ignores shapes on hidden layers", () => {
    expect(snapPoint(r, [101, 1], 3, new Set(), 5, view.hidden).snap).toBeNull();
    expect(snapPoint(r, [101, 1], 3, new Set(), 5).snap?.point).toEqual([100, 0]);
  });

  it("still snaps to shapes on locked layers", () => {
    expect(snapPoint(r, [201, 1], 3, new Set(), 5, view.hidden).snap?.point).toEqual([200, 0]);
  });
});

describe("link guides with layers", () => {
  it("skips a link with a shape on a hidden layer", () => {
    const linked = doc(
      layer(BASE_LAYER_ID, 0), layer("hid", 1),
      addRect("a", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("b", { x: 0, y: 50, width: 10, height: 10 }),
      addRect("h", { x: 0, y: 100, width: 10, height: 10, layer: "hid" }),
      linkAlign("ab", "a", ["b"], "x", "start"),
      linkAlign("ah", "a", ["h"], "y", "start"),
    );
    expect(linkGuides(linked, resolve(linked), [], 2, view.hidden).map((g) => g.link)).toEqual(["ab"]);
    expect(linkGuides(linked, resolve(linked), [], 2).map((g) => g.link)).toEqual(["ab", "ah"]);
  });
});

describe("hiding and locking", () => {
  it("toggle in editor state, never the document", () => {
    let e = editorReducer(initialEditor, { type: "toggleLayer", id: "hid", flag: "hidden" });
    e = editorReducer(e, { type: "toggleLayer", id: "lock", flag: "locked" });
    expect([...e.layerView.hidden]).toEqual(["hid"]);
    expect([...e.layerView.locked]).toEqual(["lock"]);
    e = editorReducer(e, { type: "toggleLayer", id: "hid", flag: "hidden" });
    expect([...e.layerView.hidden]).toEqual([]);
  });

  it("all clear for a new or opened drawing, with the current layer", () => {
    let e = editorReducer(initialEditor, { type: "toggleLayer", id: "hid", flag: "hidden" });
    e = editorReducer(e, { type: "layer", id: "lock" });
    e = editorReducer(e, { type: "resetLayers" });
    expect(e.layerView.hidden.size + e.layerView.locked.size).toBe(0);
    expect(e.layer).toBeNull();
  });
});

describe("current layer", () => {
  it("is chosen in editor state, never the document", () => {
    expect(editorReducer(initialEditor, { type: "layer", id: "lock" }).layer).toBe("lock");
  });

  it("falls back to the first layer when unset or gone", () => {
    expect(currentLayer(r, "lock")).toBe("lock");
    expect(currentLayer(r, null)).toBe(BASE_LAYER_ID);
    expect(currentLayer(r, "deleted")).toBe(BASE_LAYER_ID);
    expect(currentLayer(resolve(doc()), null)).toBe(BASE_LAYER_ID);
  });
});

describe("selectableOnly", () => {
  it("drops shapes that are hidden, locked or gone from a selection", () => {
    expect(selectableOnly(r, ["base", "h", "l", "gone"], view)).toEqual(["base"]);
    expect(selectableOnly(r, ["base", "h", "l", "gone"], initialEditor.layerView)).toEqual(["base", "h", "l"]);
  });
});

describe("dropIndex", () => {
  // Button centres down the palette.
  const centres = [10, 40, 70];

  it("counts the other buttons above the pointer", () => {
    expect(dropIndex(centres, 0, 50)).toBe(1);
    expect(dropIndex(centres, 0, 80)).toBe(2);
    expect(dropIndex(centres, 2, 5)).toBe(0);
    expect(dropIndex(centres, 2, 25)).toBe(1);
    expect(dropIndex(centres, 1, 41)).toBe(1);
  });
});
