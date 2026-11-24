// Resolved drawing -> primitives, in model mm.
//
// Dimensions and labels follow the canvas's DimensionView and
// RadiusLabelView so output looks like the screen. Text size and tick
// length are in the same units as the model, so callers printing at a
// scale pass sizes divided by it and get fixed sizes on paper.

import {
  type Bounds, type EntityId, type Path, type Point, type ResolvedDimension, type ResolvedRadiusLabel, type Resolved, type ResolvedText,
  DEFAULT_LINE_STYLE, boundsOfPoints, fontMetrics, isVisible, midpoint, pathBounds, pointsNear, polar, segment, textAdvance, unionBounds,
} from "../model";
import { dimensionText } from "../view/dimensionText";
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

/**
 * The visible shapes, in their layer's colour if it has one, and with
 * `dimensions` their dimensions and labels; hidden layers are left out. A
 * text box is its lines of text, not its outline.
 */
export function drawingPrimitives(resolved: Resolved, o: PrimitiveOptions): Primitive[] {
  const hidden = o.hidden ?? NO_LAYERS;
  const shown = (id: EntityId) => isVisible(resolved, id, hidden);
  // Map, not object: a layer ID like "__proto__" stays data.
  const colours = new Map(resolved.layers.map((l) => [l.id, l.colour]));
  const out: Primitive[] = [];
  for (const id of resolved.order) {
    if (!shown(id)) continue;
    const shape = resolved.shapes[id]!;
    const colour = colours.get(shape.layer);
    const ink = colour ? { colour } : {};
    if (shape.kind === "text") out.push(...textBoxPrims(shape, ink));
    else {
      const plain = shape.style.width === DEFAULT_LINE_STYLE.width && shape.style.dash === DEFAULT_LINE_STYLE.dash;
      out.push({ kind: "path", role: "shape", path: shape.path, ...ink, ...(plain ? {} : { line: shape.style }) });
    }
  }
  if (!o.dimensions) return out;
  for (const d of resolved.dimensions) if (shown(d.target)) out.push(...dimensionPrims(d, o));
  for (const l of resolved.radiusLabels) if (shown(l.target)) out.push(radiusLabelPrim(l, o.textSize));
  return out;
}

/** One text primitive per line with something on it, set as the box says. */
function textBoxPrims(s: ResolvedText, ink: { colour?: string }): TextPrim[] {
  if (!(s.size > 0)) return [];
  return s.lines.filter((l) => l.text).map((l) => ({
    kind: "text", role: "shape", at: l.at, text: l.text, angle: s.rotation, size: s.size, anchor: "start",
    font: s.font, ...(s.mirror ? { mirror: true } : {}), width: l.width, ...ink,
  }));
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

  const placed = dimensionText(d);
  const text: TextPrim = {
    kind: "text", role: "dimension", text: formatMm(d.value), size, anchor: "middle", angle: placed.angle,
    // Just clear of the line, away from the shape: the baseline above it, or
    // a line's height below so the digits hang the same distance clear.
    at: offset(midpoint(a, b), [0, placed.above ? -0.3 * size : size], placed.angle),
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

/**
 * The box a line of text covers: along the baseline its advance (`width`,
 * or measured), back from `at` when mirrored; across it, a text box's font's
 * ascender and descender, or for a label (Helvetica) 0.75 em up and 0.25 em down.
 */
function textBounds(t: TextPrim): Bounds {
  const w = t.width ?? (t.font ? textAdvance(t.text, t.font, t.size) : textWidth(t.text, t.size));
  const start = t.anchor === "start" ? 0 : t.anchor === "middle" ? -w / 2 : -w;
  const [x0, x1] = t.mirror ? [-start - w, -start] : [start, start + w];
  const m = t.font && fontMetrics(t.font);
  const up = (m ? -m.ascender / 1000 : -0.75) * t.size, down = (m ? -m.descender / 1000 : 0.25) * t.size;
  const corners: Point[] = [[x0, up], [x1, up], [x1, down], [x0, down]];
  return boundsOfPoints(corners.map((c) => offset(t.at, c, t.angle)));
}
