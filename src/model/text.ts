// Text box actions. A box's font size is never stored: it is what fits (see
// font.ts). So an edit that should keep the size (new text, a new font or
// style) or set it rewrites the box's height to what the text then needs at
// that size: lines × LINE_SPACING × size. A box is drawn never narrower
// than its longest word (fitWidth); these edits also widen its stored width
// to that word when it is wider, never narrowing it, so the document says
// what is drawn. Width and height go through setLength, so a linked one
// edits its variable.

import type { Change, DocState, Props } from "@sandtreader/collab/protocol";
import { batch, deleteEntity, propsChanged, setLength } from "./actions";
import { type FontStyle, fitTextSize, longestWord, textHeight, wrapText } from "./font";
import { snapNumber } from "./geometry";
import { type ResolvedText, lengthValue, resolve } from "./resolve";
import { type EntityId, type FontFamily, type TextAlign, type TextProps, KINDS, isRef, toProps } from "./types";

export function addText(id: EntityId, props: TextProps): Change {
  return { type: "entity_added", id, kind: KINDS.text, props: toProps(props) };
}

/**
 * Change a box's text, keeping its font size: the height becomes what the
 * new text needs at the size it has now, and the width widens to its
 * longest word if that is wider. Undefined if `id` is not a text box or the
 * text is the same.
 */
export function setText(state: DocState, id: EntityId, text: string): Change | undefined {
  const s = textBox(state, id);
  if (!s || state.entities[id]!.props.text === text) return undefined;
  return refit(state, s, { text }, text, s.font, s.size);
}

/**
 * Set a box's font size, by giving it the height its text needs at `size`
 * (and the width of its longest word, if that is wider than it is).
 * Undefined if `id` is not a text box, `size` is not a positive number, or
 * nothing would change.
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
  align?: TextAlign;
}

/**
 * Change a box's font family, bold, italic or alignment, keeping its font
 * size: a new font or style sets the height to what the text needs in it,
 * and widens the box to its longest word if that is now wider (alignment
 * alone doesn't change the wrap, so leaves both be). Only the parts that
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
  const restyled = Object.keys(props).length > 0;
  if (style.align !== undefined && style.align !== s.align) props.align = style.align;
  if (Object.keys(props).length === 0) return undefined;
  if (!restyled) return propsChanged(id, props);
  const font: FontStyle = { family: style.font ?? s.font.family, bold: style.bold ?? s.font.bold, italic: style.italic ?? s.font.italic };
  return refit(state, s, props, s.text, font, s.size);
}

/**
 * The width to give a text box sized `width` × `height` (its own height if
 * absent), as when dragging its corner: `width`, or its longest word at the
 * font size that box gives if that is wider, so a box dragged narrower than
 * the word stops at it. `width` for anything but a text box.
 */
export function textBoxWidth(state: DocState, id: EntityId, width: number, height?: number): number {
  const s = textBox(state, id);
  if (!s) return width;
  const size = fitTextSize(s.text, s.font, width, height ?? s.height);
  const word = longestWord(s.text, s.font) * size;
  return word > width ? snapNumber(word) : width;
}

/**
 * Leaving a box after typing into it: a box left with no text (or only
 * spaces and newlines) goes, with anything attached to it. Undefined if it
 * has text, or `id` is not a text box.
 */
export function endTextEdit(state: DocState, id: EntityId): Change | undefined {
  const e = state.entities[id];
  if (e?.kind !== KINDS.text) return undefined;
  const text = typeof e.props.text === "string" ? e.props.text : "";
  return text.trim() === "" ? deleteEntity(state, id) : undefined;
}

/** The text box `id` as resolved, if it is one. */
function textBox(state: DocState, id: EntityId): ResolvedText | undefined {
  if (state.entities[id]?.kind !== KINDS.text) return undefined;
  const s = resolve(state).shapes[id];
  return s?.kind === "text" ? s : undefined;
}

/**
 * `props` written to box `s`; its stored width widened to the longest word
 * of `text` in `font` at `size` if that is wider (never narrowed); and its
 * height set so the text, wrapped to that width, just fits. A box with no
 * size (no width or height) keeps its width and height. Undefined if
 * nothing changes.
 */
function refit(state: DocState, s: ResolvedText, props: Props, text: string, font: FontStyle, size: number): Change | undefined {
  const changes: Change[] = [];
  if (Object.keys(props).length > 0) changes.push(propsChanged(s.id, props));
  if (size > 0) {
    let width = storedWidth(state, s.id);
    const word = longestWord(text, font) * size;
    if (word > width) {
      // Wrapped at the word's own width, as resolve will, not its rounding.
      width = word;
      const w = setLength(state, s.id, "width", snapNumber(word));
      if (w) changes.push(w);
    }
    const height = snapNumber(textHeight(wrapText(text, font, size, width).length, size));
    const h = height !== s.height ? setLength(state, s.id, "height", height) : undefined;
    if (h) changes.push(h);
  }
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/**
 * Set a box's width (the panel's field), keeping its font size: never
 * narrower than its longest word, as the handles stop there, and the
 * height becomes what the text needs rewrapped at that width. Through the
 * variable if the width is linked. Undefined if `id` is not a text box, the
 * width is not a positive number, or nothing changes.
 */
export function setTextWidth(state: DocState, id: EntityId, width: number): Change | undefined {
  const s = textBox(state, id);
  if (!s || !(width > 0) || !Number.isFinite(width)) return undefined;
  // Wrapped at the exact width, as resolve will, not its rounding.
  const exact = Math.max(width, longestWord(s.text, s.font) * s.size);
  const changes: Change[] = [];
  const stored = snapNumber(exact);
  if (stored !== storedWidth(state, id)) {
    const w = setLength(state, id, "width", stored);
    if (w) changes.push(w);
  }
  if (s.size > 0) {
    const height = snapNumber(textHeight(wrapText(s.text, s.font, s.size, exact).length, s.size));
    const h = height !== s.height ? setLength(state, id, "height", height) : undefined;
    if (h) changes.push(h);
  }
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : batch(changes);
}

/** A text box's width as stored, through its variable if linked; 0 if unusable, as resolve reads it. */
function storedWidth(state: DocState, id: EntityId): number {
  const v = state.entities[id]!.props.width;
  const n = typeof v === "number" || isRef(v) ? lengthValue(state, v) : undefined;
  return n !== undefined && Number.isFinite(n) ? n : 0;
}
