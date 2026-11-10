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
    expect(initialEditor.duplicate).toEqual({ direction: "right", spacing: 10, count: 1 });
    const e = editorReducer(initialEditor, { type: "duplicate", settings: { direction: "down" } });
    const f = editorReducer(e, { type: "duplicate", settings: { spacing: 2.5 } });
    expect(editorReducer(f, { type: "duplicate", settings: { count: 4 } }).duplicate).toEqual({ direction: "down", spacing: 2.5, count: 4 });
  });

  it("show in the selection panel: the count beside the Duplicate button", () => {
    store.replace(emptyState());
    store.commit(addRect("a", { x: 0, y: 0, width: 30, height: 10 }));
    const editor = { ...initialEditor, selection: ["a"], duplicate: { direction: "right" as const, spacing: 10, count: 3 } };
    const html = renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor, dispatch: () => {} } }, createElement(SelectionPanel)));
    const count = html.match(/<label[^>]*class="count"[^>]*>([\s\S]*?)<\/label>/);
    expect(count).not.toBeNull();
    expect(count![1]).toMatch(/<input[^>]*value="3"/);
    // The button says what it will do.
    expect(html).toMatch(/Copy 3 times to the right, 10 mm apart/);
  });
});
