import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { DOCUMENT_ID, KINDS, addRect, resolve, setDocumentProps, setGridSpacing } from "../src/model";
import { gridPitch } from "../src/view/viewport";
import { snapMove, snapPoint } from "../src/canvas/snap";
import { editorReducer, initialEditor } from "../src/app/editor";
import { DEFAULT_GRID_VIEW, loadGridView, saveGridView } from "../src/app/gridView";
import { doc } from "./helpers";

const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };

// Spacing belongs to the drawing: saved and shared. Showing the grid and
// snapping to it are each viewer's own choice, remembered in their browser.

describe("grid spacing", () => {
  it("defaults to 1 mm", () => {
    expect(resolve(doc()).document.gridSpacing).toBe(1);
  });

  it("is saved with the drawing, alongside the title block", () => {
    const titled = apply(doc(), setDocumentProps(doc(), { title: "Bench" }));
    const st = apply(titled, setGridSpacing(titled, 5));
    expect(st.entities[DOCUMENT_ID]!.props).toEqual({ title: "Bench", gridSpacing: 5 });
    expect(resolve(st).document).toMatchObject({ title: "Bench", gridSpacing: 5 });
    // The first change to an untitled drawing adds the document entity.
    expect(setGridSpacing(doc(), 5)).toEqual({ type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: { gridSpacing: 5 } });
  });

  it("changes only to a new positive number", () => {
    const st = apply(doc(), setGridSpacing(doc(), 5));
    expect(setGridSpacing(st, 2.5)).toEqual({ type: "props_changed", id: DOCUMENT_ID, props: { gridSpacing: 2.5 } });
    for (const same of [5, 0, -2, NaN, Infinity]) expect(setGridSpacing(st, same), String(same)).toBeUndefined();
    expect(setGridSpacing(doc(), 1)).toBeUndefined();
  });

  it("falls back to 1 mm, with an issue, for a bad stored value", () => {
    for (const bad of [-3, 0, "5", null]) {
      const r = resolve(doc({ type: "entity_added", id: DOCUMENT_ID, kind: KINDS.document, props: { gridSpacing: bad } }));
      expect(r.document.gridSpacing, String(bad)).toBe(1);
      if (bad !== null) expect(r.issues.some((i) => i.entity === DOCUMENT_ID && i.code === "bad-value"), String(bad)).toBe(true);
    }
  });
});

describe("gridPitch", () => {
  const at = (scale: number) => ({ scale, ox: 0, oy: 0 });

  it("draws the spacing when it is at least 8 px apart, else multiples of it (×2, ×5, ×10…)", () => {
    expect(gridPitch(at(10), 1)).toBe(1);
    expect(gridPitch(at(2), 1)).toBe(5);
    expect(gridPitch(at(2), 5)).toBe(5);
    expect(gridPitch(at(0.5), 5)).toBe(25);
    expect(gridPitch(at(2), 0.5)).toBe(5);
    expect(gridPitch(at(0.05), 1)).toBe(200);
  });

  it("uses 1 mm spacing when not given", () => {
    expect(gridPitch(at(2))).toBe(5);
  });
});

describe("snapping with the grid off", () => {
  const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 10, height: 10 })));

  it("places freely, to 0.01 mm, but still snaps to shapes", () => {
    expect(snapPoint(r, [50.123, 20.456], 2, new Set(), null).point).toEqual([50.12, 20.46]);
    expect(snapPoint(r, [50.123, 20.456], 2, new Set(), 5).point).toEqual([50, 20]);
    expect(snapPoint(r, [10.4, 0.3], 2, new Set(), null).snap?.point).toEqual([10, 0]);
  });

  it("moves by the pointer's own delta, to 0.01 mm", () => {
    expect(snapMove(r, "a", [33.333, 44.444], 2, new Set(["a"]), null).delta).toEqual([33.33, 44.44]);
    expect(snapMove(r, "a", [33.333, 44.444], 2, new Set(["a"]), 5).delta).toEqual([35, 45]);
  });
});

describe("grid view (show, snap)", () => {
  it("shows and snaps by default", () => {
    expect(DEFAULT_GRID_VIEW).toEqual({ visible: true, snap: true });
    expect(initialEditor.grid).toEqual(DEFAULT_GRID_VIEW);
  });

  it("changes in editor state, one setting at a time", () => {
    const hidden = editorReducer(initialEditor, { type: "grid", grid: { visible: false } });
    expect(hidden.grid).toEqual({ visible: false, snap: true });
    expect(editorReducer(hidden, { type: "grid", grid: { snap: false } }).grid).toEqual({ visible: false, snap: false });
  });

  it("is kept for a new or opened drawing: it's this viewer's preference, not the drawing's", () => {
    const hidden = editorReducer(initialEditor, { type: "grid", grid: { visible: false } });
    expect(editorReducer(hidden, { type: "resetLayers" }).grid.visible).toBe(false);
  });
});

describe("grid view storage", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, data };
  }

  it("is remembered in this browser", () => {
    const s = memoryStorage();
    saveGridView(s, { visible: false, snap: true });
    expect(loadGridView(s)).toEqual({ visible: false, snap: true });
  });

  it("falls back to the default when nothing is stored, it's junk, or storage is blocked", () => {
    expect(loadGridView(memoryStorage())).toEqual(DEFAULT_GRID_VIEW);
    expect(loadGridView(null)).toEqual(DEFAULT_GRID_VIEW);
    for (const junk of ["{", "null", "42", '{"visible":"no"}']) {
      expect(loadGridView(memoryStorage({ "delinya.grid": junk })), junk).toEqual(DEFAULT_GRID_VIEW);
    }
    expect(loadGridView(memoryStorage({ "delinya.grid": '{"snap":false}' }))).toEqual({ visible: true, snap: false });
    const blocked = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadGridView(blocked)).toEqual(DEFAULT_GRID_VIEW);
    expect(() => saveGridView(blocked, DEFAULT_GRID_VIEW)).not.toThrow();
  });
});
