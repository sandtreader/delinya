// Typing a text box's text on the drawing: a textarea laid over the box
// (view/textEdit.ts), in its font, size, line spacing and alignment, turned
// with it and never mirrored. It commits as you type, as the panel's field does
// (useLiveText), so the box grows and the edit is one undo step. Escape,
// ⌘/Ctrl+Enter and leaving the field finish; so does the editor dropping
// it (another selection or tool). A box left empty is deleted in the edit's
// own undo step; one just drawn (its gesture still open, editFresh) joins
// that gesture, so drawing and typing are one step, and left empty is taken
// back without trace.

import { useEffect, useRef } from "react";
import { BASELINE, LINE_SPACING, endTextEdit, type FontStyle, type ResolvedText } from "../model";
import { store } from "../app/store";
import { useEditor } from "../app/editor";
import { useLiveText } from "../app/liveText";
import { textEditorBox } from "../view/textEdit";
import { fontStack } from "../view/textSvg";
import type { View } from "../view/viewport";

/** A wheel over the field, for the canvas to zoom by. */
export type FieldWheel = Pick<WheelEvent, "clientX" | "clientY" | "deltaY" | "ctrlKey">;

export function TextEditor({ shape, view, colour, onWheel }: {
  shape: ResolvedText;
  view: View;
  /** The shape's ink: its layer colour, if it has one. */
  colour: string | null;
  onWheel: (e: FieldWheel) => void;
}) {
  const { editor, dispatch } = useEditor();
  const id = shape.id;
  const ref = useRef<HTMLTextAreaElement>(null);
  // `finish` ends the edit, even when the field goes without a blur.
  const live = useLiveText(id, { endOnUnmount: false });
  const done = useRef(false);
  const fresh = useRef(editor.editFresh);
  const selection = useRef(editor.selection);
  selection.current = editor.selection;
  const wheel = useRef(onWheel);
  wheel.current = onWheel;

  /**
   * Close the edit's gesture, deleting the box in it if it was left empty;
   * one just drawn and left empty is taken back instead, as if never drawn.
   * `dropped`: the editor has already let go of it (this field is going),
   * and the app drops a deleted box from the selection itself.
   */
  const finish = (dropped: boolean) => {
    if (done.current) return;
    done.current = true;
    const c = endTextEdit(store.state, id);
    // Drawn and left empty: no undo step, nor unsaved, as if never drawn.
    const abandoned = c !== undefined && fresh.current && live.abandon();
    // Emptied: deleted in the edit's own undo step.
    if (c && !abandoned) live.endWith(c);
    else if (!c) live.end();
    if (dropped) return;
    if (c) dispatch({ type: "select", ids: selection.current.filter((i) => i !== id) });
    dispatch({ type: "editText", id: null });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Coming in: the keyboard, the caret at the end (an empty box: all of it).
  // Going without a blur (another selection or tool): finish all the same,
  // checked a moment later, as StrictMode unmounts and mounts again at once.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const el = ref.current!;
    el.focus({ preventScroll: true });
    if (el.value.trim() === "") el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    live.start();
    if (fresh.current) live.join();
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) finishRef.current(true); });
    };
    // Once, on coming in: `live` and `finishRef` work through refs.
  }, []);

  // The wheel zooms the drawing, as over the canvas. Not passive, so the
  // field doesn't scroll.
  useEffect(() => {
    const el = ref.current!;
    const on = (e: WheelEvent) => { e.preventDefault(); wheel.current(e); };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  const box = textEditorBox(shape, view);
  const shift = baselineShift(shape.font) * box.fontSize;
  const ink = colour ?? "var(--shape)";
  return (
    <div className="text-editor-clip">
      <textarea
        ref={ref} className="text-editor" value={shape.text} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-label="Text"
        style={{ ...box, transform: shift ? `${box.transform} translateY(${-shift}px)` : box.transform, color: ink, caretColor: ink }}
        onChange={(e) => live.change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" && !(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
          // Finish, keeping the text (the panel's Escape puts it back instead).
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }}
        // The window losing focus blurs the field but leaves it the active
        // element: that's not leaving it.
        onBlur={(e) => { if (document.activeElement !== e.currentTarget) finish(false); }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

const shifts = new Map<string, number>();

/**
 * How far below the model's baseline (BASELINE × size from the top) the
 * field puts the first line's, in font sizes: CSS centres the font's ascent
 * and descent in each LINE_SPACING-tall line. The browser's own font
 * metrics, as it lays text out; 0 if it can't say.
 */
function baselineShift(font: FontStyle): number {
  const css = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}100px ${fontStack(font.family)}`;
  let shift = shifts.get(css);
  if (shift === undefined) {
    shift = 0;
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) {
        ctx.font = css;
        const m = ctx.measureText("Hg");
        const ascent = m.fontBoundingBoxAscent / 100, descent = m.fontBoundingBoxDescent / 100;
        if (ascent > 0 && Number.isFinite(ascent) && Number.isFinite(descent)) shift = (LINE_SPACING - ascent - descent) / 2 + ascent - BASELINE;
      }
    } catch { /* no canvas: unshifted */ }
    shifts.set(css, shift);
  }
  return shift;
}
