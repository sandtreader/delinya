// Resolved drawing + print options -> composed pages in paper mm.
//
// The drawing becomes primitives once, sized so text and ticks come out
// at STYLE sizes on paper, then each tile maps them into its drawing area.
// Every page also gets furniture: a check ruler and title block in the
// footer band, a small "Delinya" under the block, and dashed guides where
// it overlaps its neighbours.

import { type Bounds, type EntityId, type Path, type PathElement, type Point, type Resolved, arc, cubic, isVisible, segment } from "../model";
import { planPages } from "./layout";
import { formatScale } from "./paper";
import { drawingPrimitives, primitivesBounds } from "./primitives";
import { PAGE_MARGIN, RULER_LENGTH, STYLE, TILE_OVERLAP, TITLE_BLOCK } from "./style";
import { textWidth, wrapText } from "./text";
import type { PageDrawing, PagePlan, PageTile, PathPrim, Primitive, PrintOptions, Rect, TextPrim, TitleInfo } from "./types";

export function composePages(resolved: Resolved, options: PrintOptions, info: TitleInfo): { plan: PagePlan; pages: PageDrawing[] } | null {
  const hidden = options.hidden ?? new Set<EntityId>();
  if (!resolved.order.some((id) => isVisible(resolved, id, hidden))) return null;
  const { scale } = options;
  const prims = drawingPrimitives(resolved, { dimensions: options.dimensions, textSize: STYLE.textSize / scale, tick: STYLE.tick / scale, hidden });
  const b = primitivesBounds(prims);
  if (!b) return null;
  const plan = planPages(pad(b, STYLE.padding / scale), options);
  const pages = plan.tiles.map((tile, i): PageDrawing => ({
    width: plan.width,
    height: plan.height,
    clip: { ...plan.area },
    content: prims.map((p) => toPaper(p, tile.window, plan.area, scale)),
    furniture: [
      ...checkRuler(plan),
      ...titleBlock(plan, info, sheetName(plan, tile, i)),
      watermark(plan),
      ...overlapGuides(plan, tile),
    ],
  }));
  return { plan, pages };
}

/** The title block's info with the title trimmed, falling back to the file name. */
export function titleInfo(doc: TitleInfo, fileName: string): TitleInfo {
  return { ...doc, title: doc.title.trim() || fileName };
}

const pad = (b: Bounds, d: number): Bounds => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });

/** Model -> paper: the window's corner lands on the area's, scaled. Uniform, so arcs keep their angles. */
function toPaper(p: Primitive, window: Bounds, area: Rect, scale: number): Primitive {
  const pt = ([x, y]: Point): Point => [area.x + (x - window.minX) * scale, area.y + (y - window.minY) * scale];
  if (p.kind === "text") return { ...p, at: pt(p.at), size: p.size * scale };
  const map = (e: PathElement): PathElement => {
    switch (e.kind) {
      case "segment": return segment(pt(e.from), pt(e.to));
      case "arc": return arc(pt(e.centre), e.radius * scale, e.start, e.end);
      case "cubic": return cubic(pt(e.from), pt(e.c1), pt(e.c2), pt(e.to));
    }
  };
  return { ...p, path: p.path.map(map) };
}

const furniturePath = (path: Path): PathPrim => ({ kind: "path", role: "furniture", path });

function furnitureText(at: Point, text: string, size: number, anchor: TextPrim["anchor"] = "start"): TextPrim {
  return { kind: "text", role: "furniture", at, text, angle: 0, size, anchor };
}

// ---- Check ruler ----

/**
 * A 100 mm bar at the left of the footer band, to confirm the printer
 * didn't scale the page. Ticks every 5 mm, labels at 0, 50 and 100.
 */
function checkRuler(plan: PagePlan): Primitive[] {
  const size = STYLE.footerTextSize;
  const x0 = PAGE_MARGIN + 1;                  // room for the centred "0"
  const y = plan.height - PAGE_MARGIN - 14;    // roughly centred in the band
  const path: Path = [segment([x0, y], [x0 + RULER_LENGTH, y])];
  for (let mm = 0; mm <= RULER_LENGTH; mm += 5) {
    const h = mm % 50 === 0 ? 3 : mm % 10 === 0 ? 2 : 1.2;
    path.push(segment([x0 + mm, y], [x0 + mm, y - h]));
  }
  const labelY = y - 4;
  return [
    furniturePath(path),
    furnitureText([x0, labelY], "0", size, "middle"),
    furnitureText([x0 + RULER_LENGTH / 2, labelY], "50", size, "middle"),
    // "100" centred on its tick, with the unit trailing.
    furnitureText([x0 + RULER_LENGTH - textWidth("100", size) / 2, labelY], `100 mm`, size),
    furnitureText([x0, y + 4.5], "Check: should measure 100 mm", size),
  ];
}

// ---- Title block ----

const TB = {
  pad: 1.2,          // text inset from the cell's left edge and rules
  label: 1.6,        // small caps field labels
  value: 2.5,
  title: 4,
  minTitle: 2.5,
  notes: 2,
  notesPitch: 2.4,
  titleRow: 9,
  fieldsRow: 7,
};

/** Fields row: label, width (mm, sums to the block width), value. */
type Field = [label: string, width: number, value: string];

/**
 * CAD-style block, 80 x 30 mm, flush with the printable area's bottom
 * right. Each cell has a small caps label at its top left, value below:
 *
 *   | TITLE                                  |  9 mm, value 4 mm (shrinks to fit)
 *   | AUTHOR      | REV | SCALE | SHEET      |  7 mm, values 2.5 mm
 *   | NOTES                                  | 14 mm, wrapped at 2 mm, cut with "…"
 */
function titleBlock(plan: PagePlan, info: TitleInfo, sheet: string): Primitive[] {
  const right = plan.width - PAGE_MARGIN, bottom = plan.height - PAGE_MARGIN;
  const x = right - TITLE_BLOCK.width, y = bottom - TITLE_BLOCK.height;
  const fieldsY = y + TB.titleRow, notesY = fieldsY + TB.fieldsRow;
  const inner = TITLE_BLOCK.width - 2 * TB.pad;
  const fields: Field[] = [
    ["AUTHOR", 30, info.author],
    ["REV", 12, info.revision],
    ["SCALE", 15, formatScale(plan.scale)],
    ["SHEET", 23, sheet],
  ];

  const cellXs = fields.map((_, i) => x + fields.slice(0, i).reduce((s, f) => s + f[1], 0));

  // Outline as one closed run, then the rules between rows and cells.
  const path: Path = [
    segment([x, y], [right, y]), segment([right, y], [right, bottom]),
    segment([right, bottom], [x, bottom]), segment([x, bottom], [x, y]),
    segment([x, fieldsY], [right, fieldsY]),
    segment([x, notesY], [right, notesY]),
    ...cellXs.slice(1).map((cx) => segment([cx, fieldsY], [cx, notesY])),
  ];
  const out: Primitive[] = [furniturePath(path)];

  out.push(label(x, y, "TITLE"));
  out.push(...value(x + TB.pad, fieldsY - 1.5, info.title, TB.title, TB.minTitle, inner));
  fields.forEach(([name, width, v], i) => {
    const cx = cellXs[i]!;
    out.push(label(cx, fieldsY, name));
    out.push(...value(cx + TB.pad, notesY - 1.4, v, TB.value, TB.label, width - 2 * TB.pad));
  });

  out.push(label(x, notesY, "NOTES"));
  out.push(...notes(x + TB.pad, notesY, bottom, info.notes, inner));
  return out;
}

/** A small "Delinya" just below the title block, right-aligned with it, in the page margin. */
function watermark(plan: PagePlan): TextPrim {
  const right = plan.width - PAGE_MARGIN, bottom = plan.height - PAGE_MARGIN;
  return furnitureText([right, bottom + WATERMARK.gap + 0.75 * WATERMARK.size], "Delinya", WATERMARK.size, "end");
}

/** The watermark's text size and its clearance below the block, mm. */
const WATERMARK = { size: 2, gap: 1.5 };

/** A cell's label, top-left of the cell whose corner is (x, y). */
const label = (x: number, y: number, text: string) => furnitureText([x + TB.pad, y + 0.9 + 0.75 * TB.label], text, TB.label);

/** One line of value text, shrunk towards `min` and then cut to fit `width`. */
function value(x: number, baseline: number, raw: string, size: number, min: number, width: number): TextPrim[] {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const fit = fitLine(text, size, min, width);
  return [furnitureText([x, baseline], fit.text, fit.size)];
}

function fitLine(text: string, size: number, min: number, width: number): { text: string; size: number } {
  const w = textWidth(text, size);
  if (w <= width) return { text, size };
  // Width is proportional to size; floor to 0.1 mm so it stays inside.
  const shrunk = Math.max(min, Math.floor(((size * width) / w) * 10) / 10);
  if (textWidth(text, shrunk) <= width) return { text, size: shrunk };
  return { text: ellipsis(text, min, width), size: min };
}

/** `text` cut so that it plus "…" fits `width`. */
function ellipsis(text: string, size: number, width: number): string {
  const chars = [...text];
  const cut = () => `${chars.join("").trimEnd()}…`;
  while (chars.length && textWidth(cut(), size) > width) chars.pop();
  return cut();
}

/** Notes wrapped below the NOTES label, as many lines as fit above `bottom`. */
function notes(x: number, rowY: number, bottom: number, raw: string, width: number): TextPrim[] {
  const text = raw.trim();
  if (!text) return [];
  const size = TB.notes;
  const first = rowY + 0.9 + TB.label + 0.5 + 0.75 * size;   // below the label, with a small gap
  const last = bottom - 0.8 - 0.25 * size;                    // lowest baseline that keeps the descent in
  const max = Math.floor((last - first) / TB.notesPitch + 1e-9) + 1;
  let lines = wrapText(text, size, width);
  if (lines.length > max) {
    lines = lines.slice(0, max);
    lines[max - 1] = ellipsis(lines[max - 1]!, size, width);
  }
  return lines.flatMap((line, i) => (line ? [furnitureText([x, first + i * TB.notesPitch], line, size)] : []));
}

function sheetName(plan: PagePlan, tile: PageTile, index: number): string {
  const n = plan.tiles.length;
  return n === 1 ? "1 of 1" : `${tile.label} (${index + 1} of ${n})`;
}

// ---- Tile overlap guides ----

/** Dashed lines where the next tile right or down starts, to align sheets on. */
function overlapGuides(plan: PagePlan, tile: PageTile): Primitive[] {
  const { x, y, width, height } = plan.area;
  const out: Primitive[] = [];
  if (tile.col < plan.cols - 1) {
    const gx = x + width - TILE_OVERLAP;
    out.push({ kind: "path", role: "guide", path: [segment([gx, y], [gx, y + height])] });
  }
  if (tile.row < plan.rows - 1) {
    const gy = y + height - TILE_OVERLAP;
    out.push({ kind: "path", role: "guide", path: [segment([x, gy], [x + width, gy])] });
  }
  return out;
}
