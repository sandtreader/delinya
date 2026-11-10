import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "@sandtreader/collab/protocol";
import { answer, ask, currentQuestion, tell } from "../src/app/ask";
import { newDrawing } from "../src/app/file";
import { store } from "../src/app/store";
import { addRect } from "../src/model";

/** Let resolved promises run their callbacks. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  while (currentQuestion()) answer(false);
});

describe("ask", () => {
  it("shows the question until it is answered, then resolves with the answer", async () => {
    const yes = ask({ title: "Delete layer", message: "Delete layer 2?", confirm: "Delete", danger: true });
    expect(currentQuestion()).toMatchObject({ title: "Delete layer", message: "Delete layer 2?", confirm: "Delete", danger: true });
    answer(true);
    expect(currentQuestion()).toBeNull();
    await expect(yes).resolves.toBe(true);

    const no = ask({ title: "Delete layer", message: "Delete layer 3?", confirm: "Delete" });
    answer(false);
    await expect(no).resolves.toBe(false);
  });

  it("queues a second question behind the first", async () => {
    const first = ask({ title: "One", message: "First?" });
    const second = ask({ title: "Two", message: "Second?" });
    expect(currentQuestion()?.title).toBe("One");
    answer(true);
    expect(currentQuestion()?.title).toBe("Two");
    answer(false);
    expect(currentQuestion()).toBeNull();
    expect([await first, await second]).toEqual([true, false]);
  });

  it("tell has only an OK button and resolves when dismissed", async () => {
    let done = false;
    const told = tell("Couldn’t save", "Disk full").then(() => { done = true; });
    expect(currentQuestion()).toMatchObject({ title: "Couldn’t save", message: "Disk full", cancel: null });
    await settle();
    expect(done).toBe(false);
    answer(false);
    await told;
    expect(done).toBe(true);
  });

  it("ignores an answer with nothing asked", () => {
    expect(() => answer(true)).not.toThrow();
    expect(currentQuestion()).toBeNull();
  });
});

describe("discarding unsaved changes", () => {
  it("asks in our own dialog and keeps the drawing if the answer is no", async () => {
    store.replace(emptyState());
    store.markSaved();
    store.commit(addRect("a", { x: 0, y: 0, width: 10, height: 10 }));
    expect(store.dirty).toBe(true);

    const kept = newDrawing();
    expect(currentQuestion()).toMatchObject({ confirm: "Discard", danger: true });
    answer(false);
    await expect(kept).resolves.toBe(false);
    expect(store.state.entities.a).toBeDefined();

    const replaced = newDrawing();
    answer(true);
    await expect(replaced).resolves.toBe(true);
    expect(store.state.entities.a).toBeUndefined();
    expect(store.dirty).toBe(false);
  });

  it("doesn't ask when there is nothing unsaved", async () => {
    store.replace(emptyState());
    store.markSaved();
    const replaced = newDrawing();
    expect(currentQuestion()).toBeNull();
    await expect(replaced).resolves.toBe(true);
  });
});
