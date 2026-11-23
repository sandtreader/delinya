// Typing a text box's text into a field, committed as you type so the
// drawing follows: the first change opens a gesture (or joins one already
// open, as a box just drawn has) and `end` closes it, so the whole edit is
// one undo step. Shared by the panel's text field and the field on the drawing.

import { useEffect, useRef } from "react";
import type { Change } from "@sandtreader/collab/protocol";
import { setText, type EntityId } from "../model";
import { store } from "./store";

export interface LiveText {
  /** Coming into the field: remember the text, for `revert`. */
  start(): void;
  /** Take the gesture already open (a box just drawn) as this edit's, for `end` to close or `abandon` to take back. */
  join(): void;
  /** The field's new text: commit it, inside the edit's gesture. */
  change(text: string): void;
  /** Put back the text it had at `start`, inside the gesture, so the edit and its undoing are one step. */
  revert(): void;
  /** Leaving the field: close the gesture. Also done if the field is taken away mid-edit, unless the caller does it. */
  end(): void;
  /**
   * Leaving the field with one last change (deleting a box left empty),
   * committed inside the edit's gesture (one opened for it if none is), so
   * it is the same undo step; then close the gesture.
   */
  endWith(last: Change): void;
  /** Leaving the field, taking back everything in the edit's gesture. False if it had none open. */
  abandon(): boolean;
}

export interface LiveTextOptions {
  /** End the edit when the field goes mid-edit. Default true; false if the caller finishes it itself. */
  endOnUnmount?: boolean;
}

export function useLiveText(id: EntityId, { endOnUnmount = true }: LiveTextOptions = {}): LiveText {
  // While editing: the text on arrival, and whether the edit has a gesture.
  const edit = useRef<{ original: string; gesture: boolean } | null>(null);
  const current = () => {
    const t = store.state.entities[id]?.props.text;
    return typeof t === "string" ? t : "";
  };
  const editing = () => (edit.current ??= { original: current(), gesture: false });
  // The edit's gesture, while still open: undo closes it, and then it isn't ours to close.
  const own = () => !!edit.current?.gesture && store.gestureOpen;
  const end = () => {
    if (own()) store.endGesture();
    edit.current = null;
  };
  // Taken away mid-edit (no blur comes): still one undo step.
  useEffect(() => (endOnUnmount ? end : undefined), []);
  return {
    start: () => { edit.current = { original: current(), gesture: false }; },
    join: () => { if (store.gestureOpen) editing().gesture = true; },
    change: (text) => {
      const c = setText(store.state, id, text);
      if (!c) return;
      const e = editing();
      // A gesture already open (a box just drawn, or this edit's) takes the
      // change; beginning another would close it.
      if (!store.gestureOpen) store.beginGesture();
      e.gesture = true;
      store.commit(c);
    },
    revert: () => {
      const e = edit.current;
      const c = e && setText(store.state, id, e.original);
      if (c) store.commit(c);
    },
    end,
    endWith: (last) => {
      if (!own()) store.beginGesture();
      store.commit(last);
      store.endGesture();
      edit.current = null;
    },
    abandon: () => {
      const had = own();
      if (had) store.abandonGesture();
      edit.current = null;
      return had;
    },
  };
}
