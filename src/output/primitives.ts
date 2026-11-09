// Resolved drawing -> primitives, in model mm.
//
// Dimensions and labels follow the canvas's DimensionView and
// RadiusLabelView so output looks like the screen. Text size and tick
// length are in the same units as the model, so callers printing at a
// scale pass sizes divided by it and get fixed sizes on paper.

import {
  type Bounds, type EntityId, type Path, type Point, type ResolvedDimension, type ResolvedRadiusLabel, type Resolved,
  boundsOfPoints, isVisible, midpoint, pathBounds, pointsNear, polar, segment, unionBounds,
} from "../model";
import { formatMm } from "../view/format";
import { textWidth } from "./text";
import type { Primitive, TextPrim } from "./types";

export interface PrimitiveOptions {
  /** Include dimensions and radius labels. */
  dimensions: boolean;
  textSize: number;
  /** Half-length of a dimension's end ticks. */
  tick: number;
  /** Layers the viewer has hidden: left out, so output is what they see. */
  hidden?: ReadonlySet<EntityId>;
}

const NO_LAYERS: ReadonlySet<EntityId> = new Set();

/** The visible shapes, and with `dimensions` their dimensions and labels; hidden layers are left out. */
export function drawingPrimitives(resolved: Resolved, o: PrimitiveOptions): Primitive[] {
  const hidden = o.hidden ?? NO_LAYERS;
  const shown = (id: EntityId) => isVisible(resolved, id, hidden);
  const out: Primitive[] = [];
  for (const id of resolved.order) {
    if (shown(id)) out.push({ kind: "path", role: "shape", path: resolved.shapes[id]!.path });
  }
  if (!o.dimensions) return out;
  for (const d of resolved.dimensions) if (shown(d.target)) out.push(...dimensionPrims(d, o));
  for (const l of resolved.radiusLabels) if (shown(l.target)) out.push(radiusLabelPrim(l, o.textSize));
  return out;
}

function dimensionPrims(d: ResolvedDimension, { textSize: size, tick }: PrimitiveOptions): Primitive[] {
  const a = d.line.from, b = d.line.to;
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  // One run anchor -> line -> anchor, so the corners join; extension lines
  // vanish when the offset is zero.
  const path: Path = [];
  if (!pointsNear(d.anchors[0], a)) path.push(segment(d.anchors[0], a));
  path.push(segment(a, b));
  if (!pointsNear(b, d.anchors[1])) path.push(segment(b, d.anchors[1]));
  // Ticks run across the line; polar keeps them defined for a zero-length one.
  for (const p of [a, b]) path.push(segment(polar(p, tick, angle - 90), polar(p, tick, angle + 90)));

  const vertical = Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1]);
  const textAngle = vertical ? angle + 180 : angle;   // read bottom-to-top on the left side
  const text: TextPrim = {
    kind: "text", role: "dimension", text: formatMm(d.value), size, anchor: "middle", angle: textAngle,
    // Just clear of the line, on the reader's "up" side.
    at: offset(midpoint(a, b), [0, -0.3 * size], textAngle),
  };
  return [{ kind: "path", role: "dimension", path }, text];
}

function radiusLabelPrim(l: ResolvedRadiusLabel, size: number): TextPrim {
  return {
    kind: "text", role: "dimension", text: `R${formatMm(l.radius)}`, size, anchor: "start", angle: 0,
    at: [l.at[0], l.at[1] - 0.4 * size],
  };
}

/** `p` moved by `d` given in a frame rotated by `angle` degrees. */
function offset(p: Point, d: Point, angle: number): Point {
  const t = (angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [p[0] + d[0] * c - d[1] * s, p[1] + d[0] * s + d[1] * c];
}

/** Everything the primitives cover, text boxes included; null for nothing. */
export function primitivesBounds(prims: Primitive[]): Bounds | null {
  const parts: Bounds[] = [];
  for (const p of prims) {
    if (p.kind === "path") { if (p.path.length) parts.push(pathBounds(p.path)); }
    else if (p.text) parts.push(textBounds(p));
  }
  return parts.length ? unionBounds(parts) : null;
}

/** Helvetica box: ascent 0.75 em above the baseline, descent 0.25 em below. */
function textBounds(t: TextPrim): Bounds {
  const w = textWidth(t.text, t.size);
  const x0 = t.anchor === "start" ? 0 : t.anchor === "middle" ? -w / 2 : -w;
  const up = -0.75 * t.size, down = 0.25 * t.size;
  const corners: Point[] = [[x0, up], [x0 + w, up], [x0 + w, down], [x0, down]];
  return boundsOfPoints(corners.map((c) => offset(t.at, c, t.angle)));
}
