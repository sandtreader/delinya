#!/usr/bin/env node
// Writes src/model/fontMetrics.ts from Adobe's Core 14 AFM files: the
// advance widths and vertical metrics of the twelve PDF standard text fonts.
// Run by hand when the table needs regenerating; the build never runs it and
// nothing reads AFM files at build or run time.
//
//   node scripts/afm-widths.mjs <afm-dir> [out-file]
//
// <afm-dir> holds Helvetica.afm, Times-Roman.afm, Courier.afm and their bold,
// italic and oblique variants. Without out-file the TypeScript goes to stdout.
//
// Characters are matched by glyph name, as WinAnsiEncoding names them: the
// AFMs are in AdobeStandardEncoding, where codes 39 and 96 are other glyphs.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FONTS = [
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
];

// WinAnsiEncoding glyph names for codes 32 to 126.
const ASCII = [
  "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quotesingle",
  "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "colon", "semicolon", "less", "equal", "greater", "question", "at",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "bracketleft", "backslash", "bracketright", "asciicircum", "underscore", "grave",
  ..."abcdefghijklmnopqrstuvwxyz",
  "braceleft", "bar", "braceright", "asciitilde",
];

// Beyond ASCII: every other character WinAnsiEncoding has, in code order, as
// [WinAnsi code, Unicode code point, glyph name]. 0x80 to 0x9F are Windows'
// own (0x81, 0x8D, 0x8F, 0x90 and 0x9D are unused); 0xA0 to 0xFF are
// Latin-1, the code point the code, where the PDF names the no-break space
// and the soft hyphen "space" and "hyphen".
const WIN_ANSI_HIGH = [
  [0x80, 0x20ac, "Euro"], [0x82, 0x201a, "quotesinglbase"], [0x83, 0x0192, "florin"], [0x84, 0x201e, "quotedblbase"],
  [0x85, 0x2026, "ellipsis"], [0x86, 0x2020, "dagger"], [0x87, 0x2021, "daggerdbl"], [0x88, 0x02c6, "circumflex"],
  [0x89, 0x2030, "perthousand"], [0x8a, 0x0160, "Scaron"], [0x8b, 0x2039, "guilsinglleft"], [0x8c, 0x0152, "OE"],
  [0x8e, 0x017d, "Zcaron"], [0x91, 0x2018, "quoteleft"], [0x92, 0x2019, "quoteright"], [0x93, 0x201c, "quotedblleft"],
  [0x94, 0x201d, "quotedblright"], [0x95, 0x2022, "bullet"], [0x96, 0x2013, "endash"], [0x97, 0x2014, "emdash"],
  [0x98, 0x02dc, "tilde"], [0x99, 0x2122, "trademark"], [0x9a, 0x0161, "scaron"], [0x9b, 0x203a, "guilsinglright"],
  [0x9c, 0x0153, "oe"], [0x9e, 0x017e, "zcaron"], [0x9f, 0x0178, "Ydieresis"],
];
const LATIN1 = [
  "space", "exclamdown", "cent", "sterling", "currency", "yen", "brokenbar", "section",
  "dieresis", "copyright", "ordfeminine", "guillemotleft", "logicalnot", "hyphen", "registered", "macron",
  "degree", "plusminus", "twosuperior", "threesuperior", "acute", "mu", "paragraph", "periodcentered",
  "cedilla", "onesuperior", "ordmasculine", "guillemotright", "onequarter", "onehalf", "threequarters", "questiondown",
  "Agrave", "Aacute", "Acircumflex", "Atilde", "Adieresis", "Aring", "AE", "Ccedilla",
  "Egrave", "Eacute", "Ecircumflex", "Edieresis", "Igrave", "Iacute", "Icircumflex", "Idieresis",
  "Eth", "Ntilde", "Ograve", "Oacute", "Ocircumflex", "Otilde", "Odieresis", "multiply",
  "Oslash", "Ugrave", "Uacute", "Ucircumflex", "Udieresis", "Yacute", "Thorn", "germandbls",
  "agrave", "aacute", "acircumflex", "atilde", "adieresis", "aring", "ae", "ccedilla",
  "egrave", "eacute", "ecircumflex", "edieresis", "igrave", "iacute", "icircumflex", "idieresis",
  "eth", "ntilde", "ograve", "oacute", "ocircumflex", "otilde", "odieresis", "divide",
  "oslash", "ugrave", "uacute", "ucircumflex", "udieresis", "yacute", "thorn", "ydieresis",
];
const EXTRA = [...WIN_ANSI_HIGH, ...LATIN1.map((g, i) => [0xa0 + i, 0xa0 + i, g])];

// The characters as a string literal, the invisible ones (no-break space, soft hyphen) escaped.
const extraLiteral = EXTRA.map(([, u]) => (u === 0xa0 || u === 0xad ? `\\u${u.toString(16).padStart(4, "0")}` : String.fromCodePoint(u))).join("");

const [dir, outFile] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node scripts/afm-widths.mjs <afm-dir> [out-file]");
  process.exit(1);
}

function readAfm(name) {
  const text = readFileSync(join(dir, `${name}.afm`), "latin1");
  const widths = new Map();
  const header = {};
  const notices = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^C\s+-?\d+\s*;\s*WX\s+(\d+)\s*;\s*N\s+(\S+)\s*;/.exec(line);
    if (m) { widths.set(m[2], Number(m[1])); continue; }
    const h = /^(CapHeight|Ascender|Descender)\s+(-?\d+)/.exec(line);
    if (h) header[h[1]] = Number(h[2]);
    const n = /^Notice\s+(.*)$/.exec(line);
    if (n) notices.push(n[1].trim());
  }
  const width = (glyph) => {
    const w = widths.get(glyph);
    if (w === undefined) throw new Error(`${name}: no glyph ${glyph}`);
    return w;
  };
  for (const k of ["CapHeight", "Ascender", "Descender"]) if (header[k] === undefined) throw new Error(`${name}: no ${k}`);
  return {
    name,
    widths: [...ASCII, ...EXTRA.map(([, , g]) => g)].map(width),
    missing: width("n"),
    capHeight: header.CapHeight, ascender: header.Ascender, descender: header.Descender,
    notices,
  };
}

const fonts = FONTS.map(readAfm);

// One table per distinct set of widths (Helvetica-Oblique shares Helvetica's,
// every Courier the same), named after the first font that has it.
const tables = new Map();
for (const f of fonts) {
  const key = f.widths.join(",");
  if (!tables.has(key)) tables.set(key, f.name.toUpperCase().replace(/-/g, "_"));
  f.table = tables.get(key);
}

// The copyright notices, each once; "...Reserved.Helvetica is..." split into sentences.
const notices = [...new Set(fonts.flatMap((f) => f.notices))]
  .flatMap((n) => n.replace(/Reserved\.(?=\S)/, "Reserved.\n").split("\n"));
const uniqueNotices = [...new Set(notices.map((n) => n.replace(/\s+/g, " ").trim()))];

const rows = (ws) => {
  const out = [];
  for (let i = 0; i < ws.length; i += 16) out.push(`  ${ws.slice(i, i + 16).join(", ")},`);
  return out.join("\n");
};

let ts = `// Advance widths and vertical metrics of the twelve PDF standard text fonts,
// from Adobe's Core 14 AFM (Adobe Font Metrics) files, in 1/1000 em.
// GENERATED by scripts/afm-widths.mjs: regenerate rather than edit. Nothing
// reads the AFM files at build or run time; this file is all the app has.
//
// The AFM files carry these notices:
${uniqueNotices.map((n) => `//   ${n}`).join("\n")}
// Adobe distributes the Core 14 AFM files to be used, copied and distributed
// for any purpose and without charge, provided the copyright notices are
// retained; they are above.

/** A PDF standard (base 14) text font. */
export type StandardFont =
${FONTS.map((f) => `  | "${f}"`).join("\n")};

/**
 * Every WinAnsiEncoding character after printable ASCII (codes 32 to 126), in
 * code order: Windows' punctuation and letters at 0x80 to 0x9F, then Latin-1
 * (0xA0 to 0xFF). Each has a width of its own, in this order after ASCII's,
 * and EXTRA_CODES gives its byte in a PDF. Anything else takes the font's
 * \`missing\` width.
 */
export const EXTRA_CHARS = "${extraLiteral}";

/** The WinAnsiEncoding byte of each of EXTRA_CHARS, in the same order. */
export const EXTRA_CODES: readonly number[] = [
${rows(EXTRA.map(([c]) => `0x${c.toString(16)}`))}
];

export interface FontMetrics {
  /** Advance widths, 1/1000 em: codes 32 to 126, then EXTRA_CHARS. */
  widths: readonly number[];
  /** The width of any other character: the font's "n". */
  missing: number;
  /** Height of capitals above the baseline. */
  capHeight: number;
  /** Top of the tallest letters above the baseline. */
  ascender: number;
  /** Bottom of descenders, below the baseline (negative). */
  descender: number;
}
`;

for (const [key, name] of tables) ts += `\nconst ${name}: readonly number[] = [\n${rows(key.split(",").map(Number))}\n];\n`;

ts += `\nexport const FONT_METRICS: Readonly<Record<StandardFont, FontMetrics>> = {\n`;
for (const f of fonts) {
  ts += `  "${f.name}": { widths: ${f.table}, missing: ${f.missing}, capHeight: ${f.capHeight}, ascender: ${f.ascender}, descender: ${f.descender} },\n`;
}
ts += `};\n`;

if (outFile) writeFileSync(outFile, ts);
else process.stdout.write(ts);
