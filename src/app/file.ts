// Save and open drawings as local files.
//
// The current file's name and handle are editor state, never part of the
// document. Where the browser has the File System Access API (Chromium),
// Save writes back to the file the drawing came from; elsewhere Save
// downloads a copy and Open uses a file input.
//
// Loading goes through store.replace(..., { emit: true }) so a connected
// session gets state_replaced, then markSaved() so the drawing starts clean.

import { useSyncExternalStore } from "react";
import { emptyState } from "@sandtreader/collab/protocol";
import { parseDrawing, serializeDrawing } from "../model";
import { ask, choose, tell } from "./ask";
import { downloadBlob } from "./download";
import { store } from "./store";

export const EXTENSION = ".dln";
const UNTITLED = "Untitled";
/** What Open offers: .dln files (JSON inside). */
export const FILE_TYPES = [{ description: "Delinya drawing", accept: { "application/json": [EXTENSION] } }];

// Not in TypeScript's DOM lib yet; the handles themselves are.
interface PickerOptions {
  suggestedName?: string;
  types?: typeof FILE_TYPES;
  multiple?: boolean;
}
interface Pickers {
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileSystemFileHandle[]>;
}
const pickers = (): Pickers => window as unknown as Pickers;

interface CurrentFile {
  /** Display name, without the extension. */
  name: string;
  /** Where Save writes, if the browser gave us one. */
  handle?: FileSystemFileHandle;
}

let current: CurrentFile = { name: UNTITLED };
const listeners = new Set<() => void>();

function setCurrent(f: CurrentFile): void {
  current = f;
  for (const fn of listeners) fn();
}

/** A file's display name: without a drawing extension. */
export const baseName = (fileName: string) => fileName.replace(/\.dln$/i, "") || UNTITLED;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

// ---- Hooks ----

export function useFileName(): string {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => current.name,
  );
}

export function useDirty(): boolean {
  return useSyncExternalStore((fn) => store.subscribe(fn), () => store.dirty);
}

// ---- Commands ----
// Each resolves true if the document was replaced, so the caller can reset
// editor state (selection, view).

/**
 * True if there is nothing unsaved, or the user saves it or agrees to lose
 * it. Saving is offered when the drawing has a file of its own to go back
 * to; an untitled one would need Save as, so it is only asked to discard.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!store.dirty) return true;
  if (!hasFile()) {
    return ask({ title: "Unsaved changes", message: `Discard unsaved changes to “${current.name}”?`, confirm: "Discard", danger: true });
  }
  const c = await choose({
    title: "Unsaved changes",
    message: `Save changes to “${current.name}” first?`,
    confirm: "Save",
    alternative: "Discard",
  });
  if (c === "cancel") return false;
  if (c === "alternative") return true;
  try {
    await saveDrawing();
  } catch (e) {
    void tell("Couldn’t save", e instanceof Error ? e.message : String(e));
    return false;
  }
  // A failed write says so and leaves the drawing unsaved: don't lose it.
  return !store.dirty;
}

/** The drawing came from, or was saved to, a file of its own. */
function hasFile(): boolean {
  return current.handle !== undefined || current.name !== UNTITLED;
}

function load(text: string, file: CurrentFile): boolean {
  const result = parseDrawing(text);
  if (!result.ok) {
    void tell("Couldn’t open", `“${file.name}”: ${result.error}.`);
    return false;
  }
  store.replace(result.state, { emit: true });
  store.markSaved();
  setCurrent(file);
  return true;
}

export async function newDrawing(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  store.replace(emptyState(), { emit: true });
  store.markSaved();
  setCurrent({ name: UNTITLED });
  return true;
}

export async function openDrawing(): Promise<boolean> {
  // Answering is a click or key press, so the picker below still has the
  // user activation it needs.
  if (!(await confirmDiscard())) return false;
  const { showOpenFilePicker } = pickers();
  if (showOpenFilePicker) {
    let handle: FileSystemFileHandle | undefined;
    try {
      [handle] = await showOpenFilePicker({ types: FILE_TYPES });
    } catch (e) {
      if (isAbort(e)) return false;
      throw e;
    }
    if (!handle) return false;
    const file = await handle.getFile();
    return load(await file.text(), { name: baseName(file.name), handle });
  }
  const file = await pickWithInput();
  if (!file) return false;
  return load(await file.text(), { name: baseName(file.name) });
}

/** Save to the current file, asking where only if there isn't one. */
export async function saveDrawing(): Promise<void> {
  if (current.handle) await writeTo(current.handle, current.name);
  else await saveDrawingAs();
}

export async function saveDrawingAs(): Promise<void> {
  const { showSaveFilePicker } = pickers();
  if (!showSaveFilePicker) {
    download();
    return;
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await showSaveFilePicker({ suggestedName: current.name + EXTENSION, types: FILE_TYPES });
  } catch (e) {
    if (isAbort(e)) return;
    throw e;
  }
  if (await writeTo(handle, baseName(handle.name))) setCurrent({ name: baseName(handle.name), handle });
}

// ---- Internals ----

async function writeTo(handle: FileSystemFileHandle, name: string): Promise<boolean> {
  const state = store.state;
  try {
    const out = await handle.createWritable();
    await out.write(serializeDrawing(state));
    await out.close();
  } catch (e) {
    void tell("Couldn’t save", `“${name}”: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  // An edit made while the write was in flight is not in the file.
  if (store.state === state) store.markSaved();
  return true;
}

/** Fallback save: the browser's download, which we can't confirm landed. */
function download(): void {
  downloadBlob(serializeDrawing(store.state), current.name + EXTENSION, "application/json");
  store.markSaved();
}

function pickWithInput(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = EXTENSION;
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
