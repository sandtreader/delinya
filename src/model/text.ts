// Text box actions. A box's font size is never stored: it is what fits (see
// font.ts). So an edit that should keep the size (new text, a new font or
// style) or set it rewrites the box's height to what the text then needs at
// that size: lines × LINE_SPACING × size. The height goes through setLength,
// so a linked height edits its variable.

import type { Change, DocState, Props } from "@sandtreader/collab/protocol";
import { batch, propsChanged, setLength } from "./actions";
import { type FontStyle, textHeight, wrapText } from "./font";
import { snapNumber } from "./geometry";
import { type ResolvedText, resolve } from "./resolve";
import { type EntityId, type FontFamily, type TextProps, KINDS, toProps } from "./types";

export function addText(id: EntityId, props: TextProps): Change {
  return { type: "entity_added", id, kind: KINDS.text, props: toProps(props) };
}

/**
 * Change a box's text, keeping its font size: the height becomes what the
 * new text needs at the size it has now. Undefined if `id` is not a text
 * box or the text is the same.
 */
export function setText(state: DocState, id: EntityId, text: string): Change | undefined {
  const s = textBox(state, id);
  if (!s || state.entities[id]!.props.text === text) return undefined;
  return refit(state, s, { text }, text, s.font, s.size);
}

/**
 * Set a box's font size, by giving it the height its text needs at `size`.
 * Undefined if `id` is not a text box, `size` is not a positive number, or
 * the height would not change.
 */
export function setTextSize(state: DocState, id: EntityId, size: number): Change | undefined {
  const s = textBox(state, id);
  if (!s || !(size > 0) || !Number.isFinite(size)) return undefined;
  return refit(state, s, {}, s.text, s.font, size);
}

export interface TextStyle {
  font?: FontFamily;
  bold?: boolean;
  italic?: boolean;
}

/**
 * Change a box's font family, bold or italic, keeping its font size: the
 * height becomes what the text needs in the new style. Only the parts that
 * differ from what the box shows are written. Undefined if `id` is not a
 * text box or nothing differs.
 */
export function setTextStyle(state: DocState, id: EntityId, style: TextStyle): Change | undefined {
  const s = textBox(state, id);
  if (!s) return undefined;
  const props: Props = {};
  if (style.font !== undefined && style.font !== s.font.family) props.font = style.font;
  if (style.bold !== undefined && style.bold !== s.font.bold) props.bold = style.bold;
  if (style.italic !== undefined && style.italic !== s.font.italic) props.italic = style.italic;
  if (Object.keys(props).length === 0) return undefined;
  const font: FontStyle = { family: style.font ?? s.font.family, bold: style.bold ?? s.font.bold, italic: style.italic ?? s.font.italic };
  return refit(state, s, props, s.text, font, s.size);
}

/** The text box `id` as resolved, if it is one. */
function textBox(state: DocState, id: EntityId): ResolvedText | undefined {
  if (state.entities[id]?.kind !== KINDS.text) return undefined;
  const s = resolve(state).shapes[id];
  return s?.kind === "text" ? s : undefined;
}

/**
 * `props` written to box `s`, and its height set so `text` in `font` at
 * `size`, wrapped to its width, just fits. A box with no size (no width or
 * height) keeps its height. Undefined if nothing changes.
 */
function refit(state: DocState, s: ResolvedText, props: Props, text: string, font: FontStyle, size: number): Change | undefined {
  const changes: Change[] = [];
  if (Object.keys(props).length > 0) changes.push(propsChanged(s.id, props));
  if (size > 0) {
    const height = snapNumber(textHeight(wrapText(text, font, size, s.width).length, size));
    const h = height !== s.height ? setLength(state, s.id, "height", height) : undefined;
    if (h) changes.push(h);
  }
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}
