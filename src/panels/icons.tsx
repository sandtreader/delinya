// Line icons for buttons: 16 px grid (18 for size 18), stroked in the
// button's text colour. Drawn larger, the stroke stays 1.5 px.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LineDash, TextAlign } from "../model";
import { tip as tipProps } from "./tip";

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
 * An icon-only button, named by `label`, with `tip` (the label unless
 * given) in the shared tooltip and, if it says more, as its description
 * (see tip.ts). Pass
 * data-tip-side to put the tooltip somewhere other than below.
 */
export function IconButton({ label, tip = label, children, ...rest }:
  { label: string; tip?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon" aria-label={label} {...tipProps(tip, label)} {...rest}>{children}</button>;
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

/** Frame corners close round a shape: fit the view to the drawing. */
export const FitViewIcon = () => (
  <Icon size={BAR}>
    <path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" />
    <path d="M4.5 5h7v6h-7z" />
  </Icon>
);

/** Arrows out to the corners: full screen. Pointing in: back to a window. */
export const FullscreenIcon = ({ exit = false }: { exit?: boolean }) => (
  <Icon size={BAR}>
    {exit
      ? <path d="M14.5 1.5 9.5 6.5M9.5 2.5v4h4M1.5 14.5l5-5M2.5 9.5h4v4" />
      : <path d="M9 7l5.5-5.5M10 1.5h4.5V6M7 9l-5.5 5.5M6 14.5H1.5V10" />}
  </Icon>
);

/**
 * A dimension: a line with arrowheads between two extension lines, struck
 * through when `off`. The status bar's Show dimensions.
 */
export const DimensionsIcon = ({ off = false }: { off?: boolean }) => (
  <Icon size={BAR}>
    <path d="M2.5 4v8M13.5 4v8M2.5 8h11M5 6 2.5 8 5 10M11 6l2.5 2-2.5 2" />
    {off && <path d="M2 14 14 2" />}
  </Icon>
);

/** Rotate…: a square turned a little, with a round arrow over it. */
export const TurnIcon = () => (
  <Icon size={BAR}>
    <rect x="5" y="6.5" width="6" height="6" transform="rotate(20 8 9.5)" />
    <path d="M3 6.5A5.5 5.5 0 0 1 12.5 4" />
    <path d="M12.8 1.5 12.6 4.2 10 4" />
  </Icon>
);

/** Duplicate…: two squares, one copied beside and over the other. */
export const DuplicateIcon = () => (
  <Icon size={BAR}><rect x="2" y="2" width="8.5" height="8.5" rx="1" /><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1" /></Icon>
);

/** Drawing adds dimensions: a small rect with its width dimensioned above, struck through when off. */
export const AutoDimensionIcon = ({ off = false }: { off?: boolean }) => (
  <Icon size={BAR}>
    <rect x="3.5" y="7.5" width="9" height="6" />
    <path d="M3.5 2v3.5M12.5 2v3.5M3.5 3.75h9" />
    {off && <path d="M2 14 14 2" />}
  </Icon>
);

/** A line in a dash pattern: the toolbar's line style buttons. */
export const LineDashIcon = ({ dash }: { dash: LineDash }) => (
  <Icon size={BAR}>
    {dash === "solid" && <path d="M1.5 8h13" />}
    {dash === "dashed" && <path d="M1.5 8h3.5M6.5 8h3M11 8h3.5" />}
    {dash === "dotted" && [2, 5, 8, 11, 14].map((x) => <circle key={x} cx={x} cy="8" r="0.9" fill="currentColor" stroke="none" />)}
    {dash === "dashdot" && <><path d="M1.5 8h5M11 8h3.5" /><circle cx="8.75" cy="8" r="0.9" fill="currentColor" stroke="none" /></>}
  </Icon>
);

// ---- Selection panel ----

const ARROW_TURN = { right: 0, down: 90, left: 180, up: 270 } as const;

/** A plain arrow pointing right, down, left or up. */
export const ArrowIcon = ({ direction }: { direction: keyof typeof ARROW_TURN }) => (
  <Icon><path d="M2.5 8h11M9.5 4l4 4-4 4" transform={`rotate(${ARROW_TURN[direction]} 8 8)`} /></Icon>
);

/** A round arrow, a turn clockwise (over the top to the right) or, mirrored, anticlockwise. */
export const RotateIcon = ({ clockwise = false }: { clockwise?: boolean }) => (
  <Icon>
    <g transform={clockwise ? undefined : "matrix(-1 0 0 1 16 0)"}>
      <path d="M13.1 9.8A5.4 5.4 0 1 1 11.8 4.2L14.6 6.8" />
      <path d="M14.6 3.2v3.6H11" />
    </g>
  </Icon>
);

/** Two triangles mirrored across a dashed line: flip left to right (x) or, turned, top to bottom (y). */
export const FlipIcon = ({ axis }: { axis: "x" | "y" }) => (
  <Icon>
    <g transform={axis === "y" ? "rotate(90 8 8)" : undefined}>
      <path d="M8 1.5v13" strokeDasharray="1.5 2" />
      <path d="M5.5 4 1.5 12h4z" />
      <path d="M10.5 4l4 8h-4z" />
    </g>
  </Icon>
);

// ---- Shape panel ----

/** Lines of text, long and short, set left, centred or right: a text box's alignment. */
export const TextAlignIcon = ({ align }: { align: TextAlign }) => {
  const x = align === "left" ? 2.5 : align === "centre" ? 4.5 : 6.5;
  return <Icon><path d={`M2.5 3.5h11M${x} 6.5h7M2.5 9.5h11M${x} 12.5h7`} /></Icon>;
};
