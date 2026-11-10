// Where a small floating card goes beside a point, in screen px within its
// area: below right of the point, flipped to the other side on an axis
// where it would leave the area, and kept inside (from the top left if it
// is bigger than the area).

export function placeNear(
  [x, y]: readonly [number, number], [w, h]: readonly [number, number], [areaW, areaH]: readonly [number, number],
  gap = 16, margin = 4,
): { left: number; top: number } {
  const along = (p: number, size: number, area: number) => {
    let v = p + gap;
    if (v + size > area - margin) v = p - gap - size;
    return Math.max(margin, Math.min(v, area - margin - size));
  };
  return { left: along(x, w, areaW), top: along(y, h, areaH) };
}
