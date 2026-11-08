// Geometry path -> SVG `d` attribute.

import { type Path, type Point, arcEnd, arcStart, pointsNear } from "../model";

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

export function pathToSvg(path: Path): string {
  let d = "";
  let cursor: Point | null = null;
  for (const e of path) {
    const start = e.kind === "segment" ? e.from : arcStart(e);
    if (!cursor || !pointsNear(cursor, start, 1e-6)) d += `M${f(start[0])} ${f(start[1])}`;
    if (e.kind === "segment") {
      d += `L${f(e.to[0])} ${f(e.to[1])}`;
      cursor = e.to;
    } else {
      const span = e.end - e.start;
      const r = f(e.radius);
      if (span >= 360) {
        // Two half arcs; a single arc can't describe a full circle.
        const [cx, cy] = e.centre;
        d += `A${r} ${r} 0 1 1 ${f(cx - e.radius)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx + e.radius)} ${f(cy)}`;
        cursor = [cx + e.radius, cy];
      } else {
        const end = arcEnd(e);
        // Angle increases from +x towards +y, which is SVG's sweep=1 direction.
        d += `A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f(end[0])} ${f(end[1])}`;
        cursor = end;
      }
    }
  }
  return d;
}
