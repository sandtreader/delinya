// The drawing surface: an SVG with a model-space layer. Reads the resolved
// geometry, writes only through the store. Tools are a small pointer state
// machine kept in a ref so pointer moves don't re-render.

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import {
  KINDS, addCircle, addDimension, addLine, addRect, batch, derivedAxes, dragHandle, entityAs, freeDelta, handlesFor, isRef, isVisible, linkLocks,
  moveBy, newId, snapNumber,
  type EntityId, type HandleSpot, type LinkLocks, type LinkTarget, type Point, type ResolvedDimension, type ResolvedRadiusLabel, type ResolvedShape, type SnapPoint,
} from "../model";
import { store, useDocument } from "../app/store";
import { currentLayer, hoverShowsPosition, useEditor, type Tool } from "../app/editor";
import { gridPitch, toModel, toScreen, type View } from "../view/viewport";
import { pathToSvg } from "../view/svgPath";
import { formatMm } from "../view/format";
import { snapMove, snapPoint } from "./snap";
import { lassoMode, lassoSelect } from "./lasso";
import { GUIDE_OVERHANG_PX, linkGuides, type LinkGuide } from "../view/linkGuides";

const SNAP_PX = 10;
const DIMENSION_OFFSET = 10;
/** A press that moves less than this (screen px) is a click, not a drag. */
const CLICK_PX = 3;

type Drag =
  | { kind: "pan"; last: Point; start: Point; clearOnClick: boolean }
  // `start`/`current` in model mm, so the anchor stays put if the view moves;
  // `at` is the press in screen px, for telling a click from a drag.
  // `base`: kept and added to (Shift); `prior`: restored by Escape; `last`: last dispatched.
  | { kind: "lasso"; at: Point; start: Point; current: Point; moved: boolean; shift: boolean; base: EntityId[]; prior: EntityId[]; last: EntityId[] }
  | { kind: "move"; ids: EntityId[]; primary: EntityId; origin: Point; applied: Point; moved: boolean }
  | { kind: "resize"; id: EntityId; spot: HandleSpot; locks: LinkLocks; moved: boolean }
  | { kind: "draw"; tool: Exclude<Tool, "select">; layer: EntityId; start: Point; current: Point };

export function Canvas() {
  useDocument();
  const resolved = store.resolved;
  const { editor, dispatch } = useEditor();
  const { view, tool, selection, layerView } = editor;
  const hiddenLayers = layerView.hidden;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  // Mirrors spaceRef for the grab cursor; the ref is what pointer handlers read.
  const [spaceHeld, setSpaceHeld] = useState(false);
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
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(e)) { spaceRef.current = true; setSpaceHeld(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") { spaceRef.current = false; setSpaceHeld(false); } };
    // A keyup while another window has focus never arrives.
    const blur = () => { spaceRef.current = false; setSpaceHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  // Escape during a lasso cancels it and puts the selection back. Capture,
  // so the app's Escape (back to select, clear selection) doesn't also run.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      const d = dragRef.current;
      if (e.key !== "Escape" || d?.kind !== "lasso") return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      setPreview(null);
      dispatch({ type: "select", ids: d.prior });
      dispatch({ type: "pointer", cursor: null, snap: null });   // hovering with select shows none
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [dispatch]);

  const screenPoint = (e: RPointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const tolerance = SNAP_PX / view.scale;
  // The drawing's spacing, coarsened when zoomed out; snapping uses what's drawn.
  // Grid snap off (this viewer's choice) leaves only shapes' snap points.
  const pitch = gridPitch(view, resolved.document.gridSpacing);
  const grid = editor.grid.snap ? pitch : null;

  // New shapes go on the current layer; one this viewer has hidden or locked takes none.
  const layerId = currentLayer(resolved, editor.layer);
  const blocked = tool !== "select" && (hiddenLayers.has(layerId) || layerView.locked.has(layerId));

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
        // Links hold some points of the shape still; the handles know which.
        const locks = shape ? linkLocks(resolved, shape.id) : {};
        const spot = shape && handlesFor(shape, locks)[Number(handleIndex)];
        if (spot) {
          // A handle that can't move at all starts nothing (and doesn't fall through to a move).
          if (spot.cursor !== "not-allowed") dragRef.current = { kind: "resize", id: shape.id, spot, locks, moved: false };
          return;
        }
      }
      const target = linkTargetAt(e.target as Element);
      if (target) { dispatch({ type: "linkPopup", popup: { target, at: sp } }); return; }
      if (editor.linkPopup) dispatch({ type: "linkPopup", popup: null });
      const hit = (e.target as Element).closest<SVGElement>("[data-id]")?.dataset.id;
      // Dragging the background lassoes with a mouse or pen (Shift adds to the
      // selection) and pans with a finger; a plain click on it clears the selection.
      if (!hit) {
        if (lassoMode(e.pointerType) === "pan") { dragRef.current = { kind: "pan", last: sp, start: sp, clearOnClick: !e.shiftKey }; return; }
        const base = e.shiftKey ? selection : [];
        dragRef.current = { kind: "lasso", at: sp, start: mp, current: mp, moved: false, shift: e.shiftKey, base, prior: selection, last: selection };
        return;
      }
      if (e.shiftKey) { dispatch({ type: "toggleSelect", id: hit }); return; }
      const ids = selection.includes(hit) ? selection : [hit];
      if (!selection.includes(hit)) dispatch({ type: "select", ids });
      dragRef.current = { kind: "move", ids, primary: hit, origin: mp, applied: [0, 0], moved: false };
      return;
    }
    if (blocked) return;
    const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid, hiddenLayers);
    dragRef.current = { kind: "draw", tool, layer: layerId, start: point, current: point };
    dispatch({ type: "pointer", cursor: point, snap, draw: { tool, start: point } });
    setPreview(dragRef.current);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const sp = screenPoint(e);
    const mp = toModel(view, sp);
    const d = dragRef.current;
    if (!d) {
      // Hovering with select shows no position; a drag below does.
      if (!hoverShowsPosition(tool)) { dispatch({ type: "pointer", cursor: null, snap: null }); return; }
      const { point, snap } = blocked ? { point: mp, snap: null } : snapPoint(resolved, mp, tolerance, new Set(), grid, hiddenLayers);
      dispatch({ type: "pointer", cursor: point, snap });
      return;
    }
    switch (d.kind) {
      case "pan":
        dispatch({ type: "panBy", dx: sp[0] - d.last[0], dy: sp[1] - d.last[1] });
        d.last = sp;
        return;
      case "lasso": {
        dispatch({ type: "pointer", cursor: mp, snap: null });
        if (!d.moved && Math.hypot(sp[0] - d.at[0], sp[1] - d.at[1]) < CLICK_PX) return;
        d.moved = true;
        d.current = mp;
        // Live: the selection (and so the panel and handles) follows the rectangle.
        const inside = lassoSelect(store.resolved, d.start, mp, layerView);
        const ids = [...d.base, ...inside.filter((id) => !d.base.includes(id))];
        if (!sameIds(ids, d.last)) { d.last = ids; dispatch({ type: "select", ids }); }
        setPreview({ ...d });
        return;
      }
      case "move": {
        const raw: Point = [mp[0] - d.origin[0], mp[1] - d.origin[1]];
        const moving = new Set(d.ids);
        const { delta, snap } = snapMove(store.resolved, d.primary, raw, tolerance, moving, grid, hiddenLayers);
        const step: Point = [delta[0] - d.applied[0], delta[1] - d.applied[1]];
        // A link owns some shapes' position on an axis: those don't move that way.
        // A shape locked both ways doesn't move at all, so it makes no edit or undo step.
        const moves = d.ids
          .map((id) => [id, freeDelta(store.resolved, id, step)] as const)
          .filter(([, [dx, dy]]) => dx !== 0 || dy !== 0);
        if (moves.length > 0) {
          if (!d.moved) { store.beginGesture(); d.moved = true; }
          for (const [id, [dx, dy]] of moves) {
            const c = moveBy(store.state, id, dx, dy, { start: d.applied[0] === 0 && d.applied[1] === 0 });
            if (c) store.commit(c);
          }
        }
        d.applied = delta;
        dispatch({ type: "pointer", cursor: mp, snap });
        return;
      }
      case "resize": {
        const { point, snap } = snapPoint(store.resolved, mp, tolerance, new Set([d.id]), grid, hiddenLayers);
        const change = dragHandle(store.state, d.id, d.spot, point, d.locks);
        if (change) {
          if (!d.moved) { store.beginGesture(); d.moved = true; }
          store.commit(change);
        }
        dispatch({ type: "pointer", cursor: point, snap });
        return;
      }
      case "draw": {
        const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid, hiddenLayers);
        d.current = constrain(d, point, e.shiftKey);
        dispatch({ type: "pointer", cursor: d.current, snap, draw: { tool: d.tool, start: d.start } });
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
      if (Math.hypot(sp[0] - d.start[0], sp[1] - d.start[1]) < CLICK_PX) dispatch({ type: "select", ids: [] });
    }
    // A lasso that never got going was a click; it has already set the selection otherwise.
    if (d.kind === "lasso" && !d.moved && !d.shift) dispatch({ type: "select", ids: [] });
    if (d.kind === "move" && d.moved) {
      for (const id of d.ids) { const c = moveBy(store.state, id, 0, 0, { end: true }); if (c) store.commit(c); }
      store.endGesture();
    }
    if (d.kind === "resize" && d.moved) store.endGesture();
    // The drag is over: back to what hovering shows (nothing, with select).
    if (d.kind !== "draw" && !hoverShowsPosition(tool)) dispatch({ type: "pointer", cursor: null, snap: null });
    if (d.kind === "draw") {
      // Back to the plain pointer position in the status bar (cleared if this returns to select).
      dispatch({ type: "pointer", cursor: d.current, snap: null });
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
  const guides = linkGuides(store.state, resolved, selection, GUIDE_OVERHANG_PX * hair, hiddenLayers);
  const varName = linkedNames(selection);
  const shown = (id: EntityId) => isVisible(resolved, id, hiddenLayers);

  return (
    <svg
      ref={svgRef}
      className={`canvas tool-${tool}${blocked ? " blocked" : ""}${spaceHeld ? " space" : ""}${dragRef.current?.kind === "pan" ? " panning" : ""}${preview?.kind === "lasso" ? " lassoing" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { if (!dragRef.current) dispatch({ type: "pointer", cursor: null, snap: null }); }}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Grid view={view} size={size} pitch={pitch} show={editor.grid.visible} />
      <g transform={`translate(${view.ox} ${view.oy}) scale(${view.scale})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Behind the shapes: live links, screen only. */}
        {guides.map((g) => <LinkGuideView key={g.link} guide={g} fontSize={fontSize} hair={hair} />)}
        {/* Back layer first; hidden layers not at all; locked ones drawn but not hit-testable. */}
        {resolved.order.filter(shown).map((id) => {
          const shape = resolved.shapes[id]!;
          return (
            <ShapeView
              key={id} shape={shape} hair={hair}
              selected={selection.includes(id)}
              reference={selection.length > 1 && selection[0] === id}
              locked={derivedAxes(resolved, id)}
              inert={layerView.locked.has(shape.layer)}
            />
          );
        })}
        {resolved.dimensions.filter((d) => shown(d.target)).map((d) => <DimensionView key={d.id} dim={d} fontSize={fontSize} hair={hair} link={varName(d.target, d.prop)} />)}
        {resolved.radiusLabels.filter((l) => shown(l.target)).map((l) => <RadiusLabelView key={l.id} label={l} fontSize={fontSize} link={varName(l.target, "r", l.corner)} />)}
        {preview?.kind === "draw" && <DrawPreview d={preview} hair={hair} />}
      </g>
      {tool === "select" && selection.length === 1 && resolved.shapes[selection[0]!] && (
        <Handles shape={resolved.shapes[selection[0]!]!} view={view} />
      )}
      {editor.snap && <SnapMarker snap={editor.snap} view={view} />}
      {preview?.kind === "lasso" && <LassoView d={preview} view={view} />}
    </svg>
  );
}

/** The link under the pointer: a guide, or a "= name" on a label. */
function linkTargetAt(el: Element): LinkTarget | undefined {
  const link = el.closest<SVGElement>("[data-link]")?.dataset.link;
  if (link) return { kind: "link", id: link };
  const v = el.closest<SVGElement>("[data-value-shape]")?.dataset;
  if (!v?.valueShape || !v.valueProp) return undefined;
  const corner = v.valueCorner === undefined ? undefined : (Number(v.valueCorner) as 0 | 1 | 2 | 3);
  return { kind: "value", shape: v.valueShape, prop: v.valueProp, ...(corner === undefined ? {} : { corner }) };
}

function sameIds(a: EntityId[], b: EntityId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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

/** Commit the drawn shape, on its layer, with its standard dimension. Returns the new ID. */
function createShape(d: Extract<Drag, { kind: "draw" }>): EntityId | undefined {
  const [x0, y0] = d.start, [x1, y1] = d.current, { layer } = d;
  const id = newId(d.tool);
  switch (d.tool) {
    case "rect": {
      const w = snapNumber(Math.abs(x1 - x0)), h = snapNumber(Math.abs(y1 - y0));
      if (w === 0 || h === 0) return undefined;
      store.commit(batch([
        addRect(id, { x: Math.min(x0, x1), y: Math.min(y0, y1), width: w, height: h, layer }),
        addDimension(newId("dim"), id, "width", DIMENSION_OFFSET),
        addDimension(newId("dim"), id, "height", DIMENSION_OFFSET),
      ]));
      return id;
    }
    case "circle": {
      const r = snapNumber(Math.hypot(x1 - x0, y1 - y0));
      if (r === 0) return undefined;
      store.commit(batch([
        addCircle(id, { cx: x0, cy: y0, diameter: snapNumber(r * 2), layer }),
        addDimension(newId("dim"), id, "diameter", DIMENSION_OFFSET),
      ]));
      return id;
    }
    case "line": {
      const length = snapNumber(Math.hypot(x1 - x0, y1 - y0));
      if (length === 0) return undefined;
      const angle = snapNumber((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
      store.commit(batch([
        addLine(id, { x: x0, y: y0, length, angle, layer }),
        addDimension(newId("dim"), id, "length", DIMENSION_OFFSET),
      ]));
      return id;
    }
  }
}

// ---- Sub-views ----

/**
 * `reference`: first of a multi-selection, the one others align to; it gets a halo.
 * `locked`: axes a link controls, so the cursor says which way it can still be dragged.
 * `inert`: on a locked layer, so clicks go through it and it never highlights.
 */
function ShapeView({ shape, selected, reference, locked, inert, hair }: { shape: ResolvedShape; selected: boolean; reference: boolean; locked: ReadonlySet<string>; inert: boolean; hair: number }) {
  const d = pathToSvg(shape.path);
  if (inert) return <path d={d} className="shape inert" strokeWidth={hair * 1.2} />;
  const lock = locked.size === 2 ? " locked" : locked.has("x") ? " locked-x" : locked.has("y") ? " locked-y" : "";
  return (
    <g data-id={shape.id} className={`shape${selected ? " selected" : ""}${lock}`}>
      {reference && <path d={d} className="ref-halo" strokeWidth={hair * 7} />}
      <path d={d} className="hit" strokeWidth={hair * 12} stroke="transparent" />
      <path d={d} className="stroke" strokeWidth={hair * (selected ? 2 : 1.2)} />
    </g>
  );
}

interface LinkName { name: string; emphasis: boolean; shape: EntityId; prop: string; corner?: number }

/** " = name" after a label whose value is a linked length; on screen only. */
function LinkNameSpan({ link }: { link?: LinkName }) {
  if (!link) return null;
  return (
    <tspan
      className={link.emphasis ? "link-name emphasis" : "link-name"}
      data-value-shape={link.shape} data-value-prop={link.prop} data-value-corner={link.corner}
    >
      {" "}= {link.name}
    </tspan>
  );
}

/**
 * Looks up the variable behind a length prop (or one corner radius), with
 * emphasis when a selected shape shares that variable.
 */
function linkedNames(selection: EntityId[]): (id: EntityId, prop: string, corner?: number) => LinkName | undefined {
  const state = store.state;
  const shared = new Set<EntityId>();
  for (const id of selection) {
    for (const v of Object.values(state.entities[id]?.props ?? {})) {
      for (const x of Array.isArray(v) ? v : [v]) if (isRef(x)) shared.add(x.ref);
    }
  }
  return (id, prop, corner) => {
    const v = state.entities[id]?.props[prop];
    const raw = corner === undefined ? v : Array.isArray(v) ? v[corner] : undefined;
    if (!isRef(raw)) return undefined;
    return { name: entityAs(state, raw.ref, KINDS.variable)?.name ?? raw.ref, emphasis: shared.has(raw.ref), shape: id, prop, corner };
  };
}

/** A live link: dashed guides, "=" across equal spacings. Faint unless it touches the selection. */
function LinkGuideView({ guide, fontSize, hair }: { guide: LinkGuide; fontSize: number; hair: number }) {
  const cls = `link-guide${guide.emphasis ? " emphasis" : ""}${guide.broken ? " broken" : ""}`;
  return (
    <g className={cls}>
      <path d={pathToSvg(guide.path)} className="link-hit" data-link={guide.link} strokeWidth={hair * 10} stroke="transparent" />
      <path d={pathToSvg(guide.path)} strokeWidth={hair * (guide.emphasis ? 1.5 : 1)} strokeDasharray={`${5 * hair} ${3 * hair}`} />
      {guide.marks.map((m, i) => {
        // Beside the segment it marks: above a horizontal one, right of a vertical one.
        const s = guide.path[i];
        const vertical = s && Math.abs(s.to[0] - s.from[0]) < Math.abs(s.to[1] - s.from[1]);
        return vertical
          ? <text key={i} x={m[0] + fontSize * 0.4} y={m[1]} fontSize={fontSize} dominantBaseline="middle">=</text>
          : <text key={i} x={m[0]} y={m[1] - fontSize * 0.35} fontSize={fontSize} textAnchor="middle">=</text>;
      })}
    </g>
  );
}

function DimensionView({ dim, fontSize, hair, link }: { dim: ResolvedDimension; fontSize: number; hair: number; link?: LinkName }) {
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
        {formatMm(dim.value)}<LinkNameSpan link={link} />
      </text>
    </g>
  );
}

function RadiusLabelView({ label, fontSize, link }: { label: ResolvedRadiusLabel; fontSize: number; link?: LinkName }) {
  return (
    <text className="radius-label" x={label.at[0]} y={label.at[1]} fontSize={fontSize} dy={-fontSize * 0.4}>
      R{formatMm(label.radius)}<LinkNameSpan link={link} />
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

/** The lasso rectangle, in screen space so its dashes stay the same at any zoom. */
function LassoView({ d, view }: { d: Extract<Drag, { kind: "lasso" }>; view: View }) {
  const [x0, y0] = toScreen(view, d.start), [x1, y1] = toScreen(view, d.current);
  return <rect className="lasso" x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} />;
}

/** Resize handles in screen space, so they stay the same size at any zoom. */
function Handles({ shape, view }: { shape: ResolvedShape; view: View }) {
  const { resolved } = store;
  return (
    <g className="handles">
      {handlesFor(shape, linkLocks(resolved, shape.id)).map((spot, i) => {
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

/**
 * Grid lines every `pitch` mm, every tenth one darker, when `show` (this
 * viewer may hide them). The origin axes are drawn either way.
 */
function Grid({ view, size, pitch, show }: { view: View; size: [number, number]; pitch: number; show: boolean }) {
  const [w, h] = size;
  const [mx0, my0] = toModel(view, [0, 0]);
  const [mx1, my1] = toModel(view, [w, h]);
  const lines: React.ReactNode[] = [];
  // Count lines rather than adding up pitches, so a pitch like 0.1 doesn't drift.
  const cls = (i: number) => (i % 10 === 0 ? "grid-major" : "grid-minor");
  if (show) {
    for (let i = Math.floor(mx0 / pitch); i * pitch <= mx1; i++) {
      const sx = toScreen(view, [i * pitch, 0])[0];
      lines.push(<line key={`x${i}`} x1={sx} y1={0} x2={sx} y2={h} className={cls(i)} />);
    }
    for (let i = Math.floor(my0 / pitch); i * pitch <= my1; i++) {
      const sy = toScreen(view, [0, i * pitch])[1];
      lines.push(<line key={`y${i}`} x1={0} y1={sy} x2={w} y2={sy} className={cls(i)} />);
    }
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

export { formatMm } from "../view/format";
