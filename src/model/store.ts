// The single point of mutation.
//
// Every change to the document, local or remote, passes through here:
//   commit(change)      a local edit: apply, record for undo, notify, emit
//   applyRemote(change) from the collab client: apply, notify, no undo, no emit
//   replace(state)      load a file or receive a snapshot
//
// Undo is local-only and change-based: each history entry holds the forward
// changes and their inverses, computed against the document at commit time.
// Changes flagged gestureStart..gestureEnd fold into one entry so a drag
// undoes in one step.

import {
  applyChange, emptyState, isTransient,
  type Change, type DocState, type Props, type PropValue,
} from "@sandtreader/collab/protocol";
import { resolve, type Resolved } from "./resolve";

export type Listener = (store: DrawingStore) => void;
export type Emitter = (change: Change) => void;

interface HistoryEntry {
  forward: Change[];
  inverse: Change[];
  /** Set while this entry is an open drag on one entity. */
  gestureEntity?: string;
}

export interface StoreOptions {
  /** Keep at most this many undo entries. Default 200. */
  historyLimit?: number;
}

export class DrawingStore {
  private _state: DocState = emptyState();
  private _resolved: Resolved | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private openGesture: HistoryEntry | null = null;
  private listeners = new Set<Listener>();
  private emitters = new Set<Emitter>();
  private readonly historyLimit: number;

  constructor(options: StoreOptions = {}) {
    this.historyLimit = options.historyLimit ?? 200;
  }

  get state(): DocState { return this._state; }

  /** Derived geometry, recomputed lazily after each change. */
  get resolved(): Resolved {
    if (!this._resolved) this._resolved = resolve(this._state);
    return this._resolved;
  }

  get canUndo(): boolean { return this.undoStack.length > 0 || this.openGesture !== null; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  // ---- Mutation ----

  /** A local edit. */
  commit(change: Change): void {
    if (!isTransient(change)) this.record(change);
    this.apply(change);
    for (const emit of this.emitters) emit(change);
  }

  /** A change that arrived from another client. */
  applyRemote(change: Change): void {
    this.apply(change);
  }

  /** Swap the whole document. Clears undo history; `emit` sends state_replaced to peers. */
  replace(state: DocState, { emit = false } = {}): void {
    this.undoStack = [];
    this.redoStack = [];
    this.openGesture = null;
    this.apply({ type: "state_replaced", state });
    if (emit) for (const e of this.emitters) e({ type: "state_replaced", state });
  }

  undo(): boolean {
    this.closeGesture();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (const c of entry.inverse) { this.apply(c); for (const emit of this.emitters) emit(c); }
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const c of entry.forward) { this.apply(c); for (const emit of this.emitters) emit(c); }
    this.undoStack.push(entry);
    return true;
  }

  // ---- Observation ----

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Receive every outgoing change (local commits, undo, redo, replace). */
  onEmit(fn: Emitter): () => void {
    this.emitters.add(fn);
    return () => { this.emitters.delete(fn); };
  }

  // ---- Internals ----

  private apply(change: Change): void {
    this._state = applyChange(this._state, change);
    this._resolved = null;
    for (const fn of this.listeners) fn(this);
  }

  private record(change: Change): void {
    const inverse = invert(this._state, change);
    const gesture = gestureFlags(change);
    this.redoStack = [];

    const target = change.type === "props_changed" ? change.id : undefined;
    if (this.openGesture && !gesture.start && target === this.openGesture.gestureEntity) {
      this.openGesture.forward.push(change);
      this.openGesture.inverse.unshift(inverse);
      if (gesture.end) this.closeGesture();
      return;
    }
    // Anything else ends an unfinished drag before it is recorded.
    this.closeGesture();
    const entry: HistoryEntry = { forward: [change], inverse: [inverse] };
    if (gesture.start && !gesture.end) {
      entry.gestureEntity = target;
      this.openGesture = entry;
    } else {
      this.push(entry);
    }
  }

  private closeGesture(): void {
    if (this.openGesture) {
      delete this.openGesture.gestureEntity;
      this.push(this.openGesture);
      this.openGesture = null;
    }
  }

  private push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
  }
}

function gestureFlags(change: Change): { start: boolean; end: boolean } {
  if (change.type === "props_changed") return { start: !!change.gestureStart, end: !!change.gestureEnd };
  return { start: false, end: false };
}

/**
 * The change that undoes `change` when applied to the state that results
 * from applying `change` to `before`. Pure; exported for tests.
 */
export function invert(before: DocState, change: Change): Change {
  switch (change.type) {
    case "entity_added": {
      const prev = before.entities[change.id];
      return prev
        ? { type: "entity_added", id: change.id, kind: prev.kind, props: { ...prev.props } }
        : { type: "entity_removed", id: change.id };
    }
    case "entity_removed": {
      const prev = before.entities[change.id];
      // Removing something absent is a no-op; so is its inverse.
      return prev
        ? { type: "entity_added", id: change.id, kind: prev.kind, props: { ...prev.props } }
        : { type: "batch", changes: [] };
    }
    case "props_changed": {
      const prev = before.entities[change.id];
      if (!prev) return { type: "batch", changes: [] };
      const props: Props = {};
      for (const key of Object.keys(change.props)) {
        const old: PropValue | undefined = prev.props[key];
        props[key] = old === undefined ? null : old;
      }
      return { type: "props_changed", id: change.id, props };
    }
    case "batch": {
      const inverses: Change[] = [];
      let state = before;
      for (const c of change.changes) {
        inverses.unshift(invert(state, c));
        state = applyChange(state, c);
      }
      return { type: "batch", changes: inverses };
    }
    case "state_replaced":
      return { type: "state_replaced", state: before };
  }
}
