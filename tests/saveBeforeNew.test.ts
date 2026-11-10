import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { emptyState } from "@sandtreader/collab/protocol";
import { addRect, serializeDrawing } from "../src/model";
import { answer, currentQuestion } from "../src/app/ask";
import { newDrawing, openDrawing } from "../src/app/file";
import { store } from "../src/app/store";

// New (and Open) with unsaved changes to a drawing that has a file of its
// own offer to save it first, as well as to discard the changes.

/** A file the browser handed us, which Save writes back to. */
const disk = { text: serializeDrawing(emptyState()), writes: 0 };
const handle = {
  name: "bench.dln",
  getFile: async () => ({ name: "bench.dln", text: async () => disk.text }),
  createWritable: async () => {
    let written = "";
    return { write: async (s: string) => { written += s; }, close: async () => { disk.text = written; disk.writes++; } };
  },
};

beforeAll(() => {
  // Just enough of a Chromium window: the File System Access open picker.
  (globalThis as { window?: unknown }).window = { showOpenFilePicker: async () => [handle] };
});

beforeEach(() => {
  while (currentQuestion()) answer(false);
});

/** Open bench.dln and make an unsaved change. */
async function openAndEdit(id: string) {
  store.replace(emptyState());
  store.markSaved();
  expect(await openDrawing()).toBe(true);
  store.commit(addRect(id, { x: 0, y: 0, width: 10, height: 10 }));
  expect(store.dirty).toBe(true);
}

describe("unsaved changes to a drawing with a file", () => {
  it("offers Save, Discard and Cancel", async () => {
    await openAndEdit("a");
    const replaced = newDrawing();
    expect(currentQuestion()).toMatchObject({ confirm: "Save", alternative: "Discard" });
    expect(currentQuestion()!.message).toContain("bench");
    answer(false);
    expect(await replaced).toBe(false);
    expect(store.state.entities.a).toBeDefined();
  });

  it("Save writes the file, then starts the new drawing", async () => {
    await openAndEdit("b");
    const before = disk.writes;
    const replaced = newDrawing();
    answer(true);
    expect(await replaced).toBe(true);
    expect(disk.writes).toBe(before + 1);
    expect(JSON.parse(disk.text).doc.entities.b).toBeDefined();
    expect(store.state.entities.b).toBeUndefined();
  });

  it("Discard starts the new drawing without saving", async () => {
    await openAndEdit("c");
    const before = disk.writes;
    const replaced = newDrawing();
    answer("alternative");
    expect(await replaced).toBe(true);
    expect(disk.writes).toBe(before);
    expect(store.state.entities.c).toBeUndefined();
  });
});
