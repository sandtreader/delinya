// Output: print, PDF, SVG and DXF.
//
// Everything here is pure and derived from resolve(); nothing is stored in
// the document. The drawing becomes a list of primitives (paths and text)
// once, and each format renders those. Print and PDF share one page model,
// so the preview, the printout and the PDF are the same pages.
//
// Coordinates as in the model: x right, y down, angles in degrees from +x
// towards +y. Page units are paper millimetres from the top-left corner.

import type { Bounds, EntityId, Path, Point } from "../model";

/** What a primitive is; each renderer picks stroke width and dash from it. */
export type Role = "shape" | "dimension" | "furniture" | "guide";

export interface PathPrim {
  kind: "path";
  role: Role;
  /** May hold several disjoint runs; renderers move between them. */
  path: Path;
  /** Ink ("#rrggbb") in place of the role's: a shape on a coloured layer. */
  colour?: string;
}

export interface TextPrim {
  kind: "text";
  role: Role;
  /** Baseline point the anchor refers to. */
  at: Point;
  text: string;
  /** Degrees from +x towards +y: clockwise on a y-down page. */
  angle: number;
  /** Font size, same units as `at`. */
  size: number;
  anchor: "start" | "middle" | "end";
  /** Ink ("#rrggbb") in place of the role's; nothing sets it yet. */
  colour?: string;
}

export type Primitive = PathPrim | TextPrim;

/** A paper size in mm, portrait. */
export interface Paper {
  name: string;
  width: number;
  height: number;
}

export type Orientation = "portrait" | "landscape";

export interface PrintOptions {
  paper: Paper;
  orientation: Orientation | "auto";
  /** Paper mm per model mm: 1 is full size, 0.1 is 1:10, 2 is 2:1. */
  scale: number;
  /** Include dimensions and radius labels. */
  dimensions: boolean;
  /** Layers the viewer has hidden: left out, so print is what they see. */
  hidden?: ReadonlySet<EntityId>;
}

/** What the title block shows; the caller fills title from the file name if blank. */
export interface TitleInfo {
  title: string;
  author: string;
  revision: string;
  notes: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageTile {
  row: number;
  col: number;
  /** Row letter and column number, e.g. "B3". */
  label: string;
  /** The model-space region this page shows in its drawing area. */
  window: Bounds;
}

export interface PagePlan {
  /** Oriented paper size, mm. */
  width: number;
  height: number;
  orientation: Orientation;
  scale: number;
  rows: number;
  cols: number;
  /** Drawing area on every page, paper mm from the top-left corner. */
  area: Rect;
  /** Row-major: A1, A2, …, B1, … */
  tiles: PageTile[];
}

/** One composed page, paper mm, y down: what preview, print and PDF draw. */
export interface PageDrawing {
  width: number;
  height: number;
  /** `content` is clipped to this rectangle. */
  clip: Rect;
  /** The drawing, already transformed to paper mm. */
  content: Primitive[];
  /** Check ruler, title block and tile-overlap guides; not clipped. */
  furniture: Primitive[];
}
