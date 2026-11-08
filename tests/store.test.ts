import { describe, it, expect } from "vitest";
import type { Change } from "@sandtreader/collab/protocol";
import { DrawingStore, addRect, addVariable, deleteEntity, invert, linkLengths, moveBy, setLength } from "../src/model";
import type { ResolvedRect } from "../src/model";
import { doc } from "./helpers";

function rectOf(store: DrawingStore, id: string) {
  return store.resolved.shapes[id] as ResolvedRect;
}

describe("invert", () => {
  it("produces exact inverses for every change type", () => {
    const base = doc(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    const cases: Change[] = [
      { type: "entity_added", id: "n", kind: "circle", props: { cx: 0, cy: 0, diameter: 1 } },
      { type: "entity_added", id: "r", kind: "rect", props: { x: 9, y: 9, width: 1, height: 1 } },   // replace
      { type: "entity_removed", id: "r" },
      { type: "props_changed", id: "r", props: { x: 5, newKey: true, width: null } },
      { type: "batch", changes: [
        { type: "props_changed", id: "r", props: { x: 1 } },
        { type: "entity_removed", id: "r" },
        { type: "entity_added", id: "r", kind: "rect", props: { x: 2, y: 2, width: 2, height: 2 } },
      ] },
      { type: "state_replaced", state: doc() },
    ];
    for (const c of cases) {
      const store = new DrawingStore();
      store.replace(base);
      const inverse = invert(store.state, c);
      store.commit(c);
      store.applyRemote(inverse);
      expect(store.state, JSON.stringify(c)).toEqual(base);
    }
  });
});

describe("DrawingStore", () => {
  it("applies commits, recomputes geometry lazily, and notifies", () => {
    const store = new DrawingStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    expect(rectOf(store, "r").width).toBe(10);
    const r1 = store.resolved;
    expect(store.resolved).toBe(r1);              // cached
    store.commit(setLength(store.state, "r", "width", 20)!);
    expect(store.resolved).not.toBe(r1);
    expect(rectOf(store, "r").width).toBe(20);
    expect(notified).toBe(2);
  });

  it("undoes and redoes, emitting the inverse changes for peers", () => {
    const store = new DrawingStore();
    const emitted: Change[] = [];
    store.onEmit((c) => emitted.push(c));

    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.commit(setLength(store.state, "r", "width", 20)!);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);

    expect(store.undo()).toBe(true);
    expect(rectOf(store, "r").width).toBe(10);
    expect(emitted.at(-1)).toEqual({ type: "props_changed", id: "r", props: { width: 10 } });

    expect(store.undo()).toBe(true);
    expect(store.state.entities.r).toBeUndefined();
    expect(emitted.at(-1)).toEqual({ type: "entity_removed", id: "r" });
    expect(store.undo()).toBe(false);

    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(rectOf(store, "r").width).toBe(20);
    expect(store.redo()).toBe(false);
    expect(emitted).toHaveLength(6);
  });

  it("folds a drag gesture into a single undo step", () => {
    const store = new DrawingStore();
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.commit(moveBy(store.state, "r", 1, 0, { start: true })!);
    store.commit(moveBy(store.state, "r", 1, 0)!);
    store.commit(moveBy(store.state, "r", 1, 0, { end: true })!);
    expect(rectOf(store, "r").x).toBe(3);
    store.undo();
    expect(rectOf(store, "r").x).toBe(0);
    store.redo();
    expect(rectOf(store, "r").x).toBe(3);
  });

  it("groups a multi-shape drag with beginGesture/endGesture", () => {
    const store = new DrawingStore();
    store.commit(addRect("a", { x: 0, y: 0, width: 10, height: 10 }));
    store.commit(addRect("b", { x: 50, y: 0, width: 10, height: 10 }));
    store.beginGesture();
    for (let i = 0; i < 3; i++) {
      store.commit(moveBy(store.state, "a", 1, 0)!);
      store.commit(moveBy(store.state, "b", 1, 0)!);
    }
    store.endGesture();
    expect(rectOf(store, "a").x).toBe(3);
    expect(rectOf(store, "b").x).toBe(53);
    store.undo();
    expect(rectOf(store, "a").x).toBe(0);
    expect(rectOf(store, "b").x).toBe(50);
    expect(store.canUndo).toBe(true);     // the two adds remain
    // An empty gesture leaves no entry behind.
    store.beginGesture();
    store.endGesture();
    store.redo();
    expect(rectOf(store, "b").x).toBe(53);
  });

  it("closes an unfinished gesture when something else happens", () => {
    const store = new DrawingStore();
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.commit(moveBy(store.state, "r", 5, 0, { start: true })!);
    store.commit(addVariable("v", 1));          // not part of the gesture
    store.undo();
    expect(store.state.entities.v).toBeUndefined();
    expect(rectOf(store, "r").x).toBe(5);
    store.undo();
    expect(rectOf(store, "r").x).toBe(0);
  });

  it("undoes a cascade delete and a link batch as single steps", () => {
    const store = new DrawingStore();
    store.commit(addRect("a", { x: 0, y: 0, width: 10, height: 10 }));
    store.commit(addRect("b", { x: 0, y: 0, width: 12, height: 10 }));
    store.commit(linkLengths(store.state, [{ id: "a", prop: "width" }, { id: "b", prop: "width" }], "w")!);
    const linked = store.state;
    store.commit(deleteEntity(store.state, "a")!);
    store.undo();
    expect(store.state).toEqual(linked);
    store.undo();
    expect(store.state.entities.w).toBeUndefined();
    expect(store.state.entities.b!.props.width).toBe(12);
  });

  it("keeps remote changes out of undo history and does not emit them", () => {
    const store = new DrawingStore();
    const emitted: Change[] = [];
    store.onEmit((c) => emitted.push(c));
    store.applyRemote(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    expect(store.canUndo).toBe(false);
    expect(emitted).toEqual([]);
    expect(rectOf(store, "r").width).toBe(10);
  });

  it("replace clears history and optionally announces itself", () => {
    const store = new DrawingStore();
    const emitted: Change[] = [];
    store.onEmit((c) => emitted.push(c));
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    store.replace(doc(addVariable("v", 1)));
    expect(store.canUndo).toBe(false);
    expect(emitted).toHaveLength(1);
    store.replace(doc(), { emit: true });
    expect(emitted.at(-1)).toEqual({ type: "state_replaced", state: doc() });
  });

  it("drops the oldest entries past the history limit", () => {
    const store = new DrawingStore({ historyLimit: 2 });
    store.commit(addRect("r", { x: 0, y: 0, width: 1, height: 1 }));
    store.commit(setLength(store.state, "r", "width", 2)!);
    store.commit(setLength(store.state, "r", "width", 3)!);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.undo()).toBe(false);
    expect(rectOf(store, "r").width).toBe(1);
  });
});
