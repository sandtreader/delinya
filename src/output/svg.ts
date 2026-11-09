// SVG output: a true-size export of the drawing, and composed pages for the
// print preview and printout (inlined into one HTML document).

import type { EntityId, Resolved } from "../model";
import { pathToSvg } from "../view/svgPath";
import { drawingPrimitives, primitivesBounds } from "./primitives";
import { STYLE, SVG_PADDING } from "./style";
import type { PageDrawing, Primitive, Role } from "./types";

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
    + layer(prims)
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
    + `<g clip-path="url(#${id})">\n${layer(page.content)}</g>\n`
    + layer(page.furniture)
    + `</svg>\n`;
}

/**
 * Paths in one stroked group, text in one filled group, both black; a role
 * inked in another colour says so on the element itself.
 */
function layer(prims: Primitive[]): string {
  const paths: string[] = [], texts: string[] = [];
  for (const p of prims) {
    if (p.kind === "path") {
      if (!p.path.length) continue;
      const dash = p.role === "guide" ? ` stroke-dasharray="${STYLE.guideDash.join(" ")}"` : "";
      paths.push(`<path d="${pathToSvg(p.path)}" stroke-width="${STYLE.stroke[p.role]}"${dash}${ink("stroke", p.role)}/>`);
    } else if (p.text) {
      const [x, y] = [num(p.at[0]), num(p.at[1])];
      const rotate = num(p.angle) !== "0" ? ` transform="rotate(${num(p.angle)} ${x} ${y})"` : "";
      texts.push(`<text x="${x}" y="${y}" font-size="${num(p.size)}" text-anchor="${p.anchor}"${rotate}${ink("fill", p.role)}>${escapeXml(p.text)}</text>`);
    }
  }
  let out = "";
  if (paths.length) out += `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">\n${paths.join("\n")}\n</g>\n`;
  if (texts.length) out += `<g font-family="${FONT}" fill="#000" stroke="none">\n${texts.join("\n")}\n</g>\n`;
  return out;
}

/** The role's colour as a stroke or fill attribute; nothing for black, which the group sets. */
function ink(attr: "stroke" | "fill", role: Role): string {
  const colour = STYLE.colour[role];
  return /^#(000|000000)$/i.test(colour) ? "" : ` ${attr}="${escapeXml(colour)}"`;
}

/** At most 4 decimals, no trailing zeros, never "-0". */
function num(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return (r === 0 ? 0 : r).toString();
}

/** Text content and attribute safe; drops control characters XML forbids. */
function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
