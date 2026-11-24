import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyChange, type DocState } from "@sandtreader/collab/protocol";
import {
  BASE_LAYER_ID, FILL_OPACITY, HATCH_PATTERNS, LAYER_FILLS, addCircle, addLayer, addLine, addPolyline, addRect, addText, isFillable, isHatchPattern, layerRuns,
  propsChanged, resolve, setLayerFill, setLayerHatch, type PolyNode,
} from "../src/model";
import { drawingPrimitives } from "../src/output/primitives";
import { HATCH_SPACING, hatchMarks, hatchTile } from "../src/output/hatch";
import type { Primitive } from "../src/output/types";
import { FillPicker } from "../src/panels/LayerPalette";
import { doc } from "./helpers";

// Fills are a layer's, like its line colour: a very light pastel, a simple
// pattern (dots, grid, 45° lines, crosshatch) in the layer's ink, or both,
// behind rectangles, circles and closed paths. Fills are indicative, so
// they are always semi-transparent: lines behind still show, overlaps
// deepen. Pattern spacing and angle are fixed, in paper mm (as line widths
// are), and anchored to the origin so neighbouring shapes' patterns line up.
// DXF leaves fills out.

const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });
const HEX = /^#[0-9a-f]{6}$/;

/** Base layer ("layer") at the back, "front" in front of it. */
function twoLayers(): DocState {
  let s = doc(addRect("r", { x: 0, y: 0, width: 40, height: 20 }));
  s = applyChange(s, addLayer(s, "front"));
  return s;
}

const apply = (s: DocState, c: ReturnType<typeof setLayerFill>) => applyChange(s, c!);

describe("the fill palette and patterns", () => {
  it("offers no fill first, then light pastels", () => {
    expect(LAYER_FILLS[0]).toEqual({ name: "None", hex: null });
    expect(LAYER_FILLS.length).toBeGreaterThanOrEqual(6);
    const names = new Set(LAYER_FILLS.map((f) => f.name));
    expect(names.size).toBe(LAYER_FILLS.length);
    for (const f of LAYER_FILLS.slice(1)) {
      expect(f.hex, f.name).toMatch(HEX);
      // As seen on white paper at the fill's opacity: very light.
      const seen = [1, 3, 5].map((i) => parseInt(f.hex!.slice(i, i + 2), 16) * FILL_OPACITY + 255 * (1 - FILL_OPACITY));
      expect(Math.min(...seen), f.name).toBeGreaterThanOrEqual(170);
    }
  });

  it("is always see-through", () => {
    expect(FILL_OPACITY).toBeGreaterThan(0.1);
    expect(FILL_OPACITY).toBeLessThan(0.7);
  });

  it("has four simple patterns", () => {
    expect(HATCH_PATTERNS.map((p) => p.id)).toEqual(["dots", "grid", "lines", "crosshatch"]);
    for (const p of HATCH_PATTERNS) expect(isHatchPattern(p.id)).toBe(true);
    expect(isHatchPattern("zigzag")).toBe(false);
    expect(isHatchPattern(null)).toBe(false);
  });
});

describe("setLayerFill / setLayerHatch", () => {
  it("sets and clears a layer's fill and pattern, independently", () => {
    let s = twoLayers();
    s = apply(s, setLayerFill(s, "front", LAYER_FILLS[2]!.hex));
    s = apply(s, setLayerHatch(s, "front", "crosshatch"));
    expect(s.entities.front!.props).toMatchObject({ fill: LAYER_FILLS[2]!.hex, hatch: "crosshatch" });
    s = apply(s, setLayerFill(s, "front", null));
    expect(resolve(s).layers[1]).toMatchObject({ fill: null, hatch: "crosshatch" });
    s = apply(s, setLayerHatch(s, "front", null));
    expect(resolve(s).layers[1]).toMatchObject({ fill: null, hatch: null });
  });

  it("does nothing if unchanged, unknown, or not a colour or pattern", () => {
    const s = twoLayers();
    expect(setLayerFill(s, "front", null)).toBeUndefined();
    expect(setLayerHatch(s, "front", null)).toBeUndefined();
    expect(setLayerFill(s, "nope", "#ffcccc")).toBeUndefined();
    expect(setLayerHatch(s, "nope", "dots")).toBeUndefined();
    expect(setLayerFill(s, "front", "pink")).toBeUndefined();
    expect(setLayerHatch(s, "front", "zigzag" as never)).toBeUndefined();
    const filled = apply(s, setLayerHatch(s, "front", "dots"));
    expect(setLayerHatch(filled, "front", "dots")).toBeUndefined();
  });

  it("makes the implicit base layer real to hold them", () => {
    const s = doc(addRect("r", { x: 0, y: 0, width: 40, height: 20 }));
    const after = apply(s, setLayerHatch(s, BASE_LAYER_ID, "lines"));
    expect(after.entities[BASE_LAYER_ID]).toMatchObject({ kind: "layer", props: { order: 0, hatch: "lines" } });
  });
});

describe("resolving a layer's fill", () => {
  it("is none by default", () => {
    for (const l of resolve(twoLayers()).layers) expect(l).toMatchObject({ fill: null, hatch: null });
  });

  it("reports bad values and ignores them", () => {
    let s = twoLayers();
    s = applyChange(s, propsChanged("front", { fill: "pink", hatch: "zigzag" }));
    const r = resolve(s);
    expect(r.layers[1]).toMatchObject({ fill: null, hatch: null });
    expect(r.issues.filter((i) => i.entity === "front" && i.code === "bad-value")).toHaveLength(2);
  });
});

describe("isFillable", () => {
  it("is rectangles, circles and closed paths", () => {
    const s = doc(
      addRect("r", { x: 0, y: 0, width: 40, height: 20 }),
      addCircle("c", { cx: 0, cy: 50, diameter: 10 }),
      addPolyline("closed", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)], closed: true }),
      addPolyline("open", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)] }),
      addLine("l", { x: 0, y: 0, length: 10, angle: 0 }),
      addText("t", { x: 0, y: 0, width: 30, height: 10, text: "hi" }),
    );
    const r = resolve(s);
    const fillable = Object.keys(r.shapes).filter((id) => isFillable(r.shapes[id]!)).sort();
    expect(fillable).toEqual(["c", "closed", "r"]);
  });
});

describe("drawing primitives with fills", () => {
  /** Back layer: a rect, a line, an open and a closed path, a text box; front layer: a circle. */
  function drawing(back: { fill?: string | null; hatch?: "dots" | "lines" | null; colour?: string }): DocState {
    let s = doc(
      addRect("r", { x: 0, y: 0, width: 40, height: 20 }),
      addLine("l", { x: 0, y: 30, length: 10, angle: 0 }),
      addPolyline("open", { nodes: [cusp(0, 40), cusp(10, 40), cusp(10, 50)] }),
      addPolyline("closed", { nodes: [cusp(20, 40), cusp(30, 40), cusp(30, 50)], closed: true }),
      addText("t", { x: 50, y: 0, width: 30, height: 10, text: "hi" }),
    );
    s = applyChange(s, addLayer(s, "front"));
    s = applyChange(s, addCircle("c", { cx: 0, cy: 80, diameter: 10, layer: "front" }));
    if (back.fill !== undefined) s = apply(s, setLayerFill(s, BASE_LAYER_ID, back.fill));
    if (back.hatch !== undefined) s = apply(s, setLayerHatch(s, BASE_LAYER_ID, back.hatch));
    if (back.colour) s = applyChange(s, propsChanged(BASE_LAYER_ID, { colour: back.colour }));
    return s;
  }
  const prims = (s: DocState, hidden?: Set<string>) => drawingPrimitives(resolve(s), { dimensions: false, textSize: 3, tick: 1, hidden });
  const fills = (ps: Primitive[]) => ps.filter((p) => p.kind === "fill");

  it("adds none for a layer with no fill", () => {
    expect(fills(prims(drawing({})))).toEqual([]);
  });

  it("fills the layer's rectangles, circles and closed paths, under all its lines", () => {
    const pink = LAYER_FILLS[1]!.hex!;
    const ps = prims(drawing({ fill: pink }));
    const r = resolve(drawing({ fill: pink }));
    const f = fills(ps);
    expect(f.map((p) => p.kind === "fill" && p.path)).toEqual([r.shapes.r!.path, r.shapes.closed!.path]);
    for (const p of f) expect(p).toMatchObject({ kind: "fill", fill: pink });
    for (const p of f) expect(p).not.toHaveProperty("hatch");
    // Every fill before the first of the back layer's strokes.
    const firstStroke = ps.findIndex((p) => p.kind !== "fill");
    expect(ps.slice(0, f.length).every((p) => p.kind === "fill")).toBe(true);
    expect(firstStroke).toBe(f.length);
  });

  it("gives a pattern the layer's ink", () => {
    const f = fills(prims(drawing({ hatch: "lines", colour: "#1e8c1e" })));
    expect(f).toHaveLength(2);
    for (const p of f) {
      expect(p).toMatchObject({ kind: "fill", hatch: "lines", colour: "#1e8c1e" });
      expect(p).not.toHaveProperty("fill");
    }
  });

  it("keeps each layer's fills with that layer: a front layer's go over the back layer's lines", () => {
    let s = drawing({});
    s = apply(s, setLayerHatch(s, "front", "dots"));
    const ps = prims(s);
    const circleFill = ps.findIndex((p) => p.kind === "fill");
    const lastBack = ps.findIndex((p) => p.kind === "path" && p.path === resolve(s).shapes.closed!.path);
    expect(circleFill).toBeGreaterThan(lastBack);
    expect(ps[circleFill + 1]).toMatchObject({ kind: "path", path: resolve(s).shapes.c!.path });
  });

  it("leaves hidden layers' fills out", () => {
    expect(fills(prims(drawing({ fill: "#ffcccc" }), new Set([BASE_LAYER_ID])))).toEqual([]);
  });
});

describe("hatchMarks", () => {
  const b = { minX: 3, minY: 4, maxX: 23, maxY: 14 };
  const s = HATCH_SPACING;
  const near = (a: number, c: number) => Math.abs(a - c) < 1e-6;
  /** The integer k with v = k·step, or NaN if v isn't a multiple of step. */
  const multiple = (v: number, step: number) => { const k = Math.round(v / step); return near(v, k * step) ? k : NaN; };
  const inside = ([x, y]: readonly [number, number]) => x >= b.minX - 1e-6 && x <= b.maxX + 1e-6 && y >= b.minY - 1e-6 && y <= b.maxY + 1e-6;
  /** Every k from the first multiple of step above lo to the last below hi. */
  const every = (lo: number, hi: number, step: number) => {
    const out: number[] = [];
    for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) out.push(k);
    return out;
  };

  it("spaces patterns a couple of paper millimetres apart", () => {
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(5);
  });

  it("draws 45° lines across the bounds, one per spacing, lined up with the origin", () => {
    const { lines, dots } = hatchMarks(b, "lines");
    expect(dots).toEqual([]);
    const step = s * Math.SQRT2;
    const ks = lines.map(([p, q]) => {
      expect(inside(p) && inside(q)).toBe(true);
      expect(near(q[0] - p[0], q[1] - p[1])).toBe(true);
      expect(near(q[0] - q[1], p[0] - p[1])).toBe(true);
      return multiple(p[0] - p[1], step);
    });
    expect(ks.every(Number.isInteger)).toBe(true);
    expect([...new Set(ks)].sort((x, y) => x - y)).toEqual(every(b.minX - b.maxY, b.maxX - b.minY, step));
  });

  it("crosses them the other way for crosshatch", () => {
    const { lines } = hatchMarks(b, "crosshatch");
    const down = lines.filter(([p, q]) => near(q[0] - p[0], q[1] - p[1]));
    const up = lines.filter(([p, q]) => near(q[0] - p[0], p[1] - q[1]));
    expect(down.length + up.length).toBe(lines.length);
    const step = s * Math.SQRT2;
    expect([...new Set(up.map(([p]) => multiple(p[0] + p[1], step)))].sort((x, y) => x - y)).toEqual(every(b.minX + b.minY, b.maxX + b.maxY, step));
    expect(down.length).toBeGreaterThan(0);
  });

  it("draws a square grid on the spacing", () => {
    const { lines } = hatchMarks(b, "grid");
    const across = lines.filter(([p, q]) => near(p[1], q[1]));
    const downs = lines.filter(([p, q]) => near(p[0], q[0]));
    expect(across.length + downs.length).toBe(lines.length);
    expect(across.map(([p]) => multiple(p[1], s)).sort((x, y) => x - y)).toEqual(every(b.minY, b.maxY, s));
    expect(downs.map(([p]) => multiple(p[0], s)).sort((x, y) => x - y)).toEqual(every(b.minX, b.maxX, s));
  });

  it("puts a dot on every grid point inside", () => {
    const { lines, dots } = hatchMarks(b, "dots");
    expect(lines).toEqual([]);
    expect(dots.length).toBe(every(b.minX, b.maxX, s).length * every(b.minY, b.maxY, s).length);
    for (const d of dots) {
      expect(inside(d)).toBe(true);
      expect(Number.isInteger(multiple(d[0], s)) && Number.isInteger(multiple(d[1], s))).toBe(true);
    }
  });
});

describe("the layer card's fill picker", () => {
  const render = (fill: string | null, hatch: "dots" | null) =>
    renderToStaticMarkup(createElement(FillPicker, { fill, hatch, onFill: () => {}, onHatch: () => {} }));
  const group = (html: string, name: string) => html.split(`aria-label="${name}"`)[1]?.split('role="group"')[0] ?? "";
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]);

  it("offers every fill, and shows which is chosen", () => {
    const html = render(LAYER_FILLS[3]!.hex, null);
    const b = buttons(group(html, "Fill"));
    expect(b.map(([n]) => n)).toEqual(LAYER_FILLS.map((f) => f.name));
    expect(b.filter(([, p]) => p === "true").map(([n]) => n)).toEqual([LAYER_FILLS[3]!.name]);
  });

  it("offers no pattern and the four patterns, and shows which is chosen", () => {
    const b = buttons(group(render(null, "dots"), "Pattern"));
    expect(b.map(([n]) => n)).toEqual(["None", ...HATCH_PATTERNS.map((p) => p.name)]);
    expect(b.filter(([, p]) => p === "true").map(([n]) => n)).toEqual(["Dots"]);
  });
});

describe("layerRuns: what to draw, layer by layer", () => {
  /** Back layer: a rect, a line, a closed path, a text box; front: a circle and an open path. */
  function drawing(): DocState {
    let s = doc(
      addRect("r", { x: 0, y: 0, width: 40, height: 20 }),
      addLine("l", { x: 0, y: 30, length: 10, angle: 0 }),
      addPolyline("closed", { nodes: [cusp(20, 40), cusp(30, 40), cusp(30, 50)], closed: true }),
      addText("t", { x: 50, y: 0, width: 30, height: 10, text: "hi" }),
    );
    s = applyChange(s, addLayer(s, "front"));
    s = applyChange(s, addCircle("c", { cx: 0, cy: 80, diameter: 10, layer: "front" }));
    s = applyChange(s, addPolyline("open", { nodes: [cusp(0, 40), cusp(10, 40), cusp(10, 50)], layer: "front" }));
    return s;
  }
  const ids = (shapes: readonly { id: string }[]) => shapes.map((x) => x.id);
  const runs = (s: DocState, hidden: Set<string> = new Set()) =>
    layerRuns(resolve(s), hidden).map((r) => ({ layer: r.layer.id, shapes: ids(r.shapes), filled: ids(r.filled) }));

  it("gives each layer's shapes in draw order, back to front, none filled without a fill", () => {
    expect(runs(drawing())).toEqual([
      { layer: BASE_LAYER_ID, shapes: ["r", "l", "closed", "t"], filled: [] },
      { layer: "front", shapes: ["c", "open"], filled: [] },
    ]);
  });

  it("names the fillable shapes of a layer with a fill or a pattern", () => {
    let s = drawing();
    s = apply(s, setLayerFill(s, BASE_LAYER_ID, LAYER_FILLS[1]!.hex));
    s = apply(s, setLayerHatch(s, "front", "grid"));
    expect(runs(s).map((r) => r.filled)).toEqual([["r", "closed"], ["c"]]);
  });

  it("leaves hidden layers out, and layers with nothing on them", () => {
    let s = drawing();
    s = applyChange(s, addLayer(s, "empty"));
    s = apply(s, setLayerFill(s, BASE_LAYER_ID, LAYER_FILLS[1]!.hex));
    expect(runs(s, new Set(["front"])).map((r) => r.layer)).toEqual([BASE_LAYER_ID]);
    expect(runs(s, new Set([BASE_LAYER_ID])).map((r) => r.layer)).toEqual(["front"]);
  });
});

describe("hatchTile", () => {
  it("repeats dots and the grid every spacing, 45° lines every spacing·√2", () => {
    expect(hatchTile("dots").size).toBe(HATCH_SPACING);
    expect(hatchTile("grid").size).toBe(HATCH_SPACING);
    expect(hatchTile("lines").size).toBeCloseTo(HATCH_SPACING * Math.SQRT2);
    expect(hatchTile("crosshatch").size).toBeCloseTo(HATCH_SPACING * Math.SQRT2);
  });

  it("fills dots and strokes lines, as path data", () => {
    for (const p of HATCH_PATTERNS) {
      const t = hatchTile(p.id);
      expect(t.d, p.id).toMatch(/^M[-\d.]/);
      expect(t.filled, p.id).toBe(p.id === "dots");
    }
    // Crosshatch is lines and as many again the other way.
    const count = (d: string) => d.split("M").length - 1;
    expect(count(hatchTile("crosshatch").d)).toBe(2 * count(hatchTile("lines").d));
  });
});
