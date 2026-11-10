// Full screen for the whole app, from the status bar. The browser owns
// the state (Esc and F11 change it too), so the button follows
// fullscreenchange rather than keeping its own.

import { useSyncExternalStore } from "react";

/** The part of `document` this needs; a fake in tests. */
export type FullscreenDoc = Pick<Document, "fullscreenEnabled" | "fullscreenElement" | "exitFullscreen" | "addEventListener" | "removeEventListener"> & {
  documentElement: Pick<HTMLElement, "requestFullscreen">;
};

/** False where the browser can't (iPhone Safari, an iframe without permission). */
export function canFullscreen(doc: FullscreenDoc = document): boolean {
  return !!doc.fullscreenEnabled && typeof doc.documentElement?.requestFullscreen === "function";
}

export function isFullscreen(doc: FullscreenDoc = document): boolean {
  return !!doc.fullscreenElement;
}

/** Full screen from a window, or back. A refusal leaves things as they are. */
export async function toggleFullscreen(doc: FullscreenDoc = document): Promise<void> {
  try {
    if (isFullscreen(doc)) await doc.exitFullscreen();
    else await doc.documentElement.requestFullscreen();
  } catch {
    // Refused (no user gesture, or denied): nothing to undo.
  }
}

export function useFullscreen(): boolean {
  return useSyncExternalStore(
    (fn) => { document.addEventListener("fullscreenchange", fn); return () => document.removeEventListener("fullscreenchange", fn); },
    () => isFullscreen(),
  );
}
