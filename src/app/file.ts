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
import { store } from "./store";

export const EXTENSION = ".delinya";
const UNTITLED = "Untitled";
const FILE_TYPES = [{ description: "Delinya drawing", accept: { "application/json": [EXTENSION, ".json"] } }];

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

const baseName = (fileName: string) => fileName.replace(/\.(delinya|json)$/i, "") || UNTITLED;

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

/** True if there is nothing unsaved or the user agrees to lose it. */
function confirmDiscard(): boolean {
  return !store.dirty || window.confirm(`Discard unsaved changes to “${current.name}”?`);
}

function load(text: string, file: CurrentFile): boolean {
  const result = parseDrawing(text);
  if (!result.ok) {
    window.alert(`Couldn’t open “${file.name}”: ${result.error}`);
    return false;
  }
  store.replace(result.state, { emit: true });
  store.markSaved();
  setCurrent(file);
  return true;
}

export function newDrawing(): boolean {
  if (!confirmDiscard()) return false;
  store.replace(emptyState(), { emit: true });
  store.markSaved();
  setCurrent({ name: UNTITLED });
  return true;
}

export async function openDrawing(): Promise<boolean> {
  if (!confirmDiscard()) return false;
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
    window.alert(`Couldn’t save “${name}”: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  // An edit made while the write was in flight is not in the file.
  if (store.state === state) store.markSaved();
  return true;
}

/** Fallback save: the browser's download, which we can't confirm landed. */
function download(): void {
  const blob = new Blob([serializeDrawing(store.state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = current.name + EXTENSION;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  store.markSaved();
}

function pickWithInput(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${EXTENSION},.json,application/json`;
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
