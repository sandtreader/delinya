import { describe, it, expect } from "vitest";
import { applyChange, type DocState } from "@sandtreader/collab/protocol";
import {
  DEFAULT_LINE_STYLE, LINE_DASHES, LINE_WIDTHS, addCircle, addLine, addPolyline, addRect, addText, breakPolyNode,
  commonLineStyle, dashArray, dashLengths, deletePolySegment, duplicateShapes, resolve, rotateShapes, setLineStyle,
  styleProps,
} from "../src/model";
import type { ResolvedCircle, ResolvedLine, ResolvedPolyline, ResolvedRect } from "../src/model";
import { editorReducer, initialEditor } from "../src/app/editor";
import { loadLineStyle, saveLineStyle } from "../src/app/lineStylePref";
import { SCREEN_PX_PER_MM, screenDashArray, screenLineWidth } from "../src/view/lineScreen";
import { drawingPrimitives } from "../src/output/primitives";
import { composePages } from "../src/output/compose";
import { exportSvg } from "../src/output/svg";
import { exportPdf } from "../src/output/pdf";
import { exportDxf } from "../src/output/dxf";
import { PAPERS } from "../src/output/paper";
import { doc } from "./helpers";

// Line styles: a pen width on paper (ISO 128 widths; the same at any print
// scale, and on screen at any zoom) and a dash pattern, set per shape on
// lines, rects, circles and paths (not text). Dash lengths follow ISO 128 in
// units of the width, but never shorter than at 0.35 mm, so thin lines
// still read as dashed: u = max(width, 0.35). Patterns are what is seen:
// dashed 12u dash, 3u gap; dotted dots (width across) 3u apart; dash-dot
// (centre line) 24u dash, 3u gap, dot, 3u gap. Strokes have round caps,
// which add half the width at each end of a dash, so the array given to
// SVG, PDF and the screen shortens each dash by the width and lengthens
// each gap by it. A default style (0.35, solid) is stored as nothing.

const near = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
};

const styled = () => doc(
  addLine("l", { x: 0, y: 0, length: 100, angle: 0, lineWidth: 0.5, lineDash: "dashed" }),
  addRect("r", { x: 0, y: 20, width: 50, height: 30, lineDash: "dotted" }),
  addCircle("c", { cx: 100, cy: 50, diameter: 20, lineWidth: 1 }),
  addPolyline("p", { nodes: [{ x: 0, y: 100, type: "cusp" }, { x: 50, y: 100, type: "cusp" }, { x: 50, y: 150, type: "cusp" }], lineDash: "dashdot" }),
  addText("t", { x: 200, y: 0, width: 50, height: 12, text: "Hi" }),
);

describe("the choices", () => {
  it("offers the ISO pen widths and four patterns, solid 0.35 by default", () => {
    expect(LINE_WIDTHS).toEqual([0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2]);
    expect(LINE_DASHES).toEqual(["solid", "dashed", "dotted", "dashdot"]);
    expect(DEFAULT_LINE_STYLE).toEqual({ width: 0.35, dash: "solid" });
  });
});

describe("resolve", () => {
  it("gives every stroked shape its style, the default where none is stored", () => {
    const r = resolve(styled());
    expect((r.shapes.l as ResolvedLine).style).toEqual({ width: 0.5, dash: "dashed" });
    expect((r.shapes.r as ResolvedRect).style).toEqual({ width: 0.35, dash: "dotted" });
    expect((r.shapes.c as ResolvedCircle).style).toEqual({ width: 1, dash: "solid" });
    expect((r.shapes.p as ResolvedPolyline).style).toEqual({ width: 0.35, dash: "dashdot" });
    expect("style" in r.shapes.t!).toBe(false);
    expect(r.issues).toEqual([]);
  });

  it("takes the default for a bad value, with an issue", () => {
    const st = doc(
      { type: "entity_added", id: "a", kind: "line", props: { x: 0, y: 0, length: 10, angle: 0, lineWidth: -1, lineDash: "wavy" } },
      { type: "entity_added", id: "b", kind: "rect", props: { x: 0, y: 0, width: 10, height: 10, lineWidth: "thick" } },
    );
    const r = resolve(st);
    expect((r.shapes.a as ResolvedLine).style).toEqual(DEFAULT_LINE_STYLE);
    expect((r.shapes.b as ResolvedRect).style).toEqual(DEFAULT_LINE_STYLE);
    expect(r.issues.filter((i) => i.code === "bad-value").map((i) => i.entity).sort()).toEqual(["a", "a", "b"]);
  });
});

describe("patterns", () => {
  it("are ISO 128 lengths as seen, in units of the width but no less than 0.35", () => {
    expect(dashLengths("solid", 0.5)).toEqual([]);
    near(dashLengths("dashed", 0.5), [6, 1.5]);
    near(dashLengths("dotted", 0.5), [0, 1.5]);
    near(dashLengths("dashdot", 0.5), [12, 1.5, 0, 1.5]);
    // Thin lines dash as 0.35 does.
    near(dashLengths("dashed", 0.13), [4.2, 1.05]);
  });

  it("allow for round caps in the array drawn", () => {
    expect(dashArray("solid", 0.5)).toEqual([]);
    near(dashArray("dashed", 0.5), [5.5, 2]);
    near(dashArray("dotted", 0.5), [0, 2]);
    near(dashArray("dashdot", 0.5), [11.5, 2, 0, 2]);
    near(dashArray("dashed", 0.13), [4.2 - 0.13, 1.05 + 0.13]);
  });
});

describe("setLineStyle", () => {
  const st = styled();

  it("sets width and pattern on the stroked shapes given, as one change", () => {
    const c = setLineStyle(st, ["r", "c", "t"], { width: 0.7, dash: "dashed" })!;
    expect(c).toBeDefined();
    const after = applyChange(st, c);
    expect(after.entities.r!.props).toMatchObject({ lineWidth: 0.7, lineDash: "dashed" });
    expect(after.entities.c!.props).toMatchObject({ lineWidth: 0.7, lineDash: "dashed" });
    expect(after.entities.t!.props.lineWidth).toBeUndefined();
    expect(after.entities.t!.props.lineDash).toBeUndefined();
  });

  it("sets just what it is given", () => {
    const after = applyChange(st, setLineStyle(st, ["l"], { width: 1 })!);
    expect(after.entities.l!.props).toMatchObject({ lineWidth: 1, lineDash: "dashed" });
  });

  it("stores the default as nothing", () => {
    const after = applyChange(st, setLineStyle(st, ["l"], DEFAULT_LINE_STYLE)!);
    expect(after.entities.l!.props.lineWidth).toBeUndefined();
    expect(after.entities.l!.props.lineDash).toBeUndefined();
    expect((resolve(after).shapes.l as ResolvedLine).style).toEqual(DEFAULT_LINE_STYLE);
  });

  it("is undefined when nothing would change", () => {
    expect(setLineStyle(st, ["l"], { width: 0.5, dash: "dashed" })).toBeUndefined();
    expect(setLineStyle(st, ["t", "missing"], { dash: "dotted" })).toBeUndefined();
    expect(setLineStyle(st, ["r"], { width: -1 })).toBeUndefined();
  });
});

describe("styleProps: what a new shape stores for a style", () => {
  it("is nothing for the default, else what differs", () => {
    expect(styleProps(DEFAULT_LINE_STYLE)).toEqual({});
    expect(styleProps({ width: 0.5, dash: "solid" })).toEqual({ lineWidth: 0.5 });
    expect(styleProps({ width: 0.35, dash: "dotted" })).toEqual({ lineDash: "dotted" });
    expect(styleProps({ width: 1, dash: "dashdot" })).toEqual({ lineWidth: 1, lineDash: "dashdot" });
  });
});

describe("commonLineStyle: what the toolbar shows for a selection", () => {
  const r = resolve(styled());

  it("is the style the stroked shapes share, null where they differ", () => {
    expect(commonLineStyle(r, ["l"])).toEqual({ width: 0.5, dash: "dashed" });
    expect(commonLineStyle(r, ["r", "p"])).toEqual({ width: 0.35, dash: null });
    expect(commonLineStyle(r, ["l", "c"])).toEqual({ width: null, dash: null });
    // Text has no line style: ignored.
    expect(commonLineStyle(r, ["l", "t"])).toEqual({ width: 0.5, dash: "dashed" });
  });

  it("is null with no stroked shape selected", () => {
    expect(commonLineStyle(r, [])).toBeNull();
    expect(commonLineStyle(r, ["t", "missing"])).toBeNull();
  });
});

describe("style goes with the shape", () => {
  it("through a turn and a duplicate", () => {
    const st = styled();
    const turned = applyChange(st, rotateShapes(st, ["r"], 90)!);
    expect(turned.entities.r!.props.lineDash).toBe("dotted");
    let n = 0;
    const dup = duplicateShapes(st, ["l"], [0, 10], (p) => `${p}${++n}`)!;
    const after = applyChange(st, dup.change);
    expect(after.entities[dup.ids[0]!]!.props).toMatchObject({ lineWidth: 0.5, lineDash: "dashed" });
  });

  it("onto both parts of a path cut or broken in two", () => {
    const nodes = [0, 1, 2, 3].map((i) => ({ x: i * 10, y: 0, type: "cusp" as const }));
    const st = doc(addPolyline("p", { nodes, lineWidth: 0.7, lineDash: "dashed" }));
    let n = 0;
    const makeId = (p: string) => `${p}${++n}`;
    const check = (after: DocState, ids: string[]) => {
      expect(ids.length).toBe(2);
      for (const id of ids) expect(after.entities[id]!.props).toMatchObject({ lineWidth: 0.7, lineDash: "dashed" });
    };
    const cut = deletePolySegment(st, "p", 1, makeId)!;
    check(applyChange(st, cut.change), cut.ids);
    const broken = breakPolyNode(st, "p", 1, makeId)!;
    check(applyChange(st, broken.change), broken.ids);
  });
});

describe("the viewer's current style", () => {
  it("is editor state, the default at first, set by its own action", () => {
    expect(initialEditor.lineStyle).toEqual(DEFAULT_LINE_STYLE);
    const s = editorReducer(initialEditor, { type: "lineStyle", style: { dash: "dotted" } });
    expect(s.lineStyle).toEqual({ width: 0.35, dash: "dotted" });
  });

  it("is remembered per browser, junk falling back to the default", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(loadLineStyle(storage)).toEqual(DEFAULT_LINE_STYLE);
    saveLineStyle(storage, { width: 0.7, dash: "dashdot" });
    expect(loadLineStyle(storage)).toEqual({ width: 0.7, dash: "dashdot" });
    store.set("delinya.lineStyle", JSON.stringify({ width: -2, dash: "dashed" }));
    expect(loadLineStyle(storage)).toEqual({ width: 0.35, dash: "dashed" });
    store.set("delinya.lineStyle", JSON.stringify({ width: 1, dash: "wavy" }));
    expect(loadLineStyle(storage)).toEqual({ width: 1, dash: "solid" });
    store.set("delinya.lineStyle", "junk");
    expect(loadLineStyle(storage)).toEqual(DEFAULT_LINE_STYLE);
    expect(loadLineStyle(null)).toEqual(DEFAULT_LINE_STYLE);
  });
});

describe("on screen", () => {
  it("is the paper width at 96 px to the inch, at any zoom, never under 1 px", () => {
    expect(SCREEN_PX_PER_MM).toBeCloseTo(96 / 25.4, 12);
    expect(screenLineWidth(0.5)).toBeCloseTo(0.5 * SCREEN_PX_PER_MM, 9);
    expect(screenLineWidth(0.35)).toBeCloseTo(0.35 * SCREEN_PX_PER_MM, 9);
    expect(screenLineWidth(0.13)).toBe(1);
  });

  it("dashes in px, allowing for the drawn width's round caps", () => {
    expect(screenDashArray("solid", 0.5)).toEqual([]);
    const px = SCREEN_PX_PER_MM;
    near(screenDashArray("dashed", 0.5), [5.5 * px, 2 * px]);
    // 0.13 draws 1 px wide and dashes as 0.35 does.
    near(screenDashArray("dotted", 0.13), [0, 1.05 * px + 1]);
  });
});

describe("output", () => {
  const r = resolve(styled());

  it("primitives carry a shape's style when it isn't the default", () => {
    const prims = drawingPrimitives(r, { dimensions: false, textSize: 3, tick: 1 });
    const paths = prims.filter((p) => p.kind === "path");
    expect(paths.map((p) => p.kind === "path" && p.line)).toEqual([
      { width: 0.5, dash: "dashed" },
      { width: 0.35, dash: "dotted" },
      { width: 1, dash: "solid" },
      { width: 0.35, dash: "dashdot" },
    ]);
    const plain = drawingPrimitives(resolve(doc(addRect("a", { x: 0, y: 0, width: 1, height: 1 }))), { dimensions: false, textSize: 3, tick: 1 });
    expect("line" in plain[0]!).toBe(false);
  });

  it("keep it, at paper size, on a page printed at any scale", () => {
    const out = composePages(r, { paper: PAPERS[0]!, orientation: "auto", scale: 0.1, dimensions: false }, { title: "", author: "", revision: "", notes: "" })!;
    const lines = out.pages.flatMap((p) => p.content).filter((p) => p.kind === "path" && p.line).map((p) => p.kind === "path" && p.line);
    expect(lines).toContainEqual({ width: 0.5, dash: "dashed" });
    expect(lines).toContainEqual({ width: 1, dash: "solid" });
  });

  it("SVG strokes at the width, dashed by the round-cap array", () => {
    const svg = exportSvg(r, { dimensions: false })!;
    expect(svg).toMatch(/<path [^>]*stroke-width="0.5" stroke-dasharray="5.5 2"/);
    expect(svg).toMatch(/<path [^>]*stroke-width="1"[^>]*\/>/);
    // Dotted at 0.35: dots 0.35 + 1.05 clear apart.
    expect(svg).toMatch(/<path [^>]*stroke-width="0.35" stroke-dasharray="0 1.4"/);
  });

  it("PDF sets the width and dash for each, and back for the next plain shape", () => {
    const page = {
      width: 210, height: 297, clip: { x: 0, y: 0, width: 210, height: 297 }, furniture: [],
      content: [
        { kind: "path" as const, role: "shape" as const, path: [{ kind: "segment" as const, from: [0, 0] as [number, number], to: [10, 0] as [number, number] }], line: { width: 0.5, dash: "dashed" as const } },
        { kind: "path" as const, role: "shape" as const, path: [{ kind: "segment" as const, from: [0, 5] as [number, number], to: [10, 5] as [number, number] }] },
      ],
    };
    const pdf = new TextDecoder("latin1").decode(exportPdf([page], { title: "", author: "" }));
    const first = pdf.indexOf("0.5 w");
    expect(first).toBeGreaterThan(0);
    expect(pdf.indexOf("[5.5 2] 0 d", first)).toBeGreaterThan(first);
    const back = pdf.indexOf("0.35 w", first);
    expect(back).toBeGreaterThan(first);
    expect(pdf.indexOf("[] 0 d", first)).toBeGreaterThan(first);
  });

  it("DXF names a linetype for each pattern used (R12 has no line widths)", () => {
    const dxf = exportDxf(r)!;
    const lines = dxf.split(/\r?\n/).map((s) => s.trim());
    const pairs: Array<[number, string]> = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!]);
    // The table defines each pattern used, as seen at 0.35 mm: dash positive, gap negative, dot 0.
    const ltype = (name: string) => {
      const at = pairs.findIndex(([c, v], i) => c === 2 && v === name && pairs[i - 1]?.[1] === "LTYPE");
      expect(at, name).toBeGreaterThan(0);
      const out: number[] = [];
      for (let i = at + 1; i < pairs.length && pairs[i]![0] !== 0; i++) if (pairs[i]![0] === 49) out.push(Number(pairs[i]![1]));
      return out;
    };
    near(ltype("DASHED"), [4.2, -1.05]);
    near(ltype("DOTTED"), [0, -1.05]);
    near(ltype("DASHDOT"), [8.4, -1.05, 0, -1.05]);
    // Entities name theirs; solid ones none (by layer: continuous).
    const named = pairs.filter(([c]) => c === 6).map(([, v]) => v);
    expect(named).toEqual(expect.arrayContaining(["DASHED", "DOTTED", "DASHDOT"]));
  });
});
