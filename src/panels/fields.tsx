// Form widgets shared by the shape panel and the Properties dialog. Values
// commit on blur or Enter, so anything that unmounts them should blur first.

import { useEffect, useState } from "react";
import { formatMm } from "../view/format";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="row"><span className="label">{label}</span>{children}</label>;
}

export function Num({ value, onCommit, disabled, unit = "mm" }: { value: number; onCommit: (v: number) => void; disabled?: boolean; unit?: string }) {
  const [text, setText] = useState(formatMm(value));
  useEffect(() => { setText(formatMm(value)); }, [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(formatMm(value));
  };
  return (
    <span className="num">
      <input
        type="text" inputMode="decimal" value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setText(formatMm(value)); }}
      />
      <span className="unit">{unit}</span>
    </span>
  );
}

/** Free text, committed on blur or Enter (⌘Enter in a multi-line field). */
export function Text({ value, onCommit, placeholder, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const props = {
    className: "text", value: text, placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => { if (text !== value) onCommit(text); },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === "Escape") { setText(value); e.currentTarget.blur(); }
    },
  };
  return multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />;
}
