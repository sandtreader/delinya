// The drawing surface: an SVG with a model-space layer. Reads the resolved
// geometry, writes only through the store. Tools are a small pointer state
// machine kept in a ref so pointer moves don't re-render.

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import {
  addCircle, addDimension, addLine, addRect, batch, handlesFor, moveBy, newId, resizeTo, snapNumber,
  type EntityId, type HandleSpot, type Point, type ResolvedDimension, type ResolvedRadiusLabel, type ResolvedShape, type SnapPoint,
} from "../model";
import { store, useDocument } from "../app/store";
import { useEditor, type Tool } from "../app/editor";
import { gridPitch, toModel, toScreen, type View } from "../view/viewport";
import { pathToSvg } from "../view/svgPath";
import { formatMm } from "../view/format";
import { snapMove, snapPoint } from "./snap";

const SNAP_PX = 10;
const DIMENSION_OFFSET = 10;

type Drag =
  | { kind: "pan"; last: Point; start: Point; clearOnClick: boolean }
  | { kind: "move"; ids: EntityId[]; primary: EntityId; origin: Point; applied: Point; moved: boolean }
  | { kind: "resize"; id: EntityId; spot: HandleSpot; moved: boolean }
  | { kind: "draw"; tool: Exclude<Tool, "select">; start: Point; current: Point };

export function Canvas() {
  useDocument();
  const resolved = store.resolved;
  const { editor, dispatch } = useEditor();
  const { view, tool, selection } = editor;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [size, setSize] = useState<[number, number]>([800, 600]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(e)) { spaceRef.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const screenPoint = (e: RPointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const tolerance = SNAP_PX / view.scale;
  const grid = gridPitch(view);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const sp = screenPoint(e);
    if (e.button === 1 || spaceRef.current) { dragRef.current = { kind: "pan", last: sp, start: sp, clearOnClick: false }; return; }

    const mp = toModel(view, sp);
    if (tool === "select") {
      const handleIndex = (e.target as Element).closest<SVGElement>("[data-handle]")?.dataset.handle;
      if (handleIndex !== undefined && selection.length === 1) {
        const shape = resolved.shapes[selection[0]!];
        const spot = shape && handlesFor(shape)[Number(handleIndex)];
        if (spot) { dragRef.current = { kind: "resize", id: shape.id, spot, moved: false }; return; }
      }
      const hit = (e.target as Element).closest<SVGElement>("[data-id]")?.dataset.id;
      // Dragging the background pans; a plain click on it clears the selection.
      if (!hit) { dragRef.current = { kind: "pan", last: sp, start: sp, clearOnClick: !e.shiftKey }; return; }
      if (e.shiftKey) { dispatch({ type: "toggleSelect", id: hit }); return; }
      const ids = selection.includes(hit) ? selection : [hit];
      if (!selection.includes(hit)) dispatch({ type: "select", ids });
      dragRef.current = { kind: "move", ids, primary: hit, origin: mp, applied: [0, 0], moved: false };
      return;
    }
    const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid);
    dragRef.current = { kind: "draw", tool, start: point, current: point };
    dispatch({ type: "pointer", cursor: point, snap });
    setPreview(dragRef.current);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const sp = screenPoint(e);
    const mp = toModel(view, sp);
    const d = dragRef.current;
    if (!d) {
      const exclude = new Set<EntityId>();
      const { point, snap } = tool === "select" ? { point: mp, snap: null } : snapPoint(resolved, mp, tolerance, exclude, grid);
      dispatch({ type: "pointer", cursor: point, snap });
      return;
    }
    switch (d.kind) {
      case "pan":
        dispatch({ type: "panBy", dx: sp[0] - d.last[0], dy: sp[1] - d.last[1] });
        d.last = sp;
        return;
      case "move": {
        const raw: Point = [mp[0] - d.origin[0], mp[1] - d.origin[1]];
        const moving = new Set(d.ids);
        const { delta, snap } = snapMove(store.resolved, d.primary, raw, tolerance, moving, grid);
        const step: Point = [delta[0] - d.applied[0], delta[1] - d.applied[1]];
        if (step[0] !== 0 || step[1] !== 0) {
          if (!d.moved) { store.beginGesture(); d.moved = true; }
          for (const id of d.ids) {
            const c = moveBy(store.state, id, step[0], step[1], { start: d.applied[0] === 0 && d.applied[1] === 0 });
            if (c) store.commit(c);
          }
          d.applied = delta;
        }
        dispatch({ type: "pointer", cursor: mp, snap });
        return;
      }
      case "resize": {
        const { point, snap } = snapPoint(store.resolved, mp, tolerance, new Set([d.id]), grid);
        const change = resizeTo(store.state, d.id, d.spot.handle, point, d.spot.anchor);
        if (change) {
          if (!d.moved) { store.beginGesture(); d.moved = true; }
          store.commit(change);
        }
        dispatch({ type: "pointer", cursor: point, snap });
        return;
      }
      case "draw": {
        const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid);
        d.current = constrain(d, point, e.shiftKey);
        dispatch({ type: "pointer", cursor: d.current, snap });
        setPreview({ ...d });
        return;
      }
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setPreview(null);
    if (!d) return;
    if (d.kind === "pan" && d.clearOnClick) {
      const sp = screenPoint(e);
      if (Math.hypot(sp[0] - d.start[0], sp[1] - d.start[1]) < 3) dispatch({ type: "select", ids: [] });
    }
    if (d.kind === "move" && d.moved) {
      for (const id of d.ids) { const c = moveBy(store.state, id, 0, 0, { end: true }); if (c) store.commit(c); }
      store.endGesture();
    }
    if (d.kind === "resize" && d.moved) store.endGesture();
    if (d.kind === "draw") {
      const id = createShape(d);
      if (id) dispatch({ type: "select", ids: [id] });
      if (!e.shiftKey) dispatch({ type: "tool", tool: "select" });
    }
  };

  const onWheel = useCallback((e: RWheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const at: Point = [e.clientX - r.left, e.clientY - r.top];
    // Wheel and trackpad pinch both zoom, as in SynFlo. A pinch arrives as a
    // ctrl-wheel with small deltas, so it gets a higher gain than wheel notches.
    const gain = e.ctrlKey ? 0.01 : 0.002;
    dispatch({ type: "zoomAt", factor: Math.exp(-e.deltaY * gain), at });
  }, [dispatch]);

  // React's onWheel is passive; preventDefault needs a native listener.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, []);

  const fontSize = 12 / view.scale;
  const hair = 1 / view.scale;

  return (
    <svg
      ref={svgRef}
      className={`canvas tool-${tool}${dragRef.current?.kind === "pan" ? " panning" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { if (!dragRef.current) dispatch({ type: "pointer", cursor: null, snap: null }); }}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Grid view={view} size={size} />
      <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {resolved.order.map((id) => (
          <ShapeView key={id} shape={resolved.shapes[id]!} selected={selection.includes(id)} hair={hair} />
        ))}
        {resolved.dimensions.map((d) => <DimensionView key={d.id} dim={d} fontSize={fontSize} hair={hair} />)}
        {resolved.radiusLabels.map((l) => <RadiusLabelView key={l.id} label={l} fontSize={fontSize} />)}
        {preview?.kind === "draw" && <DrawPreview d={preview} hair={hair} />}
      </g>
      {tool === "select" && selection.length === 1 && resolved.shapes[selection[0]!] && (
        <Handles shape={resolved.shapes[selection[0]!]!} view={view} />
      )}
      {editor.snap && <SnapMarker snap={editor.snap} view={view} />}
    </svg>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/** Shift constrains: squares/circles stay as they are; lines snap to 45°. */
function constrain(d: Extract<Drag, { kind: "draw" }>, p: Point, shift: boolean): Point {
  if (!shift) return p;
  const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
  if (d.tool === "rect") {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return [d.start[0] + Math.sign(dx) * s, d.start[1] + Math.sign(dy) * s];
  }
  if (d.tool === "line") {
    const len = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return [snapNumber(d.start[0] + len * Math.cos(a)), snapNumber(d.start[1] + len * Math.sin(a))];
  }
  return p;
}

/** Commit the drawn shape with its standard dimension. Returns the new ID. */
function createShape(d: Extract<Drag, { kind: "draw" }>): EntityId | undefined {
  const [x0, y0] = d.start, [x1, y1] = d.current;
  const id = newId(d.tool);
  switch (d.tool) {
    case "rect": {
      const w = snapNumber(Math.abs(x1 - x0)), h = snapNumber(Math.abs(y1 - y0));
      if (w === 0 || h === 0) return undefined;
      store.commit(batch([
        addRect(id, { x: Math.min(x0, x1), y: Math.min(y0, y1), width: w, height: h }),
        addDimension(newId("dim"), id, "width", DIMENSION_OFFSET),
        addDimension(newId("dim"), id, "height", DIMENSION_OFFSET),
      ]));
      return id;
    }
    case "circle": {
      const r = snapNumber(Math.hypot(x1 - x0, y1 - y0));
      if (r === 0) return undefined;
      store.commit(batch([
        addCircle(id, { cx: x0, cy: y0, diameter: snapNumber(r * 2) }),
        addDimension(newId("dim"), id, "diameter", DIMENSION_OFFSET),
      ]));
      return id;
    }
    case "line": {
      const length = snapNumber(Math.hypot(x1 - x0, y1 - y0));
      if (length === 0) return undefined;
      const angle = snapNumber((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
      store.commit(batch([
        addLine(id, { x: x0, y: y0, length, angle }),
        addDimension(newId("dim"), id, "length", DIMENSION_OFFSET),
      ]));
      return id;
    }
  }
}

// ---- Sub-views ----

function ShapeView({ shape, selected, hair }: { shape: ResolvedShape; selected: boolean; hair: number }) {
  const d = pathToSvg(shape.path);
  return (
    <g data-id={shape.id} className={selected ? "shape selected" : "shape"}>
      <path d={d} className="hit" strokeWidth={hair * 12} stroke="transparent" />
      <path d={d} className="stroke" strokeWidth={hair * (selected ? 2 : 1.2)} />
    </g>
  );
}

function DimensionView({ dim, fontSize, hair }: { dim: ResolvedDimension; fontSize: number; hair: number }) {
  const { line, anchors } = dim;
  const [ax, ay] = line.from, [bx, by] = line.to;
  const mid: Point = [(ax + bx) / 2, (ay + by) / 2];
  const vertical = Math.abs(bx - ax) < Math.abs(by - ay);
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const textAngle = vertical ? angle + 180 : angle;   // read bottom-to-top on the left side
  const tick = hair * 4;
  return (
    <g className="dimension" strokeWidth={hair * 0.8}>
      <line x1={anchors[0][0]} y1={anchors[0][1]} x2={ax} y2={ay} />
      <line x1={anchors[1][0]} y1={anchors[1][1]} x2={bx} y2={by} />
      <line x1={ax} y1={ay} x2={bx} y2={by} />
      <g transform={`rotate(${angle} ${ax} ${ay})`}><line x1={ax} y1={ay - tick} x2={ax} y2={ay + tick} /></g>
      <g transform={`rotate(${angle} ${bx} ${by})`}><line x1={bx} y1={by - tick} x2={bx} y2={by + tick} /></g>
      <text
        x={mid[0]} y={mid[1]}
        fontSize={fontSize}
        textAnchor="middle"
        dy={-fontSize * 0.3}
        transform={`rotate(${textAngle} ${mid[0]} ${mid[1]})`}
      >
        {formatMm(dim.value)}
      </text>
    </g>
  );
}

function RadiusLabelView({ label, fontSize }: { label: ResolvedRadiusLabel; fontSize: number }) {
  return (
    <text className="radius-label" x={label.at[0]} y={label.at[1]} fontSize={fontSize} dy={-fontSize * 0.4}>
      R{formatMm(label.radius)}
    </text>
  );
}

function DrawPreview({ d, hair }: { d: Extract<Drag, { kind: "draw" }>; hair: number }) {
  const [x0, y0] = d.start, [x1, y1] = d.current;
  const props = { className: "preview", strokeWidth: hair * 1.2 };
  switch (d.tool) {
    case "rect":
      return <rect {...props} x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} />;
    case "circle":
      return <circle {...props} cx={x0} cy={y0} r={Math.hypot(x1 - x0, y1 - y0)} />;
    case "line":
      return <line {...props} x1={x0} y1={y0} x2={x1} y2={y1} />;
  }
}

/** Resize handles in screen space, so they stay the same size at any zoom. */
function Handles({ shape, view }: { shape: ResolvedShape; view: View }) {
  return (
    <g className="handles">
      {handlesFor(shape).map((spot, i) => {
        const [x, y] = toScreen(view, spot.point);
        const round = spot.handle.kind === "circle-centre" || spot.handle.kind === "line-end";
        return round
          ? <circle key={i} data-handle={i} className="handle" cx={x} cy={y} r={5} style={{ cursor: spot.cursor }} />
          : <rect key={i} data-handle={i} className="handle" x={x - 5} y={y - 5} width={10} height={10} style={{ cursor: spot.cursor }} />;
      })}
    </g>
  );
}

function SnapMarker({ snap, view }: { snap: SnapPoint; view: View }) {
  const [x, y] = toScreen(view, snap.point);
  return (
    <g className={`snap snap-${snap.type}`} transform={`translate(${x} ${y})`}>
      {snap.type === "centre" || snap.type === "quadrant"
        ? <circle r={5} />
        : <rect x={-5} y={-5} width={10} height={10} />}
    </g>
  );
}

function Grid({ view, size }: { view: View; size: [number, number] }) {
  const pitch = gridPitch(view);
  const [w, h] = size;
  const [mx0, my0] = toModel(view, [0, 0]);
  const [mx1, my1] = toModel(view, [w, h]);
  const lines: React.ReactNode[] = [];
  const major = pitch * 10;
  for (let x = Math.floor(mx0 / pitch) * pitch; x <= mx1; x += pitch) {
    const sx = toScreen(view, [x, 0])[0];
    lines.push(<line key={`x${x}`} x1={sx} y1={0} x2={sx} y2={h} className={isMajor(x, major) ? "grid-major" : "grid-minor"} />);
  }
  for (let y = Math.floor(my0 / pitch) * pitch; y <= my1; y += pitch) {
    const sy = toScreen(view, [0, y])[1];
    lines.push(<line key={`y${y}`} x1={0} y1={sy} x2={w} y2={sy} className={isMajor(y, major) ? "grid-major" : "grid-minor"} />);
  }
  const [ox, oy] = toScreen(view, [0, 0]);
  return (
    <g className="grid">
      {lines}
      <line x1={ox} y1={0} x2={ox} y2={h} className="grid-axis" />
      <line x1={0} y1={oy} x2={w} y2={oy} className="grid-axis" />
    </g>
  );
}

function isMajor(v: number, major: number): boolean {
  return Math.abs(v / major - Math.round(v / major)) < 1e-9;
}

export { formatMm } from "../view/format";
