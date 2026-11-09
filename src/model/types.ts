// Delinya document model.
//
// The document is the shared entity document from @sandtreader/collab: a
// flat map of `{ kind, props }` by ID. This file names Delinya's kinds and
// gives each one a typed view of its props. Nothing here is derived; the
// derived geometry lives in resolve.ts and is never stored or synced.
//
// Units: every length is millimetres. Angles are degrees from +x towards
// +y; y is down, so positive angles turn clockwise on screen. Scale is a
// view/print setting, not model state.

import type { DocState, Entity, Props, PropValue } from "@sandtreader/collab/protocol";

export type { DocState, Entity, Props, PropValue };

export type EntityId = string;

/** A length prop is a literal number of mm or a reference to a variable. */
export type Length = number | VariableRef;
export interface VariableRef { ref: EntityId }

export function isRef(v: unknown): v is VariableRef {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as VariableRef).ref === "string";
}

// ---- Kinds ----

export const KINDS = {
  line: "line",
  rect: "rect",
  circle: "circle",
  variable: "variable",
  spacing: "link.spacing",
  align: "link.align",
  dimension: "dimension",
  radiusLabel: "radius-label",
  document: "document",
  layer: "layer",
} as const;

export type Kind = (typeof KINDS)[keyof typeof KINDS];
export type ShapeKind = "line" | "rect" | "circle";
export const SHAPE_KINDS: ReadonlySet<string> = new Set<ShapeKind>(["line", "rect", "circle"]);

// ---- Shapes ----

/** A line from (x, y) at `angle` for `length`. Length can be linked. */
export interface LineProps {
  x: number;
  y: number;
  length: Length;
  angle: number;
  layer?: EntityId;
}

/** Axis-aligned rectangle; r is one corner radius per corner [tl, tr, br, bl]. */
export interface RectProps {
  x: number;
  y: number;
  width: Length;
  height: Length;
  r?: [Length, Length, Length, Length];
  layer?: EntityId;
}

export interface CircleProps {
  cx: number;
  cy: number;
  diameter: Length;
  layer?: EntityId;
}

// ---- Non-shape entities ----

export interface VariableProps {
  name?: string;
  value: number;
}

export type Axis = "x" | "y";
export type SpacingMode = "gaps" | "centres";

/**
 * Equal spacing of `items` along `axis` between two anchor shapes. Each
 * item's along-axis position is derived while linked and its stored value
 * is ignored. Cross-axis position stays authored.
 */
export interface SpacingProps {
  anchorA: EntityId;
  anchorB: EntityId;
  items: EntityId[];
  axis: Axis;
  mode: SpacingMode;
}

export type AlignMode = "start" | "centre" | "end";

/**
 * Line `items` up with `anchor` along `axis`: start (min) edges, centres or
 * end (max) edges. As with spacing, each item's along-axis position is
 * derived while linked and the cross axis stays authored.
 */
export interface AlignProps {
  anchor: EntityId;
  items: EntityId[];
  axis: Axis;
  mode: AlignMode;
}

export type DimensionProp = "width" | "height" | "diameter" | "length";

/** A dimension label attached to one measurable prop of a shape. */
export interface DimensionProps {
  target: EntityId;
  prop: DimensionProp;
  /** Perpendicular offset of the dimension line from the shape, mm. */
  offset: number;
}

export interface RadiusLabelProps {
  target: EntityId;
  corner: 0 | 1 | 2 | 3;
}

/** Title-block text for the whole drawing, on the singleton DOCUMENT_ID. */
export interface DocumentProps {
  title?: string;
  author?: string;
  revision?: string;
  notes?: string;
}

export type DocumentField = keyof DocumentProps;
export const DOCUMENT_FIELDS: readonly DocumentField[] = ["title", "author", "revision", "notes"];
export const DOCUMENT_ID = "document";

/**
 * A layer: shapes on it draw together, above lower-numbered layers. Position
 * comes from `order` (lowest at the back); ties go by ID. Shapes name their
 * layer in their `layer` prop. Hiding and locking are each viewer's own
 * choice, held in editor state, never here.
 */
export interface LayerProps {
  name?: string;
  order: number;
}

/**
 * The base layer's well-known ID. A drawing with no layer entities has one
 * implicit base layer at this ID; shapes with no (or a dangling) layer prop
 * resolve onto it.
 */
export const BASE_LAYER_ID = "layer";

// ---- Typed access ----

export interface PropsByKind {
  line: LineProps;
  rect: RectProps;
  circle: CircleProps;
  variable: VariableProps;
  "link.spacing": SpacingProps;
  "link.align": AlignProps;
  dimension: DimensionProps;
  "radius-label": RadiusLabelProps;
  document: DocumentProps;
  layer: LayerProps;
}

/** Typed read of an entity's props; undefined if missing or of another kind. */
export function entityAs<K extends Kind>(state: DocState, id: EntityId, kind: K): PropsByKind[K] | undefined {
  const e = state.entities[id];
  if (!e || e.kind !== kind) return undefined;
  return e.props as unknown as PropsByKind[K];
}

export function kindOf(state: DocState, id: EntityId): string | undefined {
  return state.entities[id]?.kind;
}

export function isShape(e: Entity | undefined): boolean {
  return e !== undefined && SHAPE_KINDS.has(e.kind);
}

/** Entities of one kind, as [id, props] pairs, in insertion order. */
export function entitiesOfKind<K extends Kind>(state: DocState, kind: K): Array<[EntityId, PropsByKind[K]]> {
  const out: Array<[EntityId, PropsByKind[K]]> = [];
  for (const [id, e] of Object.entries(state.entities)) {
    if (e.kind === kind) out.push([id, e.props as unknown as PropsByKind[K]]);
  }
  return out;
}

/** Props as the wire type, for building changes from typed objects. */
export function toProps<T extends object>(p: T): Props {
  return p as unknown as Props;
}
