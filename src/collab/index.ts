// Delinya's binding to @sandtreader/collab.
//
// The store is already the single point of mutation, so the adapter is
// thin: snapshots and remote changes go into the store without touching
// undo history, and everything the store emits goes to the client. The
// client's suppress() stops remote applications echoing back out.

import type { CollabClient, CollabDocument } from "@sandtreader/collab/client";
import type { DrawingStore } from "../model/store";

export const COLLAB_APP = "delinya";

export function collabDocument(store: DrawingStore): CollabDocument {
  return {
    getSnapshot: () => store.state,
    applySnapshot: (state) => store.replace(state),
    applyChange: (change) => store.applyRemote(change),
  };
}

/** Wire a store to a client. Returns an unsubscribe. */
export function bindCollab(store: DrawingStore, client: CollabClient): () => void {
  return store.onEmit((change) => client.send(change));
}
