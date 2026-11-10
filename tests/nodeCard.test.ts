import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState } from "@sandtreader/collab/protocol";
import { addPolyline, type PolyNode } from "../src/model";
import { EditorContext, initialEditor } from "../src/app/editor";
import { store } from "../src/app/store";
import { NodeCard } from "../src/panels/NodeCard";

// The node card: Corner / Smooth as icons, then the bin, on one row; x
// and y on a row each. No node number (the card is named for screen
// readers).

const cusp = (x: number, y: number): PolyNode => ({ x, y, type: "cusp" });

function card() {
  store.replace(emptyState());
  store.commit(addPolyline("p", { nodes: [cusp(0, 0), cusp(10, 0), cusp(10, 10)] }));
  const editor = { ...initialEditor, selection: ["p"], node: { shape: "p", index: 1 } };
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor, dispatch: () => {} } }, createElement(NodeCard)));
}

describe("the node card", () => {
  it("shows the two node types as icon buttons, named for screen readers, with no text", () => {
    const html = card();
    for (const name of ["Corner", "Smooth"]) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>(.*?)</button>`));
      expect(button, name).not.toBeNull();
      expect(button![1]).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
    const pressed = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((b) => b.includes('aria-pressed="true"'));
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain('aria-label="Corner"');
  });

  it("puts the bin right after them, and x and y on a row each", () => {
    const html = card();
    const rows = html.split('class="node-card-row"').slice(1);
    expect(rows).toHaveLength(3);
    const [top, x, y] = rows as [string, string, string];
    const order = ["Corner", "Smooth", "Delete node"].map((n) => top.indexOf(`aria-label="${n}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(top).not.toContain("<input");
    expect(x).toMatch(/>x<[\s\S]*<input/);
    expect(x).not.toMatch(/>y</);
    expect(y).toMatch(/>y<[\s\S]*<input/);
  });

  it("shows no node number, but is named for its node", () => {
    const html = card();
    expect(html).not.toContain("node-card-number");
    expect(html).toContain('aria-label="Node 2 of 3"');
  });
});
