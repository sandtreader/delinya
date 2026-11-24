// SVG output: a true-size export of the drawing, and composed pages for the
// print preview and printout (inlined into one HTML document).
//
// A fill is a path under its shape's outline, at FILL_OPACITY: the colour,
// then the pattern as a <pattern> tile in user space (paper mm on a page;
// model mm in the true-size export, which is paper mm at 1:1), anchored at
// the origin like hatchMarks' lattice. The tile is drawn opaque and the
// whole pattern faded once, so crossing marks don't darken.

import { type EntityId, type HatchPattern, type Resolved, FILL_OPACITY } from "../model";
import { pathToSvg } from "../view/svgPath";
import { svgNumber as num, textElementAttrs } from "../view/textSvg";
import { HATCH_LINE_WIDTH, hatchTile } from "./hatch";
import { drawingPrimitives, primitivesBounds } from "./primitives";
import { STYLE, SVG_PADDING, strokeOf } from "./style";
import type { PageDrawing, Primitive } from "./types";

const FONT = "Helvetica, Arial, sans-serif";

/**
 * The drawing at true size: model mm in the viewBox, mm on the root. Shapes
 * on `hidden` layers are left out. Null for nothing.
 */
export function exportSvg(
  resolved: Resolved, { dimensions, hidden }: { dimensions: boolean; hidden?: ReadonlySet<EntityId> },
): string | null {
  const prims = drawingPrimitives(resolved, { dimensions, textSize: STYLE.textSize, tick: STYLE.tick, hidden });
  const b = primitivesBounds(prims);
  if (!b) return null;
  const x = num(b.minX - SVG_PADDING), y = num(b.minY - SVG_PADDING);
  const w = num(b.maxX - b.minX + 2 * SVG_PADDING), h = num(b.maxY - b.minY + 2 * SVG_PADDING);
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${x} ${y} ${w} ${h}">\n`
    + layer(prims, "delinya")
    + `</svg>\n`;
}

let clipSeq = 0;

/** One composed page, paper mm. Content is clipped to the drawing area; furniture is not. */
export function pageToSvg(page: PageDrawing): string {
  // Pages share one HTML document when printed, so each needs its own id.
  const id = `delinya-clip-${++clipSeq}`;
  const w = num(page.width), h = num(page.height), c = page.clip;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n`
    + `<rect width="${w}" height="${h}" fill="#fff"/>\n`
    + `<defs><clipPath id="${id}"><rect x="${num(c.x)}" y="${num(c.y)}" width="${num(c.width)}" height="${num(c.height)}"/></clipPath></defs>\n`
    + `<g clip-path="url(#${id})">\n${layer(page.content, id)}</g>\n`
    + layer(page.furniture, id)
    + `</svg>\n`;
}

/**
 * Paths in one stroked group, text in one filled group, both black; a role
 * or layer inked in another colour says so on the element itself. Labels
 * take the group's Helvetica; a text box's line names its own font, pins its
 * width and is placed by transform (see textElementAttrs). Fills go among
 * the paths, in order, each pattern used defined once ahead of them, its id
 * starting `idPrefix` (unique to the page when pages share a document).
 */
function layer(prims: Primitive[], idPrefix: string): string {
  const paths: string[] = [], texts: string[] = [];
  const patterns = new Map<string, string>();
  for (const p of prims) {
    if (p.kind === "fill") {
      if (!p.path.length || !(p.fill || p.hatch)) continue;
      const d = pathToSvg(p.path);
      if (p.fill) paths.push(`<path d="${d}" fill="${escapeXml(p.fill)}" fill-opacity="${FILL_OPACITY}" stroke="none"/>`);
      if (p.hatch) {
        const colour = p.colour ?? STYLE.colour.shape;
        const id = `${idPrefix}-hatch-${p.hatch}-${colour.replace(/[^0-9a-z]/gi, "").toLowerCase()}`;
        if (!patterns.has(id)) patterns.set(id, hatchPattern(id, p.hatch, colour));
        paths.push(`<path d="${d}" fill="url(#${id})" fill-opacity="${FILL_OPACITY}" stroke="none"/>`);
      }
    } else if (p.kind === "path") {
      if (!p.path.length) continue;
      const stroke = strokeOf(p);
      const dash = stroke.dash.length ? ` stroke-dasharray="${stroke.dash.map((d) => num(d)).join(" ")}"` : "";
      paths.push(`<path d="${pathToSvg(p.path)}" stroke-width="${num(stroke.width)}"${dash}${ink("stroke", p.colour ?? STYLE.colour[p.role])}/>`);
    } else if (p.text && p.font) {
      const attrs = Object.entries(textElementAttrs({ ...p, font: p.font })).map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join("");
      const anchor = p.anchor !== "start" ? ` text-anchor="${p.anchor}"` : "";
      texts.push(`<text${attrs}${anchor}${ink("fill", p.colour ?? STYLE.colour[p.role])}>${escapeXml(p.text)}</text>`);
    } else if (p.text) {
      const [x, y] = [num(p.at[0]), num(p.at[1])];
      const rotate = num(p.angle) !== "0" ? ` transform="rotate(${num(p.angle)} ${x} ${y})"` : "";
      texts.push(`<text x="${x}" y="${y}" font-size="${num(p.size)}" text-anchor="${p.anchor}"${rotate}${ink("fill", p.colour ?? STYLE.colour[p.role])}>${escapeXml(p.text)}</text>`);
    }
  }
  let out = patterns.size ? `<defs>\n${[...patterns.values()].join("\n")}\n</defs>\n` : "";
  if (paths.length) out += `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">\n${paths.join("\n")}\n</g>\n`;
  if (texts.length) out += `<g font-family="${FONT}" fill="#000" stroke="none">\n${texts.join("\n")}\n</g>\n`;
  return out;
}

/** A fill pattern's tile (see hatchTile), opaque in `colour`, in the user space of the shape it fills. */
function hatchPattern(id: string, pattern: HatchPattern, colour: string): string {
  const { size, d, filled } = hatchTile(pattern);
  const paint = filled ? `fill="${escapeXml(colour)}"` : `fill="none" stroke="${escapeXml(colour)}" stroke-width="${num(HATCH_LINE_WIDTH)}"`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(size)}" height="${num(size)}"><path d="${d}" ${paint}/></pattern>`;
}

/** A colour as a stroke or fill attribute; nothing for black, which the group sets. */
function ink(attr: "stroke" | "fill", colour: string): string {
  return /^#(000|000000)$/i.test(colour) ? "" : ` ${attr}="${escapeXml(colour)}"`;
}

/** Text content and attribute safe; drops control characters XML forbids. */
function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
