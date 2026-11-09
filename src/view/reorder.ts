// Drag-to-reorder in a vertical list: where a dragged item lands. Pure.

/**
 * The index a dragged item moves to: how many of the other items' centres
 * (`centres` in list order, `from` the dragged one's index) are above `y`.
 */
export function dropIndex(centres: number[], from: number, y: number): number {
  return centres.filter((c, i) => i !== from && c < y).length;
}
