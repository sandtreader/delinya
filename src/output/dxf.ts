// DXF export: shapes only, for CNC and laser cutting.
//
// AutoCAD R12 (AC1009) ASCII, which every CAM tool reads. Units are
// millimetres. No dimensions or labels: a cutter would cut them. A text box
// is its lines, one TEXT entity each (STANDARD style, height the font's cap
// height at the box's size; a mirrored box's are backward), never its
// outline. Each is placed at its baseline's start; a centred or
// right-aligned line is also justified by DXF's own codes (72 = 1 or 2)
// at its baseline's middle or end, so a reader whose font is wider or
// narrower than ours still lines it up as the box does.
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
//
// A shape's dash pattern is a linetype: DASHED, DOTTED or DASHDOT, defined
// in the LTYPE table (only those used) at the default width's lengths and
// named on the entity (group 6); a solid shape names none, so is the
// layer's CONTINUOUS. R12 has no line widths (group 39 is extrusion
// thickness, not a pen), so widths are left out; CAM tools ignore them anyway.
//
// Layer fills (colour and pattern) are left out entirely: they are
// indicative, not for cutting, so a filled drawing's DXF is the unfilled one's.

import {
  type Arc, type Path, type PathElement, type Point, type ResolvedLayer, type ResolvedText,
  type LineDash,
  DEFAULT_LINE_STYLE, LINE_DASHES, cosSin, dashLengths, elementEnd, elementLength, elementStart, flattenCubic, fontMetrics, isVisible,
  layerColourEntry, pointsNear, unionBounds,
} from "../model";
import type { EntityId, Resolved } from "../model";

/** Endpoints closer than this (mm) count as joined. */
const JOIN = 1e-6;

/** Furthest (mm) a flattened curve's chords stray from it. */
const FLATTEN = 0.01;

/** Each dash pattern's linetype name and description. */
const LINETYPES: Record<Exclude<LineDash, "solid">, { name: string; description: string }> = {
  dashed: { name: "DASHED", description: "Dashed __ __ __" },
  dotted: { name: "DOTTED", description: "Dotted . . . ." },
  dashdot: { name: "DASHDOT", description: "Dash dot __ . __ ." },
};

/** The linetype a shape names, or undefined for solid (by layer). */
function linetypeOf(dash: LineDash): string | undefined {
  return dash === "solid" ? undefined : LINETYPES[dash].name;
}

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
  const used = new Set(shapes.map((s) => (s.kind === "text" ? "solid" : s.style.dash)));
  const dashes = LINE_DASHES.filter((d): d is Exclude<LineDash, "solid"> => d !== "solid" && used.has(d));
  out.pair(0, "TABLE").pair(2, "LTYPE").pair(70, 1 + dashes.length);
  out.pair(0, "LTYPE").pair(2, "CONTINUOUS").pair(70, 0).pair(3, "Solid line")
    .pair(72, 65).pair(73, 0).pair(40, 0);
  for (const d of dashes) {
    // As seen at the default width: dashes positive, gaps negative, dots 0.
    const lengths = dashLengths(d, DEFAULT_LINE_STYLE.width);
    out.pair(0, "LTYPE").pair(2, LINETYPES[d].name).pair(70, 0).pair(3, LINETYPES[d].description)
      .pair(72, 65).pair(73, lengths.length).pair(40, lengths.reduce((a, b) => a + b, 0));
    lengths.forEach((v, i) => out.pair(49, i % 2 === 0 ? v : -v));
  }
  out.pair(0, "ENDTAB");
  out.pair(0, "TABLE").pair(2, "LAYER").pair(70, layers.length);
  for (const l of layers) {
    out.pair(0, "LAYER").pair(2, names.get(l.id)!).pair(70, 0).pair(62, layerColourEntry(l.colour).aci).pair(6, "CONTINUOUS");
  }
  out.pair(0, "ENDTAB");
  out.endsec();

  out.section("ENTITIES");
  for (const s of shapes) {
    if (s.kind === "text") writeText(out, s, names.get(s.layer)!);
    else writePath(out, s.path, { layer: names.get(s.layer)!, linetype: linetypeOf(s.style.dash) });
  }
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

/** Where an entity goes: its DXF layer, and its linetype if not the layer's. */
interface On {
  layer: string;
  linetype?: string;
}

function writePath(out: Writer, path: Path, on: On): void {
  for (const run of runs(path)) {
    const e = run[0]!;
    if (run.length > 1 || e.kind === "cubic") writePolyline(out, run, on);
    else if (e.kind === "segment") writeLine(out, e.from, e.to, on);
    else if (isFullCircle(e)) writeCircle(out, e, on);
    else writeArc(out, e, on);
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

function writeLine(out: Writer, from: Point, to: Point, on: On): void {
  out.shape("LINE", on).point(from).point(to, 1);
}

function writeCircle(out: Writer, a: Arc, on: On): void {
  out.shape("CIRCLE", on).point(a.centre).pair(40, a.radius);
}

function writeArc(out: Writer, a: Arc, on: On): void {
  // Negating y negates angles and reverses direction: the clockwise
  // start→end becomes counter-clockwise from −end to −start.
  const lo = Math.min(a.start, a.end), hi = Math.max(a.start, a.end);
  out.shape("ARC", on).point(a.centre).pair(40, a.radius).pair(50, angle(-hi)).pair(51, angle(-lo));
}

function writePolyline(out: Writer, run: PathElement[], on: On): void {
  const { layer } = on;
  const closed = pointsNear(endOf(run[run.length - 1]!), startOf(run[0]!), JOIN);
  // The linetype on the POLYLINE: its vertices draw with it.
  out.shape("POLYLINE", on).pair(66, 1).point([0, 0]).pair(70, closed ? 1 : 0);
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

/** TEXT horizontal justification (group 72) for each alignment. */
const JUSTIFY = { left: 0, centre: 1, right: 2 } as const;

/**
 * A TEXT per line with something on it, from where its baseline starts.
 * Angles turn the way arcs' do (y is flipped), and a mirrored box's lines
 * are backward (flag 2), so they run back from the right-hand side. A
 * centred or right-aligned line is justified (72) at its alignment point
 * (11): its baseline's middle or end, along the way it reads from its
 * start (back along the box's x when mirrored). A line wider than its box
 * starts at the box's edge rather than being aligned (see alignOffset in
 * resolve.ts) but keeps its box's justification, about where it is drawn.
 */
function writeText(out: Writer, s: ResolvedText, layer: string): void {
  if (!(s.size > 0)) return;
  const height = (fontMetrics(s.font).capHeight / 1000) * s.size;
  const [c, sn] = cosSin(s.rotation);
  const dir = s.mirror ? -1 : 1;
  for (const line of s.lines) {
    if (!line.text) continue;
    out.entity("TEXT", layer).point(line.at).pair(40, height).pair(1, dxfText(line.text)).pair(50, angle(-s.rotation));
    if (s.mirror) out.pair(71, 2);
    if (s.align === "left") continue;
    const along = dir * (s.align === "centre" ? line.width / 2 : line.width);
    out.pair(72, JUSTIFY[s.align]).point([line.at[0] + along * c, line.at[1] + along * sn], 1);
  }
}

/**
 * Text as a TEXT value, all ASCII: "%" as "%%%" (AutoCAD reads "%%" as a
 * control code), ° and ± as its %%d and %%p, anything else beyond ASCII as
 * \U+XXXX, and control characters dropped.
 */
function dxfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === "%") out += "%%%";
    else if (ch === "°") out += "%%d";
    else if (ch === "±") out += "%%p";
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 0xa0) out += `\\U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
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

  /** A shape entity's start: its layer, and its linetype when it names one. */
  shape(type: string, on: On): this {
    this.entity(type, on.layer);
    return on.linetype ? this.pair(6, on.linetype) : this;
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
