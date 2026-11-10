// Form widgets shared by the shape panel and the Properties dialog. Values
// commit on blur or Enter, so anything that unmounts them should blur first.
// Escape drops the edit; if there was one, the key stops there (a dialog stays
// open), otherwise it carries on as usual.

import { useEffect, useReducer, useRef } from "react";
import { FieldDraft } from "../app/fieldDraft";
import { formatMm } from "../view/format";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="row"><span className="label">{label}</span>{children}</label>;
}

/** A FieldDraft kept across renders, and a way to re-render after changing it. */
function useDraft(text: string): [FieldDraft, () => void] {
  const ref = useRef<FieldDraft>(null);
  ref.current ??= new FieldDraft(text);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  return [ref.current, rerender];
}

/** Escape: drop the edit (keeping the key from a dialog if there was one) and leave the field. */
function escape(draft: FieldDraft, rerender: () => void, e: React.KeyboardEvent<HTMLElement>) {
  const had = draft.cancel();
  rerender();
  if (had) e.stopPropagation();
  e.currentTarget.blur();
}

/** A number field; text that isn't a number, or that `valid` refuses, goes back to the value. An empty `unit` shows none. */
export function Num({ value, onCommit, disabled, unit = "mm", valid }: {
  value: number; onCommit: (v: number) => void; disabled?: boolean; unit?: string; valid?: (v: number) => boolean;
}) {
  const [draft, rerender] = useDraft(formatMm(value));
  useEffect(() => { draft.reset(formatMm(value)); rerender(); }, [value, draft]);
  const commit = () => {
    const text = draft.take();
    if (text === undefined) return;
    const v = Number(text);
    if (Number.isFinite(v) && v !== value && (valid?.(v) ?? true)) onCommit(v);
    else { draft.reset(formatMm(value)); rerender(); }
  };
  return (
    <span className="num">
      <input
        type="text" inputMode="decimal" value={draft.text} disabled={disabled}
        onChange={(e) => { draft.edit(e.target.value); rerender(); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") escape(draft, rerender, e); }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

/** Free text, committed on blur or Enter (⌘Enter in a multi-line field). */
export function Text({ value, onCommit, placeholder, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [draft, rerender] = useDraft(value);
  useEffect(() => { draft.reset(value); rerender(); }, [value, draft]);
  const props = {
    className: "text", value: draft.text, placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { draft.edit(e.target.value); rerender(); },
    onBlur: () => { const text = draft.take(); if (text !== undefined) onCommit(text); },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") escape(draft, rerender, e);
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />;
}
