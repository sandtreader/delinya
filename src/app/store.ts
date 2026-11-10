// The one DrawingStore for the app, exposed to React.

import { useSyncExternalStore } from "react";
import { DrawingStore } from "../model";

export const store = new DrawingStore();

const subscribe = (fn: () => void) => store.subscribe(fn);

/** Re-renders when the document changes; returns the current document. */
export function useDocument() {
  const get = () => store.state;
  return useSyncExternalStore(subscribe, get, get);
}
