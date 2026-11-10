// Line icons for buttons: 16 px grid (18 for size 18), stroked in the
// button's text colour. Drawn larger, the stroke stays 1.5 px.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Icon({ size = 16, className, children }: { size?: number; className?: string; children: ReactNode }) {
  const box = size === 18 ? 18 : 16;
  return (
    <svg
      className={className} width={size} height={size} viewBox={`0 0 ${box} ${box}`} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={size < 12 ? 2 : 1.5 * box / Math.max(size, box)} strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/**
 * An icon-only button. Its name shows at once in a tooltip on hover or
 * keyboard focus (data-tip, drawn by styles.css), not the browser's slow
 * title tooltip.
 */
export function IconButton({ label, tip = label, children, ...rest }:
  { label: string; tip?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon" aria-label={label} data-tip={tip} {...rest}>{children}</button>;
}

// ---- Header and status bar ----

/** Header and status bar icons are drawn at this size. */
const BAR = 20;

/** A blank page with a folded corner. */
export const NewIcon = () => <Icon size={BAR}><path d="M3.5 1.5h6l3 3v10h-9z" /><path d="M9.5 1.5v3h3" /></Icon>;

/** An open folder. */
export const OpenIcon = () => <Icon size={BAR}><path d="M1.5 13V3h4.5l1.5 1.5h5.5v2.5" /><path d="M1.5 13l2.2-6h11l-2.2 6z" /></Icon>;

/** A floppy disk. */
export const SaveIcon = () => (
  <Icon size={BAR}><path d="M2.5 2.5h9l2 2v9h-11z" /><path d="M5 2.5v3h5v-3" /><path d="M4.5 13.5v-4h7v4" /></Icon>
);

/** A floppy disk with a pencil: save under a new name. */
export const SaveAsIcon = () => (
  <Icon size={BAR}>
    <path d="M7.5 13.5h-5v-11h8.5l2 2v2.5" /><path d="M5 2.5v3h5v-3" /><path d="M4.5 13.5v-4h4" />
    <path d="M9.5 14.5l.5-2.3 3.6-3.6 1.8 1.8-3.6 3.6z" />
  </Icon>
);

/** Sliders: the drawing's properties and variables. */
export const PropertiesIcon = () => (
  <Icon size={BAR}>
    <path d="M2 4h6.5M11.5 4H14M2 8h1.5M6.5 8H14M2 12h7.5M12.5 12H14" />
    <circle cx="10" cy="4" r="1.5" /><circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="12" r="1.5" />
  </Icon>
);

/** A printer. */
export const PrintIcon = () => (
  <Icon size={BAR}><path d="M4.5 5.5v-4h7v4" /><path d="M4.5 11.5h-3v-6h13v6h-3" /><path d="M4.5 9.5h7v5h-7z" /></Icon>
);

/** A curved arrow back (undo) or, mirrored, forward (redo). */
export const HistoryIcon = ({ redo = false }: { redo?: boolean }) => (
  <Icon size={BAR}>
    <g transform={redo ? "matrix(-1 0 0 1 16 0)" : undefined}>
      <path d="M5.5 3.5 2.5 6.5l3 3" />
      <path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H6.5" />
    </g>
  </Icon>
);

/** Frame corners round a centre: back to the default view. */
export const ResetViewIcon = () => (
  <Icon size={BAR}>
    <path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);
