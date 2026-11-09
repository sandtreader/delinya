import { describe, it, expect } from "vitest";
import type { Change } from "@sandtreader/collab/protocol";
import { BASE_LAYER_ID, KINDS, addDimension, addRadiusLabel, addRect, resolve } from "../../src/model";
import { drawingPrimitives } from "../../src/output/primitives";
import { exportDxf } from "../../src/output/dxf";
import { exportSvg } from "../../src/output/svg";
import { doc } from "../helpers";

const layer = (id: string, order: number, props: Record<string, unknown> = {}): Change =>
  ({ type: "entity_added", id, kind: KINDS.layer, props: { order, ...props } });

/** Carcass (base), Drill holes and Notes, each with a shape, dimension or label. */
function sample() {
  return resolve(doc(
    layer(BASE_LAYER_ID, 0, { name: "Carcass" }),
    layer("holes", 1, { name: "Drill holes" }),
    layer("notes", 2, { name: "Notes" }),
    addRect("a", { x: 0, y: 0, width: 100, height: 50 }),
    addRect("b", { x: 10, y: 10, width: 5, height: 5, layer: "holes" }),
    addRect("c", { x: 200, y: 0, width: 40, height: 40, r: [0, 5, 0, 0], layer: "notes" }),
    addDimension("da", "a", "width"),
    addDimension("dc", "c", "width"),
    addRadiusLabel("rc", "c", 1),
  ));
}

/** Each DXF entity's type and layer (group 8), in the ENTITIES section. */
function entityLayers(dxf: string): Array<[string, string]> {
  const lines = dxf.split(/\r?\n/).map((l) => l.trim());
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!]);
  const start = pairs.findIndex(([c, v]) => c === 2 && v === "ENTITIES");
  const out: Array<[string, string]> = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c === 0 && v === "ENDSEC") break;
    if (c === 0 && v !== "VERTEX" && v !== "SEQEND") out.push([v, ""]);
    if (c === 8 && out.length && out[out.length - 1]![1] === "") out[out.length - 1]![1] = v;
  }
  return out;
}

/** Names in the DXF LAYER table. */
function tableLayers(dxf: string): string[] {
  const lines = dxf.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i + 3 < lines.length; i += 2) {
    if (lines[i] === "0" && lines[i + 1] === "LAYER" && lines[i + 2] === "2") out.push(lines[i + 3]!);
  }
  return out;
}

/** The viewer hid Notes: output is what they see. */
const hidden = new Set(["notes"]);

describe("hidden layers in output", () => {
  it("leave out a hidden layer's shapes, dimensions and radius labels", () => {
    const prims = drawingPrimitives(sample(), { dimensions: true, textSize: 3, tick: 1, hidden });
    expect(prims.filter((p) => p.kind === "path" && p.role === "shape")).toHaveLength(2);
    expect(prims.filter((p) => p.kind === "text").map((p) => p.kind === "text" && p.text)).toEqual(["100"]);
  });

  it("export nothing when every layer is hidden", () => {
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 10, height: 10 })));
    const all = new Set([BASE_LAYER_ID]);
    expect(exportSvg(r, { dimensions: true, hidden: all })).toBeNull();
    expect(exportDxf(r, all)).toBeNull();
    expect(exportDxf(r)).not.toBeNull();
  });
});

describe("DXF layers", () => {
  it("puts each shape on a DXF layer named after its layer, and lists the visible layers", () => {
    const dxf = exportDxf(sample(), hidden)!;
    expect(entityLayers(dxf).map(([, l]) => l)).toEqual(["Carcass", "Drill_holes"]);
    expect(tableLayers(dxf)).toEqual(["Carcass", "Drill_holes"]);
  });

  it("names unnamed layers by number and keeps duplicate names apart", () => {
    const r = resolve(doc(
      layer(BASE_LAYER_ID, 0), layer("x", 1, { name: "Cut/Line" }), layer("y", 2, { name: "Cut Line" }),
      addRect("a", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("b", { x: 0, y: 0, width: 10, height: 10, layer: "x" }),
      addRect("c", { x: 0, y: 0, width: 10, height: 10, layer: "y" }),
    ));
    expect(tableLayers(exportDxf(r)!)).toEqual(["Layer_1", "Cut_Line", "Cut_Line_2"]);
  });

  it("uses Layer_1 for a drawing with no layers", () => {
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 10, height: 10 })));
    expect(tableLayers(exportDxf(r)!)).toEqual(["Layer_1"]);
  });
});
