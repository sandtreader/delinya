// PDF export: a minimal hand-written PDF 1.4, for printing at exact scale.
//
// One Page per PageDrawing, sized in points from the paper mm. Each content
// stream starts by mapping paper mm with y down onto PDF's points with y up,
// so primitives are written in the same coordinates as the page model. Text
// uses the standard Helvetica font (not embedded) in WinAnsiEncoding; the
// whole file is ASCII and uncompressed, and the output is deterministic.

import type { Arc, Path, Point } from "../model";
import { STYLE } from "./style";
import { textWidth, toWinAnsi } from "./text";
import type { PageDrawing, PathPrim, Primitive, Role, TextPrim } from "./types";

/** Points per paper millimetre. */
const PT = 72 / 25.4;
const DEG = Math.PI / 180;
/** Used when there are no pages, so the file is still valid. */
const A4 = { width: 210, height: 297 };

export function exportPdf(pages: PageDrawing[], meta: { title: string; author: string }): Uint8Array<ArrayBuffer> {
  const list: PageDrawing[] = pages.length > 0 ? pages : [blankPage(A4.width, A4.height)];

  // Fixed objects first, then a Page and its content stream per page.
  const CATALOG = 1, PAGES = 2, FONT = 3, INFO = 4;
  const pageId = (i: number) => 5 + 2 * i;
  const contentId = (i: number) => 6 + 2 * i;

  const bodies: string[] = [];
  bodies[CATALOG] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;
  bodies[PAGES] = `<< /Type /Pages /Kids [${list.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${list.length} >>`;
  bodies[FONT] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  const info = [`/Title ${pdfText(meta.title)}`];
  if (meta.author) info.push(`/Author ${pdfText(meta.author)}`);
  info.push(`/Producer ${pdfText("Delinya")}`);
  bodies[INFO] = `<< ${info.join(" ")} >>`;

  list.forEach((page, i) => {
    const w = f(page.width * PT);
    const h = f(page.height * PT);
    bodies[pageId(i)] =
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${w} ${h}]` +
      ` /Resources << /Font << /F1 ${FONT} 0 R >> /ProcSet [/PDF /Text] >>` +
      ` /Contents ${contentId(i)} 0 R >>`;
    const stream = pageContent(page, h);
    bodies[contentId(i)] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // Everything is ASCII, so string offsets are byte offsets.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < bodies.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${bodies[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${bodies.length}\n0000000000 65535 f\r\n`;
  for (let n = 1; n < bodies.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n\r\n`;
  out += `trailer\n<< /Size ${bodies.length} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}

function blankPage(width: number, height: number): PageDrawing {
  return { width, height, clip: { x: 0, y: 0, width, height }, content: [], furniture: [] };
}

// --- Content streams ---------------------------------------------------

/** Graphics state the writer has set, so it only emits changes. */
interface GState {
  width: number | null;
  dashed: boolean;
}

/** `height` is the page height in points, exactly as in the MediaBox. */
function pageContent(page: PageDrawing, height: string): string {
  const ops: string[] = [
    // Paper mm, origin top-left, y down.
    `${f(PT, 8)} 0 0 ${f(-PT, 8)} 0 ${height} cm`,
    "1 J",
    "1 j",
    "0 G",
    "0 g",
  ];
  let state: GState = { width: null, dashed: false };

  const c = page.clip;
  const saved = { ...state };
  ops.push("q", `${f(c.x)} ${f(c.y)} ${f(c.width)} ${f(c.height)} re`, "W", "n");
  for (const p of page.content) primitive(p, ops, state);
  ops.push("Q");
  state = saved;
  for (const p of page.furniture) primitive(p, ops, state);

  return ops.join("\n") + "\n";
}

function primitive(p: Primitive, ops: string[], state: GState): void {
  if (p.kind === "path") pathOps(p, ops, state);
  else textOps(p, ops);
}

function pathOps(p: PathPrim, ops: string[], state: GState): void {
  const draw = pathDrawOps(p.path);
  if (draw.length === 0) return;
  const width = STYLE.stroke[p.role];
  if (state.width !== width) {
    ops.push(`${f(width)} w`);
    state.width = width;
  }
  const dashed = isDashed(p.role);
  if (state.dashed !== dashed) {
    ops.push(dashed ? `[${STYLE.guideDash.map((d) => f(d)).join(" ")}] 0 d` : "[] 0 d");
    state.dashed = dashed;
  }
  ops.push(...draw, "S");
}

function isDashed(role: Role): boolean {
  return role === "guide";
}

/** Path construction operators; moves only where a run doesn't continue. */
function pathDrawOps(path: Path): string[] {
  const ops: string[] = [];
  let cursor: Point | null = null;
  const moveTo = (p: Point) => {
    if (!cursor || Math.abs(cursor[0] - p[0]) > 1e-6 || Math.abs(cursor[1] - p[1]) > 1e-6) {
      ops.push(`${pt(p)} m`);
    }
  };
  for (const e of path) {
    if (e.kind === "segment") {
      if (!finite(...e.from, ...e.to)) { cursor = null; continue; }
      moveTo(e.from);
      ops.push(`${pt(e.to)} l`);
      cursor = e.to;
    } else {
      const span = arcSpan(e);
      if (!finite(...e.centre, e.radius, e.start, span) || span === 0) { cursor = null; continue; }
      const pieces = Math.max(1, Math.ceil(span / 90 - 1e-9));
      const step = span / pieces;
      moveTo(at(e, e.start));
      for (let i = 0; i < pieces; i++) {
        const [c1, c2, end] = bezier(e, e.start + i * step, e.start + (i + 1) * step);
        ops.push(`${pt(c1)} ${pt(c2)} ${pt(end)} c`);
        cursor = end;
      }
    }
  }
  return ops;
}

/** Degrees swept, 0..360; an arc always runs with increasing angle. */
function arcSpan(a: Arc): number {
  let span = a.end - a.start;
  if (span < 0) span += 360 * Math.ceil(-span / 360);
  return Math.min(span, 360);
}

function at(a: Arc, deg: number): Point {
  return [a.centre[0] + a.radius * Math.cos(deg * DEG), a.centre[1] + a.radius * Math.sin(deg * DEG)];
}

/** Cubic Bézier control points and end for an arc piece of at most 90°. */
function bezier(a: Arc, from: number, to: number): [Point, Point, Point] {
  const k = (4 / 3) * Math.tan(((to - from) * DEG) / 4) * a.radius;
  const p0 = at(a, from);
  const p3 = at(a, to);
  const s0 = Math.sin(from * DEG), c0 = Math.cos(from * DEG);
  const s1 = Math.sin(to * DEG), c1 = Math.cos(to * DEG);
  // Tangents point the way the angle increases: (-sin, cos).
  return [
    [p0[0] - k * s0, p0[1] + k * c0],
    [p3[0] + k * s1, p3[1] - k * c1],
    p3,
  ];
}

function textOps(t: TextPrim, ops: string[]): void {
  if (!t.text || !finite(...t.at, t.angle, t.size) || t.size <= 0) return;
  const cos = Math.cos(t.angle * DEG);
  const sin = Math.sin(t.angle * DEG);
  const w = textWidth(t.text, t.size);
  const back = t.anchor === "middle" ? w / 2 : t.anchor === "end" ? w : 0;
  const x = t.at[0] - back * cos;
  const y = t.at[1] - back * sin;
  // Baseline along the angle; glyph "up" a quarter turn anticlockwise from
  // it on the y-down page, which un-mirrors the flipped page transform.
  const m = [cos, sin, sin, -cos].map((v) => f(v, 6)).join(" ");
  ops.push("BT", `/F1 ${f(t.size)} Tf`, `${m} ${f(x)} ${f(y)} Tm`, `${pdfString(toWinAnsi(t.text))} Tj`, "ET");
}

// --- Formatting -------------------------------------------------------

/** A PDF number: fixed decimals, trailing zeros dropped, never exponent or -0. */
function f(n: number, places = 3): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(places).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

function pt(p: Point): string {
  return `${f(p[0])} ${f(p[1])}`;
}

function finite(...ns: number[]): boolean {
  return ns.every(Number.isFinite);
}

/** Literal string from bytes: ( ) \ escaped, anything outside printable ASCII as octal. */
function pdfString(bytes: number[]): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

/**
 * A text string for the Info dictionary. PDFDocEncoding matches Latin-1 for
 * printable ASCII and U+00A1..U+00FF (bar the soft hyphen), so those go as
 * a literal; anything else as UTF-16BE hex with a byte-order mark.
 */
function pdfText(text: string): string {
  const latin = [...text].every((ch) => {
    const c = ch.codePointAt(0)!;
    return (c >= 32 && c <= 126) || (c >= 0xa1 && c <= 0xff && c !== 0xad);
  });
  if (latin) return pdfString([...text].map((ch) => ch.codePointAt(0)!));
  let hex = "<FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return hex + ">";
}
