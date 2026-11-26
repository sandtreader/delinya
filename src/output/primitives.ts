// Resolved drawing -> primitives, in model mm.
//
// Dimensions and labels follow the canvas's DimensionView and
// RadiusLabelView so output looks like the screen. Text size and tick
// length are in the same units as the model, so callers printing at a
// scale pass sizes divided by it and get fixed sizes on paper.

import {
  type Bounds, type EntityId, type Path, type Point, type ResolvedDimension, type ResolvedRadiusLabel, type Resolved, type ResolvedText,
  DEFAULT_LINE_STYLE, boundsOfPoints, fontMetrics, isVisible, layerRuns, midpoint, namePlace, pathBounds, pointsNear, polar, segment, shapeName,
  textAdvance, unionBounds,
} from "../model";
import { dimensionText, radiusLabelPlace, radiusLabelText } from "../view/dimensionText";
import { formatMm } from "../view/format";
import { textWidth } from "./text";
import type { FillPrim, Primitive, TextPrim } from "./types";

export interface PrimitiveOptions {
  /** Include dimensions and radius labels. */
  dimensions: boolean;
  /** Include the names shapes show; true unless false. */
  names?: boolean;
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
 * text box is its lines of text, not its outline. Layer by layer, back to
 * front: a filled layer's fills for its rectangles, circles and closed
 * paths come first, under all its own lines but over the layers behind.
 * Unless `names` is false, shapes that show their names have them over
 * everything drawn, at the labels' size in their layer's ink.
 */
export function drawingPrimitives(resolved: Resolved, o: PrimitiveOptions): Primitive[] {
  const hidden = o.hidden ?? NO_LAYERS;
  const shown = (id: EntityId) => isVisible(resolved, id, hidden);
  const out: Primitive[] = [];
  const names: TextPrim[] = [];
  for (const { layer, shapes, filled } of layerRuns(resolved, hidden)) {
    const ink = layer.colour ? { colour: layer.colour } : {};
    for (const shape of shapes) {
      const at = o.names === false ? null : namePlace(shape, o.textSize);
      if (at) names.push({ kind: "text", role: "shape", text: shapeName(shape), size: o.textSize, anchor: "middle", angle: 0, at, ...ink });
    }
    if (filled.length) {
      // A pattern is in the layer's ink; keys only for what the layer has.
      const fill: Omit<FillPrim, "path"> = { kind: "fill", ...(layer.fill ? { fill: layer.fill } : {}), ...(layer.hatch ? { hatch: layer.hatch, ...ink } : {}) };
      for (const shape of filled) out.push({ ...fill, path: shape.path });
    }
    for (const shape of shapes) {
      if (shape.kind === "text") out.push(...textBoxPrims(shape, ink));
      else {
        const plain = shape.style.width === DEFAULT_LINE_STYLE.width && shape.style.dash === DEFAULT_LINE_STYLE.dash;
        out.push({ kind: "path", role: "shape", path: shape.path, ...ink, ...(plain ? {} : { line: shape.style }) });
      }
    }
  }
  out.push(...names);
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
  const { at, angle, anchor } = radiusLabelPlace(l, size);
  return { kind: "text", role: "dimension", text: radiusLabelText(l), size, anchor, angle, at };
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
    if (p.kind === "path" || p.kind === "fill") { if (p.path.length) parts.push(pathBounds(p.path)); }
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
