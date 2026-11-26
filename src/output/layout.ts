// Page planning: which part of the drawing each sheet shows.
//
// A drawing that fits is centred on one page. A bigger one is tiled into
// a grid of pages whose windows overlap by TILE_OVERLAP on paper, so the
// sheets can be lined up and taped. The footer band (title block, check
// ruler) goes on the last sheet only, so the rows above the bottom one get
// the whole printable height; the bottom row keeps the band clear on all
// its sheets, since a row's sheets share one slice of the drawing.
// Everything here is pure arithmetic on bounds; compose.ts draws the pages.

import type { Bounds } from "../model";
import { SCALES } from "./paper";
import { FOOTER_HEIGHT, PAGE_MARGIN, TILE_OVERLAP } from "./style";
import type { Orientation, PagePlan, PageTile, Paper, PrintOptions, Rect } from "./types";

export type PlanOptions = Pick<PrintOptions, "paper" | "orientation" | "scale"> & {
  /** Height of the footer band below the drawing area, mm: FOOTER_HEIGHT unless given; 0 when it would be empty. */
  footer?: number;
};

export function planPages(bounds: Bounds, o: PlanOptions): PagePlan {
  const footer = o.footer ?? FOOTER_HEIGHT;
  if (o.orientation !== "auto") return planOriented(bounds, o.paper, o.orientation, o.scale, footer);
  const portrait = planOriented(bounds, o.paper, "portrait", o.scale, footer);
  const landscape = planOriented(bounds, o.paper, "landscape", o.scale, footer);
  return landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}

/** The largest standard scale that fits on one page, else the smallest. */
export function fitScale(bounds: Bounds, paper: Paper, orientation: Orientation | "auto"): number {
  for (const scale of SCALES) {
    if (planPages(bounds, { paper, orientation, scale }).tiles.length === 1) return scale;
  }
  return SCALES[SCALES.length - 1]!;
}

function planOriented(bounds: Bounds, paper: Paper, orientation: Orientation, scale: number, footer: number): PagePlan {
  const [width, height] = orientation === "portrait" ? [paper.width, paper.height] : [paper.height, paper.width];
  const areaWidth = width - 2 * PAGE_MARGIN, full = height - 2 * PAGE_MARGIN;
  const xs = windows(bounds.minX, bounds.maxX, areaWidth, areaWidth, scale);
  const ys = windows(bounds.minY, bounds.maxY, full, full - footer, scale);
  const tiles: PageTile[] = [];
  ys.forEach(([minY, maxY], row) => xs.forEach(([minX, maxX], col) => {
    const area: Rect = { x: PAGE_MARGIN, y: PAGE_MARGIN, width: areaWidth, height: row < ys.length - 1 ? full : full - footer };
    tiles.push({ row, col, label: `${rowLetters(row)}${col + 1}`, window: { minX, minY, maxX, maxY }, area });
  }));
  return { width, height, orientation, scale, rows: ys.length, cols: xs.length, tiles };
}

/**
 * Model-space windows along one axis: `size` paper mm long, but the last
 * `last` long (the bottom row, which keeps the footer band clear). One
 * window is centred on the drawing; several start at its edge and overlap
 * by TILE_OVERLAP.
 */
function windows(min: number, max: number, size: number, last: number, scale: number): [number, number][] {
  const needed = (max - min) * scale;
  if (needed <= last + 1e-9) {
    const c = (min + max) / 2, half = last / scale / 2;
    return [[c - half, c + half]];
  }
  const step = size - TILE_OVERLAP;
  const count = 1 + Math.ceil((needed - last) / step - 1e-9);
  return Array.from({ length: count }, (_, i) => {
    const start = min + (i * step) / scale;
    return [start, start + (i === count - 1 ? last : size) / scale];
  });
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA", like spreadsheet columns. */
function rowLetters(row: number): string {
  let s = "";
  for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
