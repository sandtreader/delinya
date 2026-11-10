// DXF export: shapes only, for CNC and laser cutting.
//
// AutoCAD R12 (AC1009) ASCII, which every CAM tool reads. Units are
// millimetres. No dimensions or text: a cutter would cut them.
//
// DXF is y-up, so y is negated on the way out. Our arcs run with increasing
// angle, clockwise on a y-down screen; the flip keeps them clockwise as
// seen, so an ARC's angles swap and negate, and a polyline bulge is
// negative.
//
// Each shape's path becomes CIRCLE, LINE or ARC when it is one element, or a
// POLYLINE with bulges for a connected run of several. Disconnected runs
// become separate entities. R12 has no splines CAM tools all read, so a
// cubic Bézier becomes polyline vertices along it, within FLATTEN of the
// curve, joined into its run (closed when the run closes).
//
// Each visible drawing layer becomes a DXF layer, in layer order, and each
// entity goes on its shape's layer (colour BYLAYER). Layers the viewer has
// hidden, and their shapes, are left out. See dxfLayerNames for how layers
// are named. A layer's colour is its palette entry's ACI (7, black on white,
// for the default; the nearest entry for a colour outside the palette).

import {
  type Arc, type Path, type PathElement, type Point, type ResolvedLayer,
  elementEnd, elementLength, elementStart, flattenCubic, isVisible, layerColourEntry, pointsNear, unionBounds,
} from "../model";
import type { EntityId, Resolved } from "../model";

/** Endpoints closer than this (mm) count as joined. */
const JOIN = 1e-6;

/** Furthest (mm) a flattened curve's chords stray from it. */
const FLATTEN = 0.01;

/** Longest layer name R12 allows. */
const MAX_NAME = 31;

/** The shapes not on `hidden` layers as DXF text, or null when there are none. */
export function exportDxf(resolved: Resolved, hidden: ReadonlySet<EntityId> = new Set()): string | null {
  const shapes = resolved.order.filter((id) => isVisible(resolved, id, hidden)).map((id) => resolved.shapes[id]!);
  if (shapes.length === 0) return null;
  const layers = resolved.layers.filter((l) => !hidden.has(l.id));
  const names = dxfLayerNames(layers);

  const out = new Writer();
  const b = unionBounds(shapes.map((s) => s.bounds));

  out.section("HEADER");
  out.pair(9, "$ACADVER").pair(1, "AC1009");
  out.pair(9, "$INSUNITS").pair(70, 4);         // millimetres
  out.pair(9, "$MEASUREMENT").pair(70, 1);      // metric
  out.pair(9, "$EXTMIN").point([b.minX, b.maxY]);
  out.pair(9, "$EXTMAX").point([b.maxX, b.minY]);
  out.endsec();

  out.section("TABLES");
  out.pair(0, "TABLE").pair(2, "LTYPE").pair(70, 1);
  out.pair(0, "LTYPE").pair(2, "CONTINUOUS").pair(70, 0).pair(3, "Solid line")
    .pair(72, 65).pair(73, 0).pair(40, 0);
  out.pair(0, "ENDTAB");
  out.pair(0, "TABLE").pair(2, "LAYER").pair(70, layers.length);
  for (const l of layers) {
    out.pair(0, "LAYER").pair(2, names.get(l.id)!).pair(70, 0).pair(62, layerColourEntry(l.colour).aci).pair(6, "CONTINUOUS");
  }
  out.pair(0, "ENDTAB");
  out.endsec();

  out.section("ENTITIES");
  for (const s of shapes) writePath(out, s.path, names.get(s.layer)!);
  out.endsec();

  out.pair(0, "EOF");
  return out.text();
}

/**
 * DXF layer names by layer ID: the layer's name, or "Layer N" if it has
 * none, with anything but letters, digits, "_", "$" and "-" made "_" and cut
 * to 31 characters. A name already taken (ignoring case, as CAD does) gets
 * "_2", "_3"... and stays within 31.
 */
function dxfLayerNames(layers: ResolvedLayer[]): Map<EntityId, string> {
  const out = new Map<EntityId, string>();
  const taken = new Set<string>();
  for (const l of layers) {
    const base = (l.name.trim() || `Layer ${l.number}`).replace(/[^A-Za-z0-9_$-]/g, "_").slice(0, MAX_NAME);
    let name = base;
    for (let n = 2; taken.has(name.toUpperCase()); n++) {
      const suffix = `_${n}`;
      name = base.slice(0, MAX_NAME - suffix.length) + suffix;
    }
    taken.add(name.toUpperCase());
    out.set(l.id, name);
  }
  return out;
}

function writePath(out: Writer, path: Path, layer: string): void {
  for (const run of runs(path)) {
    const e = run[0]!;
    if (run.length > 1 || e.kind === "cubic") writePolyline(out, run, layer);
    else if (e.kind === "segment") writeLine(out, e.from, e.to, layer);
    else if (isFullCircle(e)) writeCircle(out, e, layer);
    else writeArc(out, e, layer);
  }
}

/**
 * Split a path into connected runs, dropping zero-length elements. A full
 * circle is always a run of its own: a polyline bulge cannot express one.
 */
function runs(path: Path): PathElement[][] {
  const out: PathElement[][] = [];
  let run: PathElement[] = [];
  const flush = () => { if (run.length) out.push(run); run = []; };
  for (const e of path) {
    if (!(elementLength(e) > JOIN)) continue;
    if (e.kind === "arc" && isFullCircle(e)) { flush(); out.push([e]); continue; }
    const last = run[run.length - 1];
    if (last && !pointsNear(endOf(last), startOf(e), JOIN)) flush();
    run.push(e);
  }
  flush();
  return out;
}

function writeLine(out: Writer, from: Point, to: Point, layer: string): void {
  out.entity("LINE", layer).point(from).point(to, 1);
}

function writeCircle(out: Writer, a: Arc, layer: string): void {
  out.entity("CIRCLE", layer).point(a.centre).pair(40, a.radius);
}

function writeArc(out: Writer, a: Arc, layer: string): void {
  // Negating y negates angles and reverses direction: the clockwise
  // start→end becomes counter-clockwise from −end to −start.
  const lo = Math.min(a.start, a.end), hi = Math.max(a.start, a.end);
  out.entity("ARC", layer).point(a.centre).pair(40, a.radius).pair(50, angle(-hi)).pair(51, angle(-lo));
}

function writePolyline(out: Writer, run: PathElement[], layer: string): void {
  const closed = pointsNear(endOf(run[run.length - 1]!), startOf(run[0]!), JOIN);
  out.entity("POLYLINE", layer).pair(66, 1).point([0, 0]).pair(70, closed ? 1 : 0);
  for (const e of run) {
    if (e.kind === "cubic") {
      // Every point but the last, which starts the next element (or ends the run).
      const pts = flattenCubic(e, FLATTEN);
      for (let i = 0; i < pts.length - 1; i++) out.entity("VERTEX", layer).point(pts[i]!);
      continue;
    }
    out.entity("VERTEX", layer).point(startOf(e));
    // Bulge is tan(sweep/4), positive counter-clockwise in DXF's frame;
    // our arcs are clockwise as drawn, hence the minus. It is small for
    // shallow arcs, so it keeps more places than a length.
    if (e.kind === "arc") out.pair(42, fmt(-Math.tan(((e.end - e.start) * Math.PI) / 180 / 4), 9));
  }
  if (!closed) out.entity("VERTEX", layer).point(endOf(run[run.length - 1]!));
  out.entity("SEQEND", layer);
}

function isFullCircle(e: PathElement): e is Arc {
  return e.kind === "arc" && Math.abs(e.end - e.start) >= 360 - 1e-9;
}

const startOf = elementStart;
const endOf = elementEnd;

/** Degrees in [0, 360). */
function angle(deg: number): string {
  const a = fmt(((deg % 360) + 360) % 360);
  return a === "360" ? "0" : a;
}

/** Fixed-point with trailing zeros dropped: never "-0" or an exponent. */
function fmt(v: number, places = 6): string {
  if (!Number.isFinite(v)) return "0";
  const s = v.toFixed(places).replace(/\.0*$|(\.\d*?)0+$/, "$1");
  return s === "-0" ? "0" : s;
}

/** Group codes and values on alternate lines. */
class Writer {
  private lines: string[] = [];

  pair(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === "number" ? fmt(value) : value);
    return this;
  }

  /** A model point, y flipped up, at codes 10+k / 20+k / 30+k. */
  point([x, y]: Point, k = 0): this {
    return this.pair(10 + k, x).pair(20 + k, -y).pair(30 + k, 0);
  }

  /** An entity record's start, on DXF layer `layer`. */
  entity(type: string, layer: string): this {
    return this.pair(0, type).pair(8, layer);
  }

  section(name: string): this {
    return this.pair(0, "SECTION").pair(2, name);
  }

  endsec(): this {
    return this.pair(0, "ENDSEC");
  }

  text(): string {
    return this.lines.join("\n") + "\n";
  }
}
