// The app's own confirm/alert: shows the question at the head of
// app/ask.ts's queue. Always mounted; renders nothing when there is none.

import { useEffect, useRef } from "react";
import { answer, currentQuestion, useQuestion } from "../app/ask";

export function AskDialog() {
  const q = useQuestion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  /** Focus before the first of a run of questions, given back after the last. */
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    if (q) {
      restore.current ??= document.activeElement;
      confirmRef.current?.focus();
      return;
    }
    const el = restore.current;
    restore.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [q]);

  // While a question is open it takes every key, so nothing under it acts:
  // Delete would delete the selection, tool keys and ⌘S/⌘O/⌘P would fire,
  // Escape would close a layer card. This listener is registered once, at
  // app mount, in the capture phase on window, so it runs before every
  // other key listener: window bubble listeners and React's (on the root)
  // come later in the event's path, and later window capture listeners
  // (the layer card's Escape) come after it in registration order.
  // stopImmediatePropagation keeps them all from seeing the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!currentQuestion()) return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); answer(false); return; }
      if (e.key === "Tab") { e.preventDefault(); cycleFocus(dialogRef.current, e.shiftKey ? -1 : 1); return; }
      // Enter and Space press the focused button. A held key's repeats
      // don't, so holding Enter on Delete doesn't also confirm.
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!q) return null;
  const cancel = q.cancel === undefined ? "Cancel" : q.cancel;
  return (
    <div className="modal-backdrop ask-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) answer(false); }}>
      <div
        ref={dialogRef}
        className="modal ask-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        aria-describedby="ask-message"
      >
        <header>
          <h2 id="ask-title">{q.title}</h2>
        </header>
        <div className="ask-body">
          <p id="ask-message">{q.message}</p>
          <div className="buttons">
            {cancel !== null && <button onClick={() => answer(false)}>{cancel}</button>}
            <button ref={confirmRef} className={q.danger ? "danger-primary" : "primary"} onClick={() => answer(true)}>
              {q.confirm ?? "OK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tab and Shift+Tab go round the dialog's buttons and never leave it. */
function cycleFocus(dialog: HTMLElement | null, step: 1 | -1): void {
  const buttons = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  if (!buttons.length) return;
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = i < 0 ? (step > 0 ? 0 : buttons.length - 1) : (i + step + buttons.length) % buttons.length;
  buttons[next]!.focus();
}
