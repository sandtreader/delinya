import { describe, it, expect } from "vitest";
import type { Change } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, KINDS, LAYER_COLOURS, addDimension, addRect, resolve } from "../../src/model";
import { drawingPrimitives } from "../../src/output/primitives";
import { exportSvg } from "../../src/output/svg";
import { exportDxf } from "../../src/output/dxf";
import { doc } from "../helpers";

// Output follows what you see: shapes print in their layer's colour.

const layer = (id: string, order: number, props: Record<string, unknown> = {}): Change =>
  ({ type: "entity_added", id, kind: KINDS.layer, props: { order, ...props } });
const GREEN = LAYER_COLOURS.find((c) => c.name === "Green")!;

const r = resolve(doc(
  layer(BASE_LAYER_ID, 0, { name: "Carcass" }),
  layer("holes", 1, { name: "Holes", colour: GREEN.hex }),
  addRect("a", { x: 0, y: 0, width: 100, height: 50 }),
  addRect("b", { x: 10, y: 10, width: 5, height: 5, layer: "holes" }),
  addDimension("db", "b", "width"),
));

describe("layer colours in output", () => {
  it("colour a layer's shapes, leaving default layers and dimensions as they were", () => {
    const prims = drawingPrimitives(r, { dimensions: true, textSize: 3, tick: 1 });
    const shapes = prims.filter((p) => p.kind === "path" && p.role === "shape");
    expect(shapes.map((p) => p.colour)).toEqual([undefined, GREEN.hex]);
    expect(prims.filter((p) => p.role === "dimension").every((p) => p.colour === undefined)).toBe(true);
  });

  it("SVG strokes the coloured layer's shapes in its colour", () => {
    const svg = exportSvg(r, { dimensions: false })!;
    expect(svg).toContain(`stroke="${GREEN.hex}"`);
    expect(svg.match(new RegExp(`stroke="${GREEN.hex}"`, "g"))).toHaveLength(1);
  });

  it("DXF gives each layer its colour number (7 for the default ink)", () => {
    const dxf = exportDxf(r)!;
    const lines = dxf.split(/\r?\n/).map((l) => l.trim());
    const colourOf = (name: string) => {
      const i = lines.findIndex((l, k) => l === name && lines[k - 1] === "2" && lines[k - 2] === "LAYER");
      const j = lines.indexOf("62", i);
      return Number(lines[j + 1]);
    };
    expect(colourOf("Carcass")).toBe(7);
    expect(colourOf("Holes")).toBe(GREEN.aci);
  });
});
