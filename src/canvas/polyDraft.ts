// A path being drawn with the Path tool, before it is committed: the nodes
// clicked so far. Pure; the canvas keeps the draft and commits it with
// addPolyline when it is finished.

import { applyChange, emptyState } from "@sandtreader/collab/protocol";
import { addPolyline, distance, resolve, type Point, type PolyNode, type ResolvedPolyline } from "../model";

export interface PolyDraft {
  /** At least one. */
  readonly nodes: PolyNode[];
}

const node = ([x, y]: Point, curve: boolean): PolyNode => ({ x, y, type: curve ? "curve" : "cusp" });

const last = (d: PolyDraft) => d.nodes[d.nodes.length - 1]!;

/**
 * Add a node at `point`: a curve node (Shift) or a cusp. The first starts
 * a draft. A click within `same` mm of the last node adds nothing (the
 * second click of a double-click), returning the draft unchanged.
 */
export function draftAdd(draft: PolyDraft | null, point: Point, curve: boolean, same = 0): PolyDraft {
  if (!draft) return { nodes: [node(point, curve)] };
  const end = last(draft);
  if (distance([end.x, end.y], point) <= same) return draft;
  return { ...draft, nodes: [...draft.nodes, node(point, curve)] };
}

/** The nodes to preview: the draft's and a provisional one at the pointer, so auto curves bend as it moves. */
export function draftPreview(draft: PolyDraft, pointer: Point, curve: boolean): PolyNode[] {
  return [...draft.nodes, node(pointer, curve)];
}

/** Whether a click at `point` closes the path: on its first node (within `tolerance` mm), with 3 or more nodes. */
export function draftCloses(draft: PolyDraft, point: Point, tolerance: number): boolean {
  const first = draft.nodes[0]!;
  return draft.nodes.length >= 3 && distance([first.x, first.y], point) <= tolerance;
}

/** The path to commit, or null with fewer than 2 nodes (nothing to draw). Closed needs 3. */
export function draftFinish(draft: PolyDraft, closed: boolean): { nodes: PolyNode[]; closed: boolean } | null {
  if (draft.nodes.length < 2) return null;
  return { nodes: draft.nodes, closed: closed && draft.nodes.length >= 3 };
}

/** Take back the last node; null when that was the only one. */
export function draftUndo(draft: PolyDraft): PolyDraft | null {
  return draft.nodes.length <= 1 ? null : { ...draft, nodes: draft.nodes.slice(0, -1) };
}

/** The draft as a resolved path, for drawing it (auto curves smoothed as committed ones are); undefined below 2 nodes. */
export function draftShape(nodes: PolyNode[], closed = false): ResolvedPolyline | undefined {
  const s = resolve(applyChange(emptyState(), addPolyline("draft", { nodes, closed }))).shapes.draft;
  return s?.kind === "polyline" ? s : undefined;
}
