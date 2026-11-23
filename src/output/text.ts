// Text metrics and encoding for output.
//
// PDF uses the standard Helvetica font (no embedding) for labels, and SVG
// asks for Helvetica/Arial, which share its widths. Layout (centring,
// wrapping notes in the title block, bounds) measures with Adobe's
// Helvetica metrics (model/fontMetrics.ts, which text boxes use too) so
// every format lines up.

import { DEFAULT_FONT, textAdvance, winAnsiCode } from "../model";

/** Width of `text` set in Helvetica at `size` (same units as size). */
export function textWidth(text: string, size: number): number {
  return textAdvance(text, DEFAULT_FONT, size);
}

/**
 * WinAnsiEncoding bytes for `text`, as the PDF writer needs for the
 * standard fonts: the same characters the metrics measure (winAnsiCode).
 * Characters the encoding lacks become "?".
 */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) out.push(winAnsiCode(ch) ?? 0x3f);
  return out;
}

/**
 * Greedy word wrap to `width` at `size`. Words longer than a line are
 * broken. Explicit newlines start new lines; blank lines are kept.
 */
export function wrapText(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      // A word wider than the line: break it by characters.
      let rest = word;
      while (textWidth(rest, size) > width) {
        let n = 1;
        while (n < rest.length && textWidth(rest.slice(0, n + 1), size) <= width) n++;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}
