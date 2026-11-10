import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, KINDS, LAYER_COLOURS, addRect, resolve, setLayerColour } from "../src/model";
import { doc } from "./helpers";

// Each layer can have a line colour for its shapes: part of the drawing,
// so saved, synced and undoable (unlike hide and lock, which are local).

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };
const layer = (id: string, order: number, props: Record<string, unknown> = {}): Change =>
  ({ type: "entity_added", id, kind: KINDS.layer, props: { order, ...props } });
const GREEN = LAYER_COLOURS.find((c) => c.name === "Green")!.hex!;

describe("layer colours", () => {
  it("offer a small palette, the default ink first", () => {
    expect(LAYER_COLOURS[0]).toMatchObject({ name: "Default", hex: null });
    expect(LAYER_COLOURS.length).toBeGreaterThanOrEqual(6);
    for (const c of LAYER_COLOURS.slice(1)) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(LAYER_COLOURS.map((c) => c.hex)).size).toBe(LAYER_COLOURS.length);
  });

  it("default to none, so shapes draw in the usual ink", () => {
    expect(resolve(doc(addRect("a", { x: 0, y: 0, width: 1, height: 1 }))).layers[0]!.colour).toBeNull();
  });

  it("are set on the layer, and cleared back to the default", () => {
    const st = doc(layer(BASE_LAYER_ID, 0), layer("x", 1));
    const coloured = apply(st, setLayerColour(st, "x", GREEN));
    expect(coloured.entities.x!.props.colour).toBe(GREEN);
    expect(resolve(coloured).layers.map((l) => l.colour)).toEqual([null, GREEN]);
    expect(setLayerColour(coloured, "x", GREEN)).toBeUndefined();
    const cleared = apply(coloured, setLayerColour(coloured, "x", null));
    expect(resolve(cleared).layers[1]!.colour).toBeNull();
    expect(setLayerColour(st, "x", null)).toBeUndefined();
    expect(setLayerColour(st, "ghost", GREEN)).toBeUndefined();
  });

  it("makes the implicit base layer real to colour it", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 1, height: 1 }));
    expect(resolve(apply(st, setLayerColour(st, BASE_LAYER_ID, GREEN))).layers).toEqual([{ id: BASE_LAYER_ID, name: "", number: 1, colour: GREEN }]);
  });

  it("refuses a colour that isn't #rrggbb, and a bad stored one draws in the default, with an issue", () => {
    const st = doc(layer(BASE_LAYER_ID, 0));
    expect(setLayerColour(st, BASE_LAYER_ID, "green")).toBeUndefined();
    const r = resolve(doc(layer(BASE_LAYER_ID, 0, { colour: "green" })));
    expect(r.layers[0]!.colour).toBeNull();
    expect(r.issues.some((i) => i.entity === BASE_LAYER_ID && i.code === "bad-value")).toBe(true);
  });
});
