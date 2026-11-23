// Fonts and text layout for text boxes: measuring, wrapping and fitting.
//
// A text box is set in one of the PDF standard families (sans = Helvetica,
// serif = Times, mono = Courier), bold and italic for the whole box, and
// measured with Adobe's metrics for those fonts (fontMetrics.ts). Every
// client, the canvas and every output measure with the same numbers, so they
// wrap the same and the box's font size comes out the same everywhere.
//
// The size is not stored: it is the largest at which the text, wrapped to the
// box's width, fits its height. Line i's baseline sits
// (BASELINE + i × LINE_SPACING) × size below the top of the box.
//
// Pure and deterministic: plain arithmetic only, so every client agrees.

import { EXTRA_CHARS, EXTRA_CODES, FONT_METRICS, type FontMetrics, type StandardFont } from "./fontMetrics";
import type { FontFamily } from "./types";

export type { FontMetrics, StandardFont };

export interface FontStyle {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
}

export const DEFAULT_FONT: FontStyle = { family: "sans", bold: false, italic: false };

/** Baseline to baseline, in multiples of the font size. */
export const LINE_SPACING = 1.2;
/** The first baseline below the top of the box, in multiples of the font size. */
export const BASELINE = 0.9;

const FAMILY_FONTS: Record<FontFamily, [regular: StandardFont, bold: StandardFont, italic: StandardFont, boldItalic: StandardFont]> = {
  sans: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  serif: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  mono: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};

/** The twelve standard text fonts, Helvetica first. */
export const STANDARD_FONTS: readonly StandardFont[] = Object.values(FAMILY_FONTS).flat();

/** The PDF standard font a style is set in. */
export function standardFont(font: FontStyle): StandardFont {
  return FAMILY_FONTS[font.family][(font.bold ? 1 : 0) + (font.italic ? 2 : 0)]!;
}

/** Adobe's metrics for a style, 1/1000 em. */
export function fontMetrics(font: FontStyle): FontMetrics {
  return FONT_METRICS[standardFont(font)];
}

/** Character -> index into a FontMetrics' widths, and its WinAnsiEncoding byte. */
const WIDTH_INDEX = new Map<string, number>();
const WIN_ANSI = new Map<string, number>();
for (let c = 32; c <= 126; c++) { WIDTH_INDEX.set(String.fromCharCode(c), c - 32); WIN_ANSI.set(String.fromCharCode(c), c); }
[...EXTRA_CHARS].forEach((ch, i) => { WIDTH_INDEX.set(ch, 95 + i); WIN_ANSI.set(ch, EXTRA_CODES[i]!); });

/**
 * The WinAnsiEncoding byte a PDF sets `ch` with in the standard fonts:
 * defined for exactly the characters the metrics have widths for.
 */
export function winAnsiCode(ch: string): number | undefined {
  return WIN_ANSI.get(ch);
}

/** The advance of `text` in 1/1000 em: a whole number, so sums are exact. */
function advanceEm(text: string, m: FontMetrics): number {
  let em = 0;
  for (const ch of text) {
    const i = WIDTH_INDEX.get(ch);
    em += i === undefined ? m.missing : m.widths[i]!;
  }
  return em;
}

/** How far `text` set in `font` at `size` runs along its baseline, same units as `size`. No kerning. */
export function textAdvance(text: string, font: FontStyle, size: number): number {
  return (advanceEm(text, fontMetrics(font)) / 1000) * size;
}

// ---- Wrapping ----

/**
 * Slack for rounding when comparing lengths: a line exactly the width of
 * the box fits, and so does a box exactly as tall as its lines.
 */
const SLACK = 1e-12;

/** Text measured once for wrapping at any size: paragraphs of words, each word's advance in em/1000. */
interface Measured {
  paragraphs: Array<{ words: string[]; ems: number[] }>;
  space: number;
}

function measure(text: string, font: FontStyle): Measured {
  const m = fontMetrics(font);
  const paragraphs = text.split(/\r\n|\r|\n/).map((p) => {
    const words = p.split(/[ \t]+/).filter(Boolean);
    return { words, ems: words.map((w) => advanceEm(w, m)) };
  });
  return { paragraphs, space: advanceEm(" ", m) };
}

/**
 * Greedy breaks: for each line, its paragraph and the index of its first
 * and one past its last word. An empty paragraph is one empty line.
 */
function breakLines(t: Measured, size: number, width: number): Array<[para: number, from: number, to: number]> {
  const limit = width * (1 + SLACK);
  const fits = (em: number) => (em / 1000) * size <= limit;
  const out: Array<[number, number, number]> = [];
  t.paragraphs.forEach(({ ems }, p) => {
    if (ems.length === 0) { out.push([p, 0, 0]); return; }
    let from = 0, em = ems[0]!;
    for (let i = 1; i < ems.length; i++) {
      const next = em + t.space + ems[i]!;
      if (fits(next)) { em = next; continue; }
      out.push([p, from, i]);
      from = i;
      em = ems[i]!;
    }
    out.push([p, from, ems.length]);
  });
  return out;
}

/**
 * `text` in lines no wider than `width` at `size`: split at newlines first
 * (an empty paragraph is an empty line), then greedily at spaces (runs of
 * spaces and tabs count as one). A word wider than the width gets a line of
 * its own. "" gives [""].
 */
export function wrapText(text: string, font: FontStyle, size: number, width: number): string[] {
  const t = measure(text, font);
  return breakLines(t, size, width).map(([p, from, to]) => t.paragraphs[p]!.words.slice(from, to).join(" "));
}

/** How tall `lines` lines of text at `size` are: lines × LINE_SPACING × size. */
export function textHeight(lines: number, size: number): number {
  return lines * LINE_SPACING * size;
}

// ---- Fitting ----

/** Halvings of the search interval: enough to reach a double's precision. */
const FIT_STEPS = 64;

/**
 * The largest font size at which `text`, wrapped to `width`, fits `height`:
 * lines(size) × LINE_SPACING × size ≤ height. Lines never fall as the size
 * grows, so that is true up to the answer and false beyond it, and a fixed
 * number of halvings of (0, height / LINE_SPACING] finds it the same on
 * every client. When the box is exactly full (the height is what limits
 * it), the answer is exactly height / (LINE_SPACING × lines), so lines land
 * where they should. 0 for a box with no width or height; never NaN.
 */
export function fitTextSize(text: string, font: FontStyle, width: number, height: number): number {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return 0;
  const t = measure(text, font);
  const lines = (size: number) => breakLines(t, size, width).length;
  const limit = height * (1 + SLACK);
  const fits = (size: number) => textHeight(lines(size), size) <= limit;

  const top = height / LINE_SPACING;
  if (fits(top)) return top;
  let lo = 0, hi = top;
  for (let i = 0; i < FIT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  // `lo` is within rounding of the answer; if the box is full at its line count, the answer is exactly this.
  const full = height / (LINE_SPACING * lines(lo));
  return fits(full) ? full : lo;
}
