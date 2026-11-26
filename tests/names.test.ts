import { describe, it, expect } from "vitest";
import { applyChanges, type Props } from "@sandtreader/collab/protocol";
import {
  BASE_LAYER_ID, type DocState, addCircle, addLayer, addLine, addPolyline, addRect, addText, canShowName, namePlace, propsChanged, resolve,
  setLayerColour, setShapeName, setShowName, shapeName, showsName, storedName,
} from "../src/model";
import { composePages } from "../src/output/compose";
import { PAPERS } from "../src/output/paper";
import { drawingPrimitives } from "../src/output/primitives";
import { exportDxf } from "../src/output/dxf";
import { exportSvg } from "../src/output/svg";
import type { TextPrim } from "../src/output/types";
import { doc } from "./helpers";

const apply = (s: DocState, c: ReturnType<typeof setShapeName>) => (c ? applyChanges(s, [c]) : s);
const rect = (props: Props = {}) => doc(addRect("r", { x: 0, y: 0, width: 100, height: 40 }), propsChanged("r", props));
const texts = (s: DocState, dimensions = false) => drawingPrimitives(resolve(s), { dimensions, textSize: 3, tick: 1 })
  .filter((p): p is TextPrim => p.kind === "text");

describe("shape names", () => {
  it("go by the id until given one, trimmed", () => {
    expect(shapeName(resolve(rect()).shapes.r!)).toBe("r");
    expect(resolve(rect({ name: "  shelf " })).shapes.r!.name).toBe("shelf");
    expect(shapeName(resolve(rect({ name: "  shelf " })).shapes.r!)).toBe("shelf");
    expect(shapeName(resolve(rect({ name: "   " })).shapes.r!)).toBe("r");
  });

  it("are set and cleared through setShapeName, which trims and skips no-ops", () => {
    let s = rect();
    expect(storedName(s, "r")).toBe("");
    s = apply(s, setShapeName(s, "r", " top shelf "));
    expect(storedName(s, "r")).toBe("top shelf");
    expect(setShapeName(s, "r", "top shelf")).toBeUndefined();
    s = apply(s, setShapeName(s, "r", ""));
    expect(shapeName(resolve(s).shapes.r!)).toBe("r");
    expect(setShapeName(s, "nothing", "x")).toBeUndefined();
  });

  it("show only once given a name, and never on a text box", () => {
    let s = doc(addRect("r", { x: 0, y: 0, width: 10, height: 10 }), addText("t", { x: 0, y: 20, width: 50, height: 10, text: "Hi", name: "label" }));
    // Unnamed: an id is never shown.
    expect(canShowName(s, "r")).toBe(false);
    expect(setShowName(s, "r", true)).toBeUndefined();
    expect(resolve(applyChanges(s, [propsChanged("r", { showName: true })])).shapes.r!.showName).toBeUndefined();
    // A text box, even named and even stored.
    expect(canShowName(s, "t")).toBe(false);
    expect(setShowName(s, "t", true)).toBeUndefined();
    expect(resolve(applyChanges(s, [propsChanged("t", { showName: true })])).shapes.t!.showName).toBeUndefined();
    // Named, it can.
    s = apply(s, setShapeName(s, "r", "shelf"));
    expect(canShowName(s, "r")).toBe(true);
    s = apply(s, setShowName(s, "r", true));
    expect(showsName(s, "r")).toBe(true);
    expect(resolve(s).shapes.r!.showName).toBe(true);
    expect(setShowName(s, "r", true)).toBeUndefined();
  });

  it("stop showing when the name is cleared, and stay off when named again", () => {
    let s = rect({ name: "shelf", showName: true });
    s = apply(s, setShapeName(s, "r", ""));
    expect(s.entities.r!.props.showName).toBe(false);
    expect(resolve(s).shapes.r!.showName).toBeUndefined();
    s = apply(s, setShapeName(s, "r", "shelf"));
    expect(showsName(s, "r")).toBe(false);
  });

  it("report bad values as issues and ignore them", () => {
    const r = resolve(rect({ name: 7, showName: "yes" }));
    expect(r.shapes.r!.name).toBeUndefined();
    expect(r.shapes.r!.showName).toBeUndefined();
    expect(r.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["name is not text", "showName is not true or false"]));
  });

  it("sit centred in the shape, or just above the middle of a line", () => {
    const show = { name: "n", showName: true };
    const s = doc(
      addRect("r", { x: 0, y: 0, width: 100, height: 40 }), propsChanged("r", show),
      addRect("turned", { x: 0, y: 0, width: 100, height: 40, rotation: 90 }), propsChanged("turned", show),
      addCircle("c", { cx: 50, cy: 50, diameter: 20 }), propsChanged("c", show),
      addLine("l", { x: 0, y: 0, length: 100, angle: 0 }), propsChanged("l", show),
      addPolyline("p", { nodes: [{ x: 0, y: 0, type: "cusp" }, { x: 60, y: 0, type: "cusp" }, { x: 60, y: 30, type: "cusp" }], closed: true }), propsChanged("p", show),
      addRect("hidden", { x: 0, y: 0, width: 10, height: 10 }),
    );
    const r = resolve(s), size = 4;
    // The baseline is 0.35 × size below the centre, so the capitals sit across it.
    expect(namePlace(r.shapes.r!, size)).toEqual([50, 20 + 1.4]);
    const [tx, ty] = namePlace(r.shapes.turned!, size)!;
    expect(tx).toBeCloseTo(-20);
    expect(ty).toBeCloseTo(50 + 1.4);
    expect(namePlace(r.shapes.c!, size)).toEqual([50, 50 + 1.4]);
    expect(namePlace(r.shapes.l!, size)).toEqual([50, -1.6]);
    expect(namePlace(r.shapes.p!, size)).toEqual([30, 15 + 1.4]);
    expect(namePlace(r.shapes.hidden!, size)).toBeNull();
  });

  it("print and export with their shapes, in the layer's ink, dimensions or not", () => {
    let s = doc(addRect("r", { x: 0, y: 0, width: 100, height: 40, layer: "red" }), propsChanged("r", { name: "shelf", showName: true }));
    s = applyChanges(s, [addLayer(s, "red")]);
    s = apply(s, setLayerColour(s, "red", "#e00000"));
    for (const dimensions of [false, true]) {
      const [name] = texts(s, dimensions).filter((t) => t.text === "shelf");
      expect(name).toMatchObject({ role: "shape", anchor: "middle", angle: 0, size: 3, colour: "#e00000" });
    }
    expect(exportSvg(resolve(s), { dimensions: false })).toContain(">shelf<");
    // DXF is shapes only, for CAM.
    expect(exportDxf(resolve(s))).not.toContain("shelf");
  });

  it("leave print and SVG when output's Shape names is off", () => {
    const s = rect({ name: "shelf", showName: true });
    const opts = { paper: PAPERS[0]!, orientation: "auto" as const, scale: 1, dimensions: true, ruler: false, titleBlock: true };
    const info = { title: "", author: "", revision: "", notes: "" };
    const named = (names: boolean) => composePages(resolve(s), { ...opts, names }, info)!.pages
      .some((page) => page.content.some((p) => p.kind === "text" && p.text === "shelf"));
    expect(named(true)).toBe(true);
    expect(named(false)).toBe(false);
    expect(exportSvg(resolve(s), { dimensions: true, names: false })).not.toContain(">shelf<");
  });

  it("aren't drawn when not shown, or on a hidden layer", () => {
    expect(texts(rect({ name: "shelf" })).some((t) => t.text === "shelf")).toBe(false);
    const s = rect({ name: "shelf", showName: true });
    const hidden = drawingPrimitives(resolve(s), { dimensions: false, textSize: 3, tick: 1, hidden: new Set([BASE_LAYER_ID]) });
    expect(hidden.some((p) => p.kind === "text" && p.text === "shelf")).toBe(false);
  });
});
