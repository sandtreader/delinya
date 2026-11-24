// Line styles: how a line, rect, circle or path is stroked. A pen width on
// paper (mm, the ISO 128 widths offered; the same at any print scale, and
// on screen at any zoom) and a dash pattern, set per shape and stored as
// `lineWidth` and `lineDash` only where they differ from the default
// (0.35, solid). Text has no line style.
//
// Patterns follow ISO 128 in units of the width, but never shorter than at
// 0.35 mm, so thin lines still read as dashed: u = max(width, 0.35).
// Lengths here are what is seen: dashed 12u dash, 3u gap; dotted dots (the
// width across) 3u apart; dash-dot (a centre line) 24u dash, 3u gap, dot,
// 3u gap. Strokes have round caps, which add half the width at each end of
// a dash, so the array a renderer draws with (`dashArray`) shortens each
// dash by the width and lengthens each gap by it.

import type { Change, DocState } from "@sandtreader/collab/protocol";
import { batch, propsChanged } from "./actions";
import type { Resolved } from "./resolve";
import { type EntityId, type LineDash, type LineStyle, type StrokeProps, DEFAULT_LINE_STYLE, LINE_DASHES } from "./types";

/** The kinds stroked with a line style. */
export const STROKED_KINDS: ReadonlySet<string> = new Set(["line", "rect", "circle", "polyline"]);

/** The shortest dash unit: a thinner line dashes as 0.35 does. */
export const DASH_UNIT_MIN = 0.35;

/** Each pattern as seen, in dash units: dash, gap, …; a 0 dash is a dot. */
const PATTERNS: Record<LineDash, readonly number[]> = {
  solid: [],
  dashed: [12, 3],
  dotted: [0, 3],
  dashdot: [24, 3, 0, 3],
};

export function isLineDash(v: unknown): v is LineDash {
  return (LINE_DASHES as readonly unknown[]).includes(v);
}

export function isLineWidth(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** The pattern's lengths as seen, for a line `width` wide: [] for solid. */
export function dashLengths(dash: LineDash, width: number): number[] {
  const u = Math.max(width, DASH_UNIT_MIN);
  return PATTERNS[dash].map((k) => k * u);
}

/**
 * The array to stroke with round caps, `unit` and `width` in the same
 * units: each dash shortened by the width (a dot stays 0), each gap
 * lengthened by it, so what is seen is the pattern.
 */
export function roundCapArray(dash: LineDash, unit: number, width: number): number[] {
  return PATTERNS[dash].map((k, i) => (i % 2 === 0 ? Math.max(0, k * unit - width) : k * unit + width));
}

/** The array SVG and PDF stroke a line `width` mm wide with (round caps), in mm. */
export function dashArray(dash: LineDash, width: number): number[] {
  return roundCapArray(dash, Math.max(width, DASH_UNIT_MIN), width);
}

/** What a new shape stores for a style: nothing for the default, else what differs. */
export function styleProps(style: LineStyle): StrokeProps {
  const out: StrokeProps = {};
  if (style.width !== DEFAULT_LINE_STYLE.width) out.lineWidth = style.width;
  if (style.dash !== DEFAULT_LINE_STYLE.dash) out.lineDash = style.dash;
  return out;
}

/**
 * Set the line width and/or pattern of the stroked shapes among `ids`, as
 * one change; the default is stored as nothing. Undefined when nothing
 * would change, or the style given is no good.
 */
export function setLineStyle(state: DocState, ids: readonly EntityId[], style: Partial<LineStyle>): Change | undefined {
  if (style.width !== undefined && !isLineWidth(style.width)) return undefined;
  if (style.dash !== undefined && !isLineDash(style.dash)) return undefined;
  const changes: Change[] = [];
  for (const id of new Set(ids)) {
    const e = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined;
    if (!e || !STROKED_KINDS.has(e.kind)) continue;
    const props: Record<string, number | string | null> = {};
    const want = (key: "lineWidth" | "lineDash", value: number | string | undefined, fallback: number | string) => {
      if (value === undefined) return;
      const has = Object.hasOwn(e.props, key);
      if (value === fallback) { if (has) props[key] = null; }
      else if (!has || e.props[key] !== value) props[key] = value;
    };
    want("lineWidth", style.width, DEFAULT_LINE_STYLE.width);
    want("lineDash", style.dash, DEFAULT_LINE_STYLE.dash);
    if (Object.keys(props).length) changes.push(propsChanged(id, props));
  }
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/** A selection's line style, each part null where the shapes differ. */
export interface CommonLineStyle {
  width: number | null;
  dash: LineDash | null;
}

/** The style the stroked shapes among `ids` share; null with none of them. */
export function commonLineStyle(resolved: Resolved, ids: readonly EntityId[]): CommonLineStyle | null {
  let out: CommonLineStyle | null = null;
  for (const id of ids) {
    const s = Object.hasOwn(resolved.shapes, id) ? resolved.shapes[id] : undefined;
    if (!s || s.kind === "text") continue;
    if (!out) out = { width: s.style.width, dash: s.style.dash };
    else {
      if (out.width !== s.style.width) out.width = null;
      if (out.dash !== s.style.dash) out.dash = null;
    }
  }
  return out;
}
