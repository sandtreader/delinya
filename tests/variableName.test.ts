import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyChange, emptyState, type DocState } from "@sandtreader/collab/protocol";
import { addCircle, addRect, addVariable, batch, linkLengths, renameVariable } from "../src/model";
import { EditorContext, initialEditor } from "../src/app/editor";
import { store } from "../src/app/store";
import { ShapeFields } from "../src/panels/ShapeFields";
import { Variables } from "../src/panels/PropertiesDialog";

// Variables get their names when made: Link equal asks for one, but
// Duplicate's linked size names them for their sizes ("width 2"). So a
// variable can be renamed afterwards, wherever its name shows: in the shape
// panel next to a linked length, and in Properties › Variables.

function linked(): DocState {
  let s = emptyState();
  s = applyChange(s, batch([
    addRect("a", { x: 0, y: 0, width: 40, height: 20 }),
    addRect("b", { x: 50, y: 0, width: 40, height: 20 }),
    addCircle("c", { cx: 0, cy: 50, diameter: 8 }),
    addVariable("v0", 12, "width"),
  ]));
  return applyChange(s, linkLengths(s, [{ id: "a", prop: "width" }, { id: "b", prop: "width" }], "v1", "width 2")!);
}

const nameOf = (s: DocState, id: string) => s.entities[id]!.props.name;

describe("renameVariable", () => {
  it("renames a variable, trimming the name", () => {
    const s = linked();
    expect(nameOf(applyChange(s, renameVariable(s, "v1", "rail")!), "v1")).toBe("rail");
    expect(nameOf(applyChange(s, renameVariable(s, "v1", "  shelf depth ")!), "v1")).toBe("shelf depth");
  });

  it("leaves the links to it alone", () => {
    const s = linked();
    const after = applyChange(s, renameVariable(s, "v1", "rail")!);
    expect(after.entities.a!.props.width).toEqual({ ref: "v1" });
    expect(after.entities.b!.props.width).toEqual({ ref: "v1" });
  });

  it("refuses an empty name, the same name, and one another variable has", () => {
    const s = linked();
    expect(renameVariable(s, "v1", "")).toBeUndefined();
    expect(renameVariable(s, "v1", "   ")).toBeUndefined();
    expect(renameVariable(s, "v1", "width 2")).toBeUndefined();
    expect(renameVariable(s, "v1", " width 2 ")).toBeUndefined();
    expect(renameVariable(s, "v1", "width")).toBeUndefined();
  });

  it("renames only variables", () => {
    const s = linked();
    expect(renameVariable(s, "a", "rail")).toBeUndefined();
    expect(renameVariable(s, "nope", "rail")).toBeUndefined();
  });
});

const editorWith = (selection: string[]) => (child: React.ReactElement) =>
  renderToStaticMarkup(createElement(EditorContext.Provider, { value: { editor: { ...initialEditor, selection }, dispatch: () => {} } }, child));

/** The <input> named `label`, if any. */
const input = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0];

describe("renaming in the shape panel", () => {
  it("shows a linked length's variable name as a field to rename it in", () => {
    store.replace(linked());
    const html = editorWith(["a"])(createElement(ShapeFields, { id: "a" }));
    const name = input(html, "Variable name");
    expect(name).toBeDefined();
    expect(name).toContain('value="width 2"');
    expect(html).toContain(">unlink<");
  });

  it("has no name field for a length that isn't linked", () => {
    store.replace(linked());
    const html = editorWith(["c"])(createElement(ShapeFields, { id: "c" }));
    expect(input(html, "Variable name")).toBeUndefined();
  });
});

describe("renaming in Properties › Variables", () => {
  it("lists each variable as a name field and a value field", () => {
    store.replace(linked());
    const html = editorWith([])(createElement(Variables));
    const names = [...html.matchAll(/<input[^>]*aria-label="Variable name"[^>]*>/g)].map((m) => m[0]);
    expect(names).toHaveLength(2);
    expect(names[0]).toContain('value="width"');
    expect(names[1]).toContain('value="width 2"');
    expect(input(html, "Value of width 2")).toContain('value="40"');
    expect(input(html, "Value of width")).toContain('value="12"');
  });

  it("says Duplicate's linked size makes them too, when there are none", () => {
    store.replace(emptyState());
    const html = editorWith([])(createElement(Variables));
    expect(html).toMatch(/[Dd]uplicate/);
  });
});
