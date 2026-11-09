// Text metrics and encoding for output.
//
// PDF uses the standard Helvetica font (no embedding), and SVG asks for
// Helvetica/Arial, which share these widths. Layout (centring, wrapping
// notes in the title block, bounds) measures with the same table so every
// format lines up.

// Helvetica advance widths, 1/1000 em, for character codes 32..126.
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,   //  !"#$%&'()*+,-./
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,   // 0-9 :;<=>?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,  // @A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,   // P-Z [\]^_
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,   // `a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,        // p-z {|}~
];

// WinAnsiEncoding bytes for the non-Latin-1 characters it has, with widths.
const WIN_ANSI_EXTRA: Record<string, [code: number, width: number]> = {
  "€": [0x80, 556], "‚": [0x82, 222], "„": [0x84, 333], "…": [0x85, 1000],
  "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333], "”": [0x94, 333],
  "•": [0x95, 350], "–": [0x96, 556], "—": [0x97, 1000], "™": [0x99, 1000],
};

// Latin-1 characters whose widths matter for labels; others use DEFAULT.
const LATIN1_WIDTHS: Record<string, number> = {
  "°": 400, "±": 584, "×": 584, "÷": 584, "µ": 556, "²": 333, "³": 333,
  "¼": 834, "½": 834, "¾": 834, "·": 278, "£": 556, "©": 737, "®": 737,
};

const DEFAULT_WIDTH = 556;

/** Width of `text` set in Helvetica at `size` (same units as size). */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return (em / 1000) * size;
}

function charWidth(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c >= 32 && c <= 126) return ASCII_WIDTHS[c - 32]!;
  return WIN_ANSI_EXTRA[ch]?.[1] ?? LATIN1_WIDTHS[ch] ?? DEFAULT_WIDTH;
}

/**
 * WinAnsiEncoding bytes for `text`, as the PDF writer needs for the
 * standard fonts. Characters the encoding lacks become "?".
 */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 32 && c <= 126) || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(WIN_ANSI_EXTRA[ch]?.[0] ?? 0x3f);
  }
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
