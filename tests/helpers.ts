import { applyChanges, emptyState, type Change, type DocState } from "@sandtreader/collab/protocol";

export function doc(...changes: Change[]): DocState {
  return applyChanges(emptyState(), changes);
}

export async function waitFor(cond: () => boolean, label: string, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
