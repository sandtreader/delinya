// Drawing files: the document as pretty JSON in a small versioned envelope.
//
// The file holds the DocState exactly as synced, nothing derived. Parsing
// checks only the generic entity shape, not each kind's props: resolve()
// already turns bad or missing props into issues. Unknown kinds and keys
// are kept or ignored so additive changes need no version bump; bump
// FILE_VERSION only when an older reader would misread the file.

import type { DocState, Entity } from "./types";

export const FILE_FORMAT = "delinya";
export const FILE_VERSION = 1;

export type ParseResult = { ok: true; state: DocState } | { ok: false; error: string };

export function serializeDrawing(state: DocState): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, doc: state }, null, 2) + "\n";
}

/** Never throws; errors are short and shown to the user. */
export function parseDrawing(text: string): ParseResult {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return fail("Not a Delinya drawing (not valid JSON)"); }
  if (!isObject(json) || json.format !== FILE_FORMAT) return fail("Not a Delinya drawing");
  if (typeof json.version !== "number") return fail("This drawing has no valid version");
  if (json.version > FILE_VERSION) return fail("This file was made by a newer version of Delinya");

  const entities = isObject(json.doc) ? json.doc.entities : undefined;
  if (!isObject(entities)) return fail("This drawing has no entities");
  const out: Array<[string, Entity]> = [];
  for (const [id, e] of Object.entries(entities)) {
    if (!isObject(e) || typeof e.kind !== "string" || !isObject(e.props)) {
      return fail(`This drawing is damaged (entity "${id}")`);
    }
    // Any JSON value is a valid PropValue, so props need no deeper check.
    out.push([id, { kind: e.kind, props: e.props as Entity["props"] }]);
  }
  // fromEntries defines own keys, so an id like "__proto__" stays data.
  return { ok: true, state: { entities: Object.fromEntries(out) } };
}

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
