import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  BASE_LAYER_ID, DrawingStore, KINDS, addDimension, addLayer, addRect, deleteLayer, isSelectable, isVisible, layerChoice,
  moveLayer, resolve, setLayerColour, setLayerName, setShapesLayer,
} from "../src/model";
import { doc } from "./helpers";

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };

/** A stored layer, with a chosen order. */
const layer = (id: string, order: number, props: Record<string, unknown> = {}): Change =>
  ({ type: "entity_added", id, kind: KINDS.layer, props: { order, ...props } });

/** A 10 mm square, optionally on a layer. */
const sq = (id: string, on?: string) => addRect(id, { x: 0, y: 0, width: 10, height: 10, ...(on ? { layer: on } : {}) });

const ids = (st: DocState) => resolve(st).layers.map((l) => l.id);

describe("resolving layers", () => {
  it("gives a drawing with no layers one implicit base layer holding every shape", () => {
    const r = resolve(doc(sq("a")));
    expect(r.layers).toEqual([{ id: BASE_LAYER_ID, name: "", number: 1, colour: null }]);
    expect(r.shapes.a!.layer).toBe(BASE_LAYER_ID);
  });

  it("numbers layers by order, ties by ID", () => {
    const r = resolve(doc(layer("top", 5, { name: "Top" }), layer(BASE_LAYER_ID, 0), layer("b", 2), layer("a", 2)));
    expect(r.layers.map((l) => [l.id, l.number])).toEqual([[BASE_LAYER_ID, 1], ["a", 2], ["b", 3], ["top", 4]]);
    expect(r.layers[3]!.name).toBe("Top");
  });

  it("draws shapes in layer order, keeping document order within a layer", () => {
    const st = doc(layer(BASE_LAYER_ID, 0), layer("top", 1), sq("a", "top"), sq("b"), sq("c", "top"), sq("d", BASE_LAYER_ID));
    expect(resolve(st).order).toEqual(["b", "d", "a", "c"]);
  });

  it("puts a shape on a missing layer on the base layer, or the first layer if the base is gone", () => {
    expect(resolve(doc(layer(BASE_LAYER_ID, 0), layer("x", 1), sq("s", "ghost"))).shapes.s!.layer).toBe(BASE_LAYER_ID);
    const noBase = resolve(doc(layer("x", 1), layer("y", 0), sq("s"), sq("t", "ghost")));
    expect(noBase.shapes.s!.layer).toBe("y");
    expect(noBase.shapes.t!.layer).toBe("y");
  });

});

describe("isVisible / isSelectable", () => {
  // Hiding and locking are each viewer's own choice, held in editor state: never in the document.
  const st = doc(layer("h", 0), layer("l", 1), layer("n", 2), sq("onH", "h"), sq("onL", "l"), sq("onN", "n"));
  const r = resolve(st);
  const view = { hidden: new Set(["h"]), locked: new Set(["l"]) };

  it("hides shapes on a layer this viewer has hidden", () => {
    expect(["onH", "onL", "onN", "nope"].map((id) => isVisible(r, id, view.hidden))).toEqual([false, true, true, false]);
    expect(isVisible(r, "onH", new Set())).toBe(true);
  });

  it("lets you select only shapes on a layer you have neither hidden nor locked", () => {
    expect(["onH", "onL", "onN", "nope"].map((id) => isSelectable(r, id, view))).toEqual([false, false, true, false]);
  });
});

describe("addLayer", () => {
  it("adds a layer after the last, making the implicit base layer real first", () => {
    const st = apply(doc(sq("a")), addLayer(doc(sq("a")), "L2", "Holes"));
    expect(st.entities[BASE_LAYER_ID]!.kind).toBe(KINDS.layer);
    const r = resolve(st);
    expect(r.layers.map((l) => [l.id, l.number, l.name])).toEqual([[BASE_LAYER_ID, 1, ""], ["L2", 2, "Holes"]]);
    expect(r.shapes.a!.layer).toBe(BASE_LAYER_ID);
  });

  it("only adds the new layer once the base is real", () => {
    const st = apply(doc(), addLayer(doc(), "L2"));
    const c = addLayer(st, "L3");
    expect(c).toMatchObject({ type: "entity_added", id: "L3", kind: KINDS.layer });
    expect(ids(apply(st, c))).toEqual([BASE_LAYER_ID, "L2", "L3"]);
  });
});

describe("setLayerName", () => {
  const st = doc(layer(BASE_LAYER_ID, 0), layer("x", 1, { name: "Old" }));

  it("renames, or does nothing if unchanged or unknown", () => {
    expect(setLayerName(st, "x", "New")).toEqual({ type: "props_changed", id: "x", props: { name: "New" } });
    expect(setLayerName(st, "x", "Old")).toBeUndefined();
    expect(setLayerName(st, "ghost", "Boo")).toBeUndefined();
  });

  it("makes the implicit base layer real to name it", () => {
    const after = apply(doc(sq("a")), setLayerName(doc(sq("a")), BASE_LAYER_ID, "Carcass"));
    expect(resolve(after).layers).toEqual([{ id: BASE_LAYER_ID, name: "Carcass", number: 1, colour: null }]);
  });
});

describe("setLayerColour", () => {
  it("clears a bad stored colour, and undoes like any edit", () => {
    const st = doc(layer(BASE_LAYER_ID, 0, { colour: "green" }));
    const c = setLayerColour(st, BASE_LAYER_ID, null);
    expect(c).toEqual({ type: "props_changed", id: BASE_LAYER_ID, props: { colour: null } });
    expect("colour" in apply(st, c).entities[BASE_LAYER_ID]!.props).toBe(false);

    const store = new DrawingStore();
    store.commit(layer(BASE_LAYER_ID, 0));
    store.commit(setLayerColour(store.state, BASE_LAYER_ID, "#1e8c1e")!);
    expect(store.resolved.layers[0]!.colour).toBe("#1e8c1e");
    store.undo();
    expect(store.resolved.layers[0]!.colour).toBeNull();
  });
});

describe("moveLayer", () => {
  const st = doc(layer("A", 0), layer("B", 1), layer("C", 2));

  it("moves a layer to a new position by changing only its own order", () => {
    const c = moveLayer(st, "C", 0);
    expect(c).toMatchObject({ type: "props_changed", id: "C" });
    expect(ids(apply(st, c))).toEqual(["C", "A", "B"]);
    expect(ids(apply(st, moveLayer(st, "A", 2)))).toEqual(["B", "C", "A"]);
    expect(ids(apply(st, moveLayer(st, "A", 1)))).toEqual(["B", "A", "C"]);
    expect(ids(apply(st, moveLayer(st, "C", 1)))).toEqual(["A", "C", "B"]);
  });

  it("renumbers every layer when the gap it is dropped into has no room (two peers added layers at once)", () => {
    const tied = doc(layer("A", 0), layer("B", 1), layer("C", 1));
    expect(ids(tied)).toEqual(["A", "B", "C"]);
    expect(ids(apply(tied, moveLayer(tied, "A", 1)))).toEqual(["B", "A", "C"]);
  });

  it("does nothing for the same place or an unknown layer", () => {
    expect(moveLayer(st, "B", 1)).toBeUndefined();
    expect(moveLayer(st, "ghost", 0)).toBeUndefined();
  });
});

describe("setShapesLayer / layerChoice", () => {
  const st = doc(layer(BASE_LAYER_ID, 0), layer("x", 1), sq("a"), sq("b", "x"), sq("c", "x"));

  it("moves shapes to a layer, skipping those already on it", () => {
    const c = setShapesLayer(st, ["a", "b", "nope"], "x");
    expect(c).toEqual({ type: "props_changed", id: "a", props: { layer: "x" } });
    expect(setShapesLayer(st, ["b", "c"], "x")).toBeUndefined();
    expect(setShapesLayer(st, ["a"], "ghost")).toBeUndefined();
  });

  it("names the selection's layer, or undefined if they're mixed", () => {
    const r = resolve(st);
    expect(layerChoice(r, ["b", "c"])).toBe("x");
    expect(layerChoice(r, ["a", "b"])).toBeUndefined();
    expect(layerChoice(r, [])).toBeUndefined();
  });
});

describe("deleteLayer", () => {
  const st = doc(layer(BASE_LAYER_ID, 0), layer("x", 1), sq("a"), sq("b", "x"), addDimension("db", "b", "width"), sq("c", "x"));

  it("deletes the layer with its shapes and their dimensions, in one undoable change", () => {
    const after = apply(st, deleteLayer(st, "x"));
    expect(Object.keys(after.entities).sort()).toEqual(["a", BASE_LAYER_ID].sort());
  });

  it("deletes shapes with no layer along with the base layer", () => {
    const after = apply(st, deleteLayer(st, BASE_LAYER_ID));
    expect(Object.keys(after.entities).sort()).toEqual(["b", "c", "db", "x"]);
  });

  it("won't delete the only layer", () => {
    expect(deleteLayer(doc(sq("a")), BASE_LAYER_ID)).toBeUndefined();
    expect(deleteLayer(doc(layer("only", 0), sq("a")), "only")).toBeUndefined();
    expect(deleteLayer(st, "ghost")).toBeUndefined();
  });
});
