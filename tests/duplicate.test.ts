import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyChange, emptyState, type DocState } from "@sandtreader/collab/protocol";
import {
  KINDS, addCircle, addDimension, addLine, addRadiusLabel, addRect, addVariable, duplicateBeside, duplicateOffset,
  duplicateShapes, linkAlign, resolve,
} from "../src/model";
import { EditorContext, editorReducer, initialEditor } from "../src/app/editor";
import { store } from "../src/app/store";
import { SelectionPanel } from "../src/panels/SelectionPanel";
import { doc } from "./helpers";

/** Predictable IDs: kind prefix and a running number. */
const counter = () => { let n = 0; return (prefix: string) => `${prefix}-${++n}`; };

const ofKind = (st: DocState, kind: string) => Object.entries(st.entities).filter(([, e]) => e.kind === kind);

describe("duplicateShapes", () => {
  const st = doc(
    addVariable("v", 40, "Shelf"),
    addRect("a", { x: 0, y: 0, width: { ref: "v" }, height: 20, r: [0, 5, 0, 0] }),
    addDimension("da", "a", "width", 12),
    addRadiusLabel("ra", "a", 1),
  );

  it("copies a shape offset, with its own dimensions and radius labels, keeping linked lengths", () => {
    const out = duplicateShapes(st, ["a"], [50, 0], counter())!;
    expect(out.ids).toEqual(["rect-1"]);
    const after = applyChange(st, out.change);
    expect(after.entities["rect-1"]).toMatchObject({ kind: KINDS.rect, props: { x: 50, y: 0, width: { ref: "v" }, height: 20, r: [0, 5, 0, 0] } });
    expect(ofKind(after, KINDS.dimension).map(([, e]) => e.props)).toEqual([
      { target: "a", prop: "width", offset: 12 },
      { target: "rect-1", prop: "width", offset: 12 },
    ]);
    expect(ofKind(after, KINDS.radiusLabel).map(([, e]) => e.props.target)).toEqual(["a", "rect-1"]);
    // The original is untouched, and both follow the shared variable.
    expect(after.entities.a).toEqual(st.entities.a);
    expect(resolve(after).shapes["rect-1"]).toMatchObject({ x: 50, width: 40 });
  });

  it("keeps the layer, and copies lines and circles too, in one change", () => {
    const st2 = doc(
      addLine("l", { x: 0, y: 0, length: 30, angle: 45, layer: "top" }),
      addCircle("c", { cx: 5, cy: 5, diameter: 8 }),
    );
    const out = duplicateShapes(st2, ["l", "c"], [0, 10], counter())!;
    expect(out.ids).toEqual(["line-1", "circle-2"]);
    const after = applyChange(st2, out.change);
    expect(after.entities["line-1"]!.props).toEqual({ x: 0, y: 10, length: 30, angle: 45, layer: "top" });
    expect(after.entities["circle-2"]!.props).toEqual({ cx: 5, cy: 15, diameter: 8 });
  });

  it("takes a linked position as drawn, without copying the link", () => {
    const linked = doc(
      addRect("anchor", { x: 100, y: 0, width: 10, height: 10 }),
      addRect("item", { x: 0, y: 50, width: 10, height: 10 }),
      linkAlign("al", "anchor", ["item"], "x", "start"),
    );
    const after = applyChange(linked, duplicateShapes(linked, ["item"], [0, 20], counter())!.change);
    expect(after.entities["rect-1"]!.props).toMatchObject({ x: 100, y: 70 });
    expect(ofKind(after, KINDS.align)).toHaveLength(1);
  });

  it("has nothing to copy without shapes", () => {
    expect(duplicateShapes(st, [], [10, 10], counter())).toBeUndefined();
    expect(duplicateShapes(st, ["gone", "da", "v"], [10, 10], counter())).toBeUndefined();
  });
});

describe("duplicateOffset", () => {
  const b = { minX: 10, minY: 20, maxX: 40, maxY: 30 };   // 30 × 10

  it("puts the copy beside the selection, `spacing` clear of it, in the chosen direction", () => {
    expect(duplicateOffset(b, "right", 5)).toEqual([35, 0]);
    expect(duplicateOffset(b, "down", 5)).toEqual([0, 15]);
    expect(duplicateOffset(b, "left", 5)).toEqual([-35, 0]);
    expect(duplicateOffset(b, "up", 5)).toEqual([0, -15]);
    expect(duplicateOffset(b, "right", 0)).toEqual([30, 0]);
  });
});

describe("duplicateBeside (the panel's Duplicate and ⌘D)", () => {
  // Together 0..50 × 0..30.
  const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }), addRect("b", { x: 40, y: 20, width: 10, height: 10 }));

  it("copies the selection beside its bounds, the gap clear, in the last chosen direction", () => {
    const down = applyChange(st, duplicateBeside(st, ["a", "b"], { direction: "down", spacing: 5 }, counter())!.change);
    expect(down.entities["rect-1"]!.props).toMatchObject({ x: 0, y: 35 });
    expect(down.entities["rect-2"]!.props).toMatchObject({ x: 40, y: 55 });
    const right = duplicateBeside(st, ["a"], { direction: "right", spacing: 10 }, counter())!;
    expect(right.ids).toEqual(["rect-1"]);
    expect(applyChange(st, right.change).entities["rect-1"]!.props).toMatchObject({ x: 40, y: 0 });
  });

  it("has nothing to copy without shapes", () => {
    expect(duplicateBeside(st, ["gone"], { direction: "down", spacing: 5 }, counter())).toBeUndefined();
  });

  it("makes a row of several copies, each the same step on from the last, in one undo step", () => {
    const out = duplicateBeside(st, ["a"], { direction: "right", spacing: 10, count: 3 }, counter())!;
    expect(out.change.type).toBe("batch");
    expect(out.ids).toEqual(["rect-1", "rect-2", "rect-3"]);
    const after = applyChange(st, out.change);
    expect(out.ids.map((id) => after.entities[id]!.props.x)).toEqual([40, 80, 120]);
    // Several shapes: each copy of the group in turn, in the selection's order.
    const two = duplicateBeside(st, ["a", "b"], { direction: "down", spacing: 5, count: 2 }, counter())!;
    const st2 = applyChange(st, two.change);
    expect(two.ids.map((id) => [id, st2.entities[id]!.props.y])).toEqual([["rect-1", 35], ["rect-2", 55], ["rect-3", 70], ["rect-4", 90]]);
  });

  it("makes at least one copy, of a whole number", () => {
    expect(duplicateBeside(st, ["a"], { direction: "right", spacing: 10, count: 0 }, counter())!.ids).toHaveLength(1);
    expect(duplicateBeside(st, ["a"], { direction: "right", spacing: 10, count: 2.7 }, counter())!.ids).toHaveLength(2);
  });
});

describe("duplicate settings", () => {
  it("default to one copy to the right, 10 mm apart, and are remembered while the app is open", () => {
    expect(initialEditor.duplicate).toEqual({ direction: "right", spacing: 10, count: 1, linkGaps: false, linkSize: false, linkAlign: false });
    const e = editorReducer(initialEditor, { type: "duplicate", settings: { direction: "down" } });
    const f = editorReducer(e, { type: "duplicate", settings: { spacing: 2.5 } });
    const g = editorReducer(f, { type: "duplicate", settings: { count: 4, linkGaps: true } });
    expect(g.duplicate).toEqual({ direction: "down", spacing: 2.5, count: 4, linkGaps: true, linkSize: false, linkAlign: false });
  });

  it("show in the selection panel: the count beside the Duplicate button", () => {
    store.replace(emptyState());
    store.commit(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const editor = { ...initialEditor, selection: ["a"], duplicate: { ...initialEditor.duplicate, count: 3 } };
    const html = renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor, dispatch: () => {} } }, createElement(SelectionPanel)));
    const count = html.match(/<label[^>]*class="count"[^>]*>([\s\S]*?)<\/label>/);
    expect(count).not.toBeNull();
    expect(count![1]).toMatch(/<input[^>]*value="3"/);
    // The button says what it will do.
    expect(html).toMatch(/Copy 3 times to the right, 10 mm apart/);
  });
});

describe("linking the copies", () => {
  const varsOf = (st: DocState) => ofKind(st, KINDS.variable).map(([id, e]) => ({ id, name: e.props.name, value: e.props.value }));
  const run = (st: DocState, ids: string[], placement: Parameters<typeof duplicateBeside>[2]) => {
    const out = duplicateBeside(st, ids, placement, counter())!;
    expect(out.change.type).toBe("batch");
    return { out, after: applyChange(st, out.change) };
  };

  it("keeps the copies equally spaced between the original and the last copy", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const { out, after } = run(st, ["a"], { direction: "right", spacing: 10, count: 3, linkGaps: true });
    const links = ofKind(after, KINDS.spacing);
    expect(links).toHaveLength(1);
    const props = links[0]![1].props;
    expect(new Set([props.anchorA, props.anchorB])).toEqual(new Set(["a", out.ids[2]]));
    expect(props.items).toEqual([out.ids[0], out.ids[1]]);
    expect(props.axis).toBe("x");
    // Nothing moves yet; move the last copy and the middle two spread evenly.
    expect(out.ids.map((id) => resolve(after).shapes[id]!.bounds.minX)).toEqual([40, 80, 120]);
    const moved = applyChange(after, { type: "props_changed", id: out.ids[2]!, props: { x: 200 } });
    const r = resolve(moved);
    expect(r.shapes[out.ids[0]!]!.bounds.minX).toBeCloseTo(30 + 110 / 3);
    expect(r.shapes[out.ids[1]!]!.bounds.minX).toBeCloseTo(30 + 30 + 2 * 110 / 3);
  });

  it("spaces down for copies below, and needs two copies to space anything", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    expect(ofKind(run(st, ["a"], { direction: "down", spacing: 5, count: 2, linkGaps: true }).after, KINDS.spacing)[0]![1].props.axis).toBe("y");
    expect(ofKind(run(st, ["a"], { direction: "right", spacing: 5, count: 1, linkGaps: true }).after, KINDS.spacing)).toHaveLength(0);
  });

  it("links the copies' sizes to the original's through shared variables, named for what they hold", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const { out, after } = run(st, ["a"], { direction: "right", spacing: 10, count: 2, linkSize: true });
    const vars = varsOf(after);
    expect(vars.map((v) => [v.name, v.value])).toEqual([["width", 30], ["height", 10]]);
    const [w, h] = vars as unknown as [{ id: string }, { id: string }];
    for (const id of ["a", ...out.ids]) expect(after.entities[id]!.props).toMatchObject({ width: { ref: w.id }, height: { ref: h.id } });
    // A circle's diameter, a line's length.
    const c = run(doc(addCircle("c", { cx: 0, cy: 0, diameter: 8 })), ["c"], { direction: "right", spacing: 2, count: 1, linkSize: true }).after;
    expect(varsOf(c).map((v) => [v.name, v.value])).toEqual([["diameter", 8]]);
    const l = run(doc(addLine("l", { x: 0, y: 0, length: 12, angle: 0 })), ["l"], { direction: "down", spacing: 2, count: 1, linkSize: true }).after;
    expect(varsOf(l).map((v) => v.name)).toEqual(["length"]);
  });

  it("leaves a size already held by a variable alone (the copies share it already), and names new ones apart", () => {
    const st = doc(
      addVariable("w", 30, "width"),
      addRect("a", { x: 0, y: 0, width: { ref: "w" }, height: 10 }),
      addRect("b", { x: 0, y: 20, width: 5, height: 5 }),
    );
    const { out, after } = run(st, ["a", "b"], { direction: "right", spacing: 10, count: 1, linkSize: true });
    const names = varsOf(after).map((v) => v.name).sort();
    expect(names).toEqual(["height", "height 2", "width", "width 2"]);
    expect(after.entities[out.ids[0]!]!.props.width).toEqual({ ref: "w" });
  });

  it("links each shape of a group with its own copies", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }), addCircle("c", { cx: 50, cy: 5, diameter: 10 }));
    const { out, after } = run(st, ["a", "c"], { direction: "down", spacing: 5, count: 2, linkGaps: true, linkSize: true });
    const links = ofKind(after, KINDS.spacing).map(([, e]) => e.props);
    expect(links).toHaveLength(2);
    // Copies come copy by copy: a's are ids 0 and 2, c's 1 and 3.
    expect(links.map((l) => l.items)).toEqual(expect.arrayContaining([[out.ids[0]], [out.ids[1]]]));
    expect(varsOf(after).map((v) => v.name).sort()).toEqual(["diameter", "height", "width"]);
  });

  it("keeps the copies lined up with the original across the row: tops for a row, left edges for a column", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const row = run(st, ["a"], { direction: "right", spacing: 10, count: 2, linkAlign: true });
    const links = ofKind(row.after, KINDS.align).map(([, e]) => e.props);
    expect(links).toEqual([{ anchor: "a", items: row.out.ids, axis: "y", mode: "start" }]);
    // Move the original down and the copies follow; across they stay put.
    const moved = resolve(applyChange(row.after, { type: "props_changed", id: "a", props: { y: 7 } }));
    expect(row.out.ids.map((id) => [moved.shapes[id]!.bounds.minX, moved.shapes[id]!.bounds.minY])).toEqual([[40, 7], [80, 7]]);
    // A column (down or up) keeps left edges; one copy is enough.
    const col = run(st, ["a"], { direction: "up", spacing: 10, count: 1, linkAlign: true });
    expect(ofKind(col.after, KINDS.align).map(([, e]) => [e.props.axis, e.props.mode])).toEqual([["x", "start"]]);
    expect(resolve(col.after).issues).toEqual([]);
  });

  it("aligns each shape of a group with its own copies, alongside the other links", () => {
    const st = doc(addRect("a", { x: 0, y: 0, width: 30, height: 10 }), addCircle("c", { cx: 50, cy: 5, diameter: 10 }));
    const { out, after } = run(st, ["a", "c"], { direction: "right", spacing: 5, count: 2, linkGaps: true, linkSize: true, linkAlign: true });
    const links = ofKind(after, KINDS.align).map(([, e]) => e.props);
    expect(links.map((l) => [l.anchor, l.items])).toEqual(expect.arrayContaining([["a", [out.ids[0], out.ids[2]]], ["c", [out.ids[1], out.ids[3]]]]));
    expect(links).toHaveLength(2);
    // Nothing moves when it's all made, and nothing conflicts.
    const r = resolve(after);
    expect(r.issues).toEqual([]);
    const plain = resolve(applyChange(st, duplicateBeside(st, ["a", "c"], { direction: "right", spacing: 5, count: 2 }, counter())!.change));
    for (const id of out.ids) expect(r.shapes[id]!.bounds).toEqual(plain.shapes[id]!.bounds);
  });

  it("show in the panel as three checkboxes, gaps only with two or more copies", () => {
    store.replace(emptyState());
    store.commit(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const render = (count: number) => renderToStaticMarkup(createElement(EditorContext.Provider, {
      value: { editor: { ...initialEditor, selection: ["a"], duplicate: { ...initialEditor.duplicate, count, linkSize: true } }, dispatch: () => {} },
    }, createElement(SelectionPanel)));
    const box = (html: string, name: string) => html.match(new RegExp(`<label[^>]*class="link-${name}"[^>]*>[\\s\\S]*?<input([^>]*)>`))?.[1];
    expect(box(render(3), "gaps")).toBeDefined();
    expect(box(render(3), "gaps")).not.toContain("disabled");
    expect(box(render(1), "gaps")).toContain("disabled");
    expect(box(render(1), "size")).toContain("checked");
    expect(box(render(1), "align")).toBeDefined();
    expect(box(render(1), "align")).not.toContain("disabled");
  });
});
