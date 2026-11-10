// The frame shared by the node and segment cards: a small card floating
// over the canvas beside a point of the selected path (screen px), which
// follows it and stays inside the drawing area. Named for screen readers.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Point } from "../model";
import { placeNear } from "../view/placeNear";
import { Icon } from "./icons";

export function PathCard({ at, name, children }: { at: Point; name: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Beside the point, inside the drawing area: measured after each render, before paint.
  useLayoutEffect(() => {
    const el = ref.current, area = el?.offsetParent;
    if (!el || !(area instanceof HTMLElement)) return;
    const p = placeNear(at, [el.offsetWidth, el.offsetHeight], [area.clientWidth, area.clientHeight]);
    setPlace((old) => (old && old.left === p.left && old.top === p.top ? old : p));
  });

  return (
    <div
      ref={ref} className="path-card" role="group" aria-label={name}
      style={place ? { left: place.left, top: place.top } : { left: at[0] + 16, top: at[1] + 16 }}
      // Not a press on the canvas below.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** The cards' delete button icon: a bin. */
export const BinIcon = () => (
  <Icon size={16}><path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M3.8 4.5l.8 9h6.8l.8-9M6.6 7v4.5M9.4 7v4.5" /></Icon>
);
