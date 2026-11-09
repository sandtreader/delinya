// Paper sizes and drawing scales offered for print and PDF.

import type { Paper } from "./types";

/** Portrait, mm. ISO A series, then the common US sizes. */
export const PAPERS: readonly Paper[] = [
  { name: "A4", width: 210, height: 297 },
  { name: "A3", width: 297, height: 420 },
  { name: "A2", width: 420, height: 594 },
  { name: "A1", width: 594, height: 841 },
  { name: "A0", width: 841, height: 1189 },
  { name: "Letter", width: 215.9, height: 279.4 },
  { name: "Legal", width: 215.9, height: 355.6 },
  { name: "Tabloid", width: 279.4, height: 431.8 },
];

/** Paper mm per model mm, largest first; fitScale relies on the order. */
export const SCALES: readonly number[] = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

/** "2:1", "1:1", "1:10". */
export function formatScale(scale: number): string {
  return scale >= 1 ? `${ratio(scale)}:1` : `1:${ratio(1 / scale)}`;
}

// 1 / 0.05 is 19.999…, so round; two places keep odd scales like 1:2.5.
const ratio = (v: number) => (Math.round(v * 100) / 100).toString();
