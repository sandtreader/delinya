// The field a text box is typed into on the drawing: an HTML textarea laid
// over the box in screen px, in the box's font, size and line spacing,
// turned with it about its (x, y) corner, aligned as the box is. Never
// mirrored, so the text reads while it is typed (aligned as stored, not as
// the mirror shows it).

import { LINE_SPACING, isVisible, rotatePoint, type EntityId, type Point, type Resolved, type ResolvedText, type TextAlign } from "../model";
import { fontStack } from "./textSvg";
import { toScreen, type View } from "./viewport";

/** CSS for the field: px numbers and strings, as React's style takes them. */
export interface TextEditorBox {
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: "bold" | "normal";
  fontStyle: "italic" | "normal";
  textAlign: "left" | "center" | "right";
}

const CSS_ALIGN: Record<TextAlign, TextEditorBox["textAlign"]> = { left: "left", centre: "center", right: "right" };

export function textEditorBox(t: ResolvedText, view: View): TextEditorBox {
  const [left, top] = toScreen(view, [t.x, t.y]);
  return {
    left, top, width: t.width * view.scale, height: t.height * view.scale,
    transform: `rotate(${t.rotation}deg)`, transformOrigin: "0 0",
    fontFamily: fontStack(t.font.family), fontSize: t.size * view.scale, lineHeight: LINE_SPACING,
    fontWeight: t.font.bold ? "bold" : "normal", fontStyle: t.font.italic ? "italic" : "normal",
    textAlign: CSS_ALIGN[t.align],
  };
}

const NONE: ReadonlySet<EntityId> = new Set();

/**
 * The topmost text box containing `p` (model mm), anywhere inside its turned
 * box, not just on its outline; null if none. Boxes on `hidden` or `locked`
 * layers don't count. Found by position, as a double-click's target is the
 * canvas itself once the press has captured the pointer.
 */
export function textBoxAt(
  r: Resolved, p: Point, { hidden = NONE, locked = NONE }: { hidden?: ReadonlySet<EntityId>; locked?: ReadonlySet<EntityId> } = {},
): EntityId | null {
  for (let i = r.order.length - 1; i >= 0; i--) {
    const s = r.shapes[r.order[i]!];
    if (s?.kind !== "text" || !isVisible(r, s.id, hidden) || locked.has(s.layer)) continue;
    const [lx, ly] = rotatePoint(p, -s.rotation, [s.x, s.y]);
    const u = lx - s.x, v = ly - s.y;
    if (u >= 0 && u <= s.width && v >= 0 && v <= s.height) return s.id;
  }
  return null;
}
