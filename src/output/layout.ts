// Page planning: which part of the drawing each sheet shows.
//
// A drawing that fits is centred on one page. A bigger one is tiled into
// a grid of pages whose windows overlap by TILE_OVERLAP on paper, so the
// sheets can be lined up and taped. Everything here is pure arithmetic on
// bounds; compose.ts draws the pages.

import type { Bounds } from "../model";
import { SCALES } from "./paper";
import { FOOTER_HEIGHT, PAGE_MARGIN, TILE_OVERLAP } from "./style";
import type { Orientation, PagePlan, PageTile, Paper, PrintOptions, Rect } from "./types";

export type PlanOptions = Pick<PrintOptions, "paper" | "orientation" | "scale">;

export function planPages(bounds: Bounds, o: PlanOptions): PagePlan {
  if (o.orientation !== "auto") return planOriented(bounds, o.paper, o.orientation, o.scale);
  const portrait = planOriented(bounds, o.paper, "portrait", o.scale);
  const landscape = planOriented(bounds, o.paper, "landscape", o.scale);
  return landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}

/** The largest standard scale that fits on one page, else the smallest. */
export function fitScale(bounds: Bounds, paper: Paper, orientation: Orientation | "auto"): number {
  for (const scale of SCALES) {
    if (planPages(bounds, { paper, orientation, scale }).tiles.length === 1) return scale;
  }
  return SCALES[SCALES.length - 1]!;
}

function planOriented(bounds: Bounds, paper: Paper, orientation: Orientation, scale: number): PagePlan {
  const [width, height] = orientation === "portrait" ? [paper.width, paper.height] : [paper.height, paper.width];
  const area: Rect = {
    x: PAGE_MARGIN, y: PAGE_MARGIN,
    width: width - 2 * PAGE_MARGIN, height: height - 2 * PAGE_MARGIN - FOOTER_HEIGHT,
  };
  const xs = windows(bounds.minX, bounds.maxX, area.width, scale);
  const ys = windows(bounds.minY, bounds.maxY, area.height, scale);
  const tiles: PageTile[] = [];
  ys.forEach(([minY, maxY], row) => xs.forEach(([minX, maxX], col) => {
    tiles.push({ row, col, label: `${rowLetters(row)}${col + 1}`, window: { minX, minY, maxX, maxY } });
  }));
  return { width, height, orientation, scale, rows: ys.length, cols: xs.length, area, tiles };
}

/** Model-space windows along one axis, each `size` paper mm long. */
function windows(min: number, max: number, size: number, scale: number): [number, number][] {
  const needed = (max - min) * scale;
  const span = size / scale;
  if (needed <= size + 1e-9) {
    const c = (min + max) / 2;
    return [[c - span / 2, c + span / 2]];
  }
  const step = size - TILE_OVERLAP;
  const count = 1 + Math.ceil((needed - size) / step);
  return Array.from({ length: count }, (_, i) => {
    const start = min + (i * step) / scale;
    return [start, start + span];
  });
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA", like spreadsheet columns. */
function rowLetters(row: number): string {
  let s = "";
  for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
