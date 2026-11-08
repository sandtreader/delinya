// Delinya document model.
//
// The document is the shared entity document from @sandtreader/collab: a
// flat map of `{ kind, props }` by ID. This file names Delinya's kinds and
// gives each one a typed view of its props. Nothing here is derived; the
// derived geometry lives in resolve.ts and is never stored or synced.
//
// Units: every length is millimetres. Angles are degrees, anticlockwise
// from the positive x axis. Scale is a view/print setting, not model state.

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
  dimension: "dimension",
  radiusLabel: "radius-label",
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
}

/** Axis-aligned rectangle; r is one corner radius per corner [tl, tr, br, bl]. */
export interface RectProps {
  x: number;
  y: number;
  width: Length;
  height: Length;
  r?: [Length, Length, Length, Length];
}

export interface CircleProps {
  cx: number;
  cy: number;
  diameter: Length;
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

// ---- Typed access ----

export interface PropsByKind {
  line: LineProps;
  rect: RectProps;
  circle: CircleProps;
  variable: VariableProps;
  "link.spacing": SpacingProps;
  dimension: DimensionProps;
  "radius-label": RadiusLabelProps;
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
