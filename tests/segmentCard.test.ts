import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState } from "@sandtreader/collab/protocol";
import { addPolyline, type PolyNode } from "../src/model";
import { EditorContext, initialEditor } from "../src/app/editor";
import { store } from "../src/app/store";
import { SegmentCard } from "../src/panels/SegmentCard";

// The segment card, beside a path's selected segment: Straight / Curve as
// icons, then a bin, on one row.

const cusp = (x: number, y: number, extra: Partial<PolyNode> = {}): PolyNode => ({ x, y, type: "cusp", ...extra });

function card(index: number) {
  store.replace(emptyState());
  store.commit(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0, { out: [3, 3] }), cusp(20, 0), cusp(30, 0)] }));
  const editor = { ...initialEditor, selection: ["p"], segment: { shape: "p", index } };
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor, dispatch: () => {} } }, createElement(SegmentCard)));
}

const pressedOf = (html: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => b.includes('aria-pressed="true"'));

describe("the segment card", () => {
  it("shows Straight and Curve as icon buttons, the segment's own pressed, then the bin", () => {
    const html = card(0);
    expect(html).toContain('aria-label="Segment 1 of 3"');
    const order = ["Straight", "Curve", "Delete segment"].map((n) => html.indexOf(`aria-label="${n}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const name of ["Straight", "Curve"]) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>(.*?)</button>`));
      expect(button![1]).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
    expect(pressedOf(html)).toHaveLength(1);
    expect(pressedOf(html)[0]).toContain('aria-label="Straight"');
    expect(pressedOf(card(1))[0]).toContain('aria-label="Curve"');
  });

  it("shows nothing without a selected segment", () => {
    store.replace(emptyState());
    const html = renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor: initialEditor, dispatch: () => {} } }, createElement(SegmentCard)));
    expect(html).toBe("");
  });
});
