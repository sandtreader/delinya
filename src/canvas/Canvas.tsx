// The drawing surface: an SVG with a model-space layer. Reads the resolved
// geometry, writes only through the store. Tools are a small pointer state
// machine kept in a ref so pointer moves don't re-render.
//
// The Path tool draws by clicks rather than a drag: the nodes so far are a
// draft (polyDraft.ts), committed as one addPolyline when it is finished
// (Enter, Escape, double-click, clicking the start to close, or switching
// tool). With the select tool, one selected path shows its nodes, which
// drag and select, and a click on it selects the segment there, which then
// bends when dragged (polyEdit.ts hit-tests them).

import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent,
} from "react";
import {
  KINDS, addCircle, addDimension, addLine, addPolyline, batch, addRect, bendPolySegment, derivedAxes, distance, dragHandle, drawnOffset, entityAs,
  freeDelta, handlesFor, insertPolyNode, isRef, isVisible, linkLocks, moveBy, movePolyNode, newId, setPolyHandle, snapNumber,
  type EntityId, type HandleSpot, type LinkLocks, type LinkTarget, type Point, type PolyNodeType, type ResolvedDimension, type ResolvedPolyline,
  type ResolvedRadiusLabel, type ResolvedShape, type SnapPoint,
} from "../model";
import { store, useDocument } from "../app/store";
import { currentLayer, hoverShowsPosition, selectedPathNode, selectedPathSegment, useEditor } from "../app/editor";
import { currentQuestion } from "../app/ask";
import { gridPitch, toModel, toScreen, wheelZoom, type View } from "../view/viewport";
import { pathToSvg } from "../view/svgPath";
import { formatMm, type DrawTool } from "../view/format";
import { snapMove, snapPoint } from "./snap";
import { lassoMode, lassoSelect } from "./lasso";
import { setHover } from "./hover";
import { draftAdd, draftCloses, draftFinish, draftPreview, draftShape, draftUndo, type PolyDraft } from "./polyDraft";
import { nodeAt, nodeHandles, ownNodeSnaps, segmentAt, segmentHandles } from "./polyEdit";
import { GUIDE_OVERHANG_PX, linkGuides, type LinkGuide } from "../view/linkGuides";

const SNAP_PX = 10;
const DIMENSION_OFFSET = 10;
/** A press that moves less than this (screen px) is a click, not a drag. */
const CLICK_PX = 3;
/** Reach (screen px) of a path's node and of a selected node's handle; they are drawn a little smaller. */
const NODE_PX = 7;
const NODE_HANDLE_PX = 6;
/** Reach of a path's segment for a click or double-click: half the shape's hit stroke. */
const SEGMENT_PX = 6;
/** A path click this close (screen px) to the last node adds none: the second click of a double-click. */
const SAME_NODE_PX = 4;

/** A path being drawn, and the layer it will go on (the current one when it was started). */
type Draft = PolyDraft & { layer: EntityId };

// Set while a Canvas is mounted: drops its path draft (see discardPathDraft).
let discardDraft: (() => void) | null = null;

/**
 * Drop a path being drawn, without drawing it: for New and Open, so a draft
 * isn't finished into the drawing that replaced the one it was drawn on.
 */
export function discardPathDraft(): void {
  discardDraft?.();
}

type Drag =
  | { kind: "pan"; last: Point; start: Point; clearOnClick: boolean }
  // `start`/`current` in model mm, so the anchor stays put if the view moves;
  // `at` is the press in screen px, for telling a click from a drag.
  // `base`: kept and added to (Shift); `prior`: restored by Escape; `last`: last dispatched.
  | { kind: "lasso"; at: Point; start: Point; current: Point; moved: boolean; shift: boolean; base: EntityId[]; prior: EntityId[]; last: EntityId[] }
  // `segment`: the segment pressed on, if the path was already selected alone, so a click selects it.
  | { kind: "move"; ids: EntityId[]; primary: EntityId; origin: Point; applied: Point; moved: boolean; segment: number | null }
  | { kind: "resize"; id: EntityId; spot: HandleSpot; locks: LinkLocks; moved: boolean }
  | { kind: "draw"; tool: Exclude<DrawTool, "polyline">; layer: EntityId; start: Point; current: Point }
  // A press with the Path tool: a click (no drag) adds a node.
  | { kind: "pathClick"; at: Point }
  // A selected path's node or handle. `offset`: how far a link draws the path
  // from its stored nodes, at the press. `gesture`: an undo step is open.
  // `independent`: Alt held at the press or since, so a smooth node's
  // handle breaks it into a corner.
  | { kind: "node"; id: EntityId; index: number; offset: Point; at: Point; moved: boolean; gesture: boolean }
  | { kind: "nodeHandle"; id: EntityId; index: number; which: "in" | "out"; at: Point; moved: boolean; gesture: boolean; independent: boolean }
  // The selected segment, grabbed at parameter t: each move bends it by its delta from `last` (model mm).
  | { kind: "bend"; id: EntityId; segment: number; t: number; last: Point; at: Point; moved: boolean; gesture: boolean };

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
  // The path being drawn: the ref is what handlers read, the state what renders.
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const setDraft = useCallback((d: Draft | null) => { draftRef.current = d; setDraftState(d); }, []);
  // Shift makes the next path node a curve, so the preview follows it.
  const [shiftHeld, setShiftHeld] = useState(false);
  // The pointer is on the draft's start: a click there closes the path.
  const [closing, setClosing] = useState(false);
  const cursorRef = useRef(editor.cursor);
  cursorRef.current = editor.cursor;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setSize([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
      if (e.code === "Space" && !isTyping(e)) { spaceRef.current = true; setSpaceHeld(true); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
      if (e.code === "Space") { spaceRef.current = false; setSpaceHeld(false); }
    };
    // A keyup while another window has focus never arrives.
    const blur = () => { spaceRef.current = false; setSpaceHeld(false); setShiftHeld(false); };
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

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const tolerance = SNAP_PX / view.scale;
  // The drawing's spacing, coarsened when zoomed out; snapping uses what's drawn.
  // Grid snap off (this viewer's choice) leaves only shapes' snap points.
  const pitch = gridPitch(view, resolved.document.gridSpacing);
  const grid = editor.grid.snap ? pitch : null;

  // Map, not object: a layer ID like "__proto__" stays data.
  const layerColours = new Map(resolved.layers.map((l) => [l.id, l.colour]));

  // New shapes go on the current layer; one this viewer has hidden or locked takes none.
  const layerId = currentLayer(resolved, editor.layer);
  const blocked = tool !== "select" && (hiddenLayers.has(layerId) || layerView.locked.has(layerId));

  // One selected path, with the select tool, shows its nodes to edit (not on a locked layer).
  const single = tool === "select" && selection.length === 1 ? resolved.shapes[selection[0]!] : undefined;
  const editPath = single?.kind === "polyline" && isVisible(resolved, single.id, hiddenLayers) && !layerView.locked.has(single.layer) ? single : undefined;
  const pathNode = selectedPathNode(resolved, editor);
  const pathSegment = selectedPathSegment(resolved, editor);
  // The handles it shows to drag: the selected node's, or those on the selected segment.
  const editHandles = !editPath ? []
    : pathNode ? nodeHandles(editPath, pathNode.node.index).map((h) => ({ node: pathNode.node.index, ...h }))
    : pathSegment ? segmentHandles(editPath, pathSegment.index) : [];

  // ---- The Path tool's draft ----

  /** Commit the draft (if it has 2 nodes) as one undo step and select it; back to select unless `keepTool`. */
  const finishDraft = useCallback((closed: boolean, keepTool: boolean) => {
    const d = draftRef.current;
    setDraft(null);
    setClosing(false);
    dispatch({ type: "pointer", cursor: null, snap: null });
    const out = d && draftFinish(d, closed);
    if (d && out) {
      const id = newId("path");
      store.commit(addPolyline(id, { nodes: out.nodes, ...(out.closed ? { closed: true } : {}), layer: d.layer }));
      dispatch({ type: "select", ids: [id] });
    }
    if (!keepTool) dispatch({ type: "tool", tool: "select" });
  }, [dispatch, setDraft]);

  useEffect(() => {
    discardDraft = () => { setDraft(null); setClosing(false); };
    return () => { discardDraft = null; };
  }, [setDraft]);

  // Switching tool mid-path finishes it, open, as drawn so far (nothing if a single node).
  useEffect(() => { if (tool !== "polyline" && draftRef.current) finishDraft(false, true); }, [tool, finishDraft]);

  // While drawing a path, Enter and Escape finish it and Backspace/Delete take
  // back the last node. Capture, so the app's own keys (back to select, delete
  // the selection) don't also run.
  const drafting = draft !== null;
  const dialogOpen = editor.dialog !== null;
  useEffect(() => {
    if (!drafting) return;
    const onKey = (e: KeyboardEvent) => {
      const d = draftRef.current;
      if (!d || dialogOpen || currentQuestion() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finishDraft(false, e.shiftKey);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        const next = draftUndo(d);
        setDraft(next && { ...next, layer: d.layer });
        setClosing(false);
        const end = next?.nodes[next.nodes.length - 1];
        dispatch({ type: "pointer", cursor: cursorRef.current, snap: null, ...(end ? { draw: { tool: "polyline", start: [end.x, end.y] } } : {}) });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drafting, dialogOpen, finishDraft, setDraft, dispatch]);

  /** Where a path click at `mp` puts its node: the draft's start if it closes there, else snapped as other tools snap. */
  const pathTarget = (mp: Point): { point: Point; snap: SnapPoint | null; closes: boolean } => {
    const d = draftRef.current;
    if (d && draftCloses(d, mp, tolerance)) {
      const start: Point = [d.nodes[0]!.x, d.nodes[0]!.y];
      return { point: start, snap: { point: start, type: "endpoint" }, closes: true };
    }
    return { ...snapPoint(store.resolved, mp, tolerance, new Set(), grid, hiddenLayers), closes: false };
  };

  /** The pointer over the canvas with the Path tool: the status bar shows the segment from the last node to it. */
  const pathHover = (mp: Point) => {
    const d = draftRef.current;
    const { point, snap, closes } = blocked ? { point: mp, snap: null, closes: false } : pathTarget(mp);
    setClosing(closes);
    const end = d?.nodes[d.nodes.length - 1];
    dispatch({ type: "pointer", cursor: point, snap, ...(end ? { draw: { tool: "polyline", start: [end.x, end.y] } } : {}) });
  };

  /** A click with the Path tool: close and finish on the start, else add a node (a curve with Shift). */
  const pathClick = (mp: Point, shift: boolean) => {
    const d = draftRef.current;
    const { point, closes } = pathTarget(mp);
    if (d && closes) { finishDraft(true, shift); return; }
    const next = draftAdd(d, point, shift, SAME_NODE_PX / view.scale);
    if (next === d) return;
    setDraft({ ...next, layer: d?.layer ?? layerId });
    dispatch({ type: "pointer", cursor: point, snap: null, draw: { tool: "polyline", start: point } });
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    // A field being edited (the node card's, a panel's) commits first: what
    // this press does may unmount it before the browser would blur it.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches("input, textarea")) active.blur();
    svgRef.current!.setPointerCapture(e.pointerId);
    const sp = screenPoint(e);
    if (e.button === 1 || spaceRef.current) { dragRef.current = { kind: "pan", last: sp, start: sp, clearOnClick: false }; return; }

    const mp = toModel(view, sp);
    if (tool === "select") {
      // A selected path's nodes, the handles it shows and its selected segment are on top of everything.
      if (editPath) {
        const handle = nearestHandle(editHandles, mp, NODE_HANDLE_PX / view.scale);
        const index = nodeAt(editPath, mp, NODE_PX / view.scale);
        const nodePoint = index === null ? undefined : editPath.nodes.find((n) => n.index === index)!.point;
        // The nearer wins; a handle lying on its node leaves the node to drag.
        if (handle && (!nodePoint || distance(handle.point, mp) < distance(nodePoint, mp))) {
          dragRef.current = { kind: "nodeHandle", id: editPath.id, index: handle.node, which: handle.which, at: sp, moved: false, gesture: false, independent: e.altKey };
          return;
        }
        if (index !== null) {
          dispatch({ type: "node", node: { shape: editPath.id, index } });
          dragRef.current = { kind: "node", id: editPath.id, index, offset: drawnOffset(store.state, editPath), at: sp, moved: false, gesture: false };
          return;
        }
        // Dragging the selected segment bends it; anywhere else on the path moves the path.
        const on = segmentAt(editPath, mp, SEGMENT_PX / view.scale);
        if (pathSegment && on?.segment === pathSegment.index) {
          dragRef.current = { kind: "bend", id: editPath.id, segment: on.segment, t: on.t, last: mp, at: sp, moved: false, gesture: false };
          return;
        }
      }
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
      const segment = editPath && hit === editPath.id ? segmentAt(editPath, mp, SEGMENT_PX / view.scale)?.segment ?? null : null;
      dragRef.current = { kind: "move", ids, primary: hit, origin: mp, applied: [0, 0], moved: false, segment };
      return;
    }
    if (blocked) return;
    if (tool === "polyline") { dragRef.current = { kind: "pathClick", at: sp }; return; }
    const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid, hiddenLayers);
    dragRef.current = { kind: "draw", tool, layer: layerId, start: point, current: point };
    dispatch({ type: "pointer", cursor: point, snap, draw: { tool, start: point } });
    setPreview(dragRef.current);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const sp = screenPoint(e);
    setHover(sp);   // the rulers' markers, in any tool
    if (e.shiftKey !== shiftHeld) setShiftHeld(e.shiftKey);   // Shift pressed or let go outside the window
    const mp = toModel(view, sp);
    const d = dragRef.current;
    if (!d) {
      // Hovering with select shows no position; a drag below does.
      if (!hoverShowsPosition(tool)) { dispatch({ type: "pointer", cursor: null, snap: null }); return; }
      if (tool === "polyline") { pathHover(mp); return; }
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
        dispatch({ type: "pointer", cursor: mp, snap, measure: d.primary });
        return;
      }
      case "resize": {
        const { point, snap } = snapPoint(store.resolved, mp, tolerance, new Set([d.id]), grid, hiddenLayers);
        const change = dragHandle(store.state, d.id, d.spot, point, d.locks);
        if (change) {
          if (!d.moved) { store.beginGesture(); d.moved = true; }
          store.commit(change);
        }
        dispatch({ type: "pointer", cursor: point, snap, measure: d.id });
        return;
      }
      case "draw": {
        const { point, snap } = snapPoint(resolved, mp, tolerance, new Set(), grid, hiddenLayers);
        d.current = constrain(d, point, e.shiftKey);
        dispatch({ type: "pointer", cursor: d.current, snap, draw: { tool: d.tool, start: d.start } });
        setPreview({ ...d });
        return;
      }
      case "pathClick":
        pathHover(mp);
        return;
      case "node": {
        if (!d.moved && Math.hypot(sp[0] - d.at[0], sp[1] - d.at[1]) < CLICK_PX) return;
        d.moved = true;
        // Onto the path's other nodes (an end onto the other end, say), not its
        // other points: the node being dragged is one of them.
        const path = store.resolved.shapes[d.id];
        const own = path ? ownNodeSnaps(path, d.index) : [];
        const { point, snap } = snapPoint(store.resolved, mp, tolerance, new Set([d.id]), grid, hiddenLayers, own);
        const at: Point = [snapNumber(point[0] - d.offset[0]), snapNumber(point[1] - d.offset[1])];
        const change = movePolyNode(store.state, d.id, d.index, at);
        if (change) {
          if (!d.gesture) { store.beginGesture(); d.gesture = true; }
          store.commit(change);
        }
        // No measure: the status bar shows the selected node, which this is.
        dispatch({ type: "pointer", cursor: point, snap });
        return;
      }
      case "nodeHandle": {
        if (e.altKey) d.independent = true;
        if (!d.moved && Math.hypot(sp[0] - d.at[0], sp[1] - d.at[1]) < CLICK_PX) return;
        d.moved = true;
        const { point, snap } = snapPoint(store.resolved, mp, tolerance, new Set([d.id]), grid, hiddenLayers);
        const path = store.resolved.shapes[d.id];
        const node = path?.kind === "polyline" ? path.nodes.find((n) => n.index === d.index) : undefined;
        const change = node && setPolyHandle(store.state, d.id, d.index, d.which, [snapNumber(point[0] - node.point[0]), snapNumber(point[1] - node.point[1])], {}, d.independent);
        if (change) {
          if (!d.gesture) { store.beginGesture(); d.gesture = true; }
          store.commit(change);
        }
        dispatch({ type: "pointer", cursor: point, snap });
        return;
      }
      case "bend": {
        if (!d.moved && Math.hypot(sp[0] - d.at[0], sp[1] - d.at[1]) < CLICK_PX) return;
        d.moved = true;
        // Not snapped: the grabbed point follows the pointer, each move adding its delta.
        const change = bendPolySegment(store.state, d.id, d.segment, d.t, [mp[0] - d.last[0], mp[1] - d.last[1]]);
        if (change) {
          if (!d.gesture) { store.beginGesture(); d.gesture = true; }
          store.commit(change);
        }
        d.last = mp;
        // No measure: the status bar shows the selected segment, which this is.
        dispatch({ type: "pointer", cursor: mp, snap: null });
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
    if ((d.kind === "node" || d.kind === "nodeHandle" || d.kind === "bend") && d.gesture) store.endGesture();
    // A click on a selected path away from its nodes selects the segment
    // there (letting go of the node); off its segments, it lets go of both.
    if (d.kind === "move" && !d.moved) {
      if (d.segment !== null) dispatch({ type: "segment", segment: { shape: d.primary, index: d.segment } });
      else if (editor.node || editor.segment) { dispatch({ type: "node", node: null }); dispatch({ type: "segment", segment: null }); }
    }
    if (d.kind === "pathClick") {
      const sp = screenPoint(e);
      if (Math.hypot(sp[0] - d.at[0], sp[1] - d.at[1]) < CLICK_PX) pathClick(toModel(view, sp), e.shiftKey);
      return;
    }
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

  // Double-click: with the Path tool it finishes the path (its first click
  // added the last node, its second nothing); on a selected path's segment
  // it adds a node there and selects it.
  const onDoubleClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (tool === "polyline") { if (draftRef.current) finishDraft(false, e.shiftKey); return; }
    if (!editPath) return;
    const mp = toModel(view, screenPoint(e));
    if (nodeAt(editPath, mp, NODE_PX / view.scale) !== null) return;
    const hit = segmentAt(editPath, mp, SEGMENT_PX / view.scale);
    const change = hit && insertPolyNode(store.state, editPath.id, hit.segment, hit.t);
    if (!hit || !change) return;
    store.commit(change);
    // Inserted just after the segment's start node, in the stored list.
    dispatch({ type: "node", node: { shape: editPath.id, index: hit.segment + 1 } });
  };

  const onWheel = useCallback((e: RWheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const at: Point = [e.clientX - r.left, e.clientY - r.top];
    // Wheel and trackpad pinch both zoom.
    dispatch({ type: "zoomAt", factor: wheelZoom(e.deltaY, e.ctrlKey), at });
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
      onDoubleClick={onDoubleClick}
      onPointerLeave={() => { if (!dragRef.current) { dispatch({ type: "pointer", cursor: null, snap: null }); setHover(null); setClosing(false); } }}
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
              key={id} shape={shape} hair={hair} colour={layerColours.get(shape.layer) ?? null}
              selected={selection.includes(id)}
              reference={selection.length > 1 && selection[0] === id}
              locked={derivedAxes(resolved, id)}
              inert={layerView.locked.has(shape.layer)}
            />
          );
        })}
        {/* The selected segment of the path being edited, over its path. */}
        {editPath && pathSegment && <path className="segment-selected" d={pathToSvg([pathSegment.element])} strokeWidth={hair * 3.5} />}
        {resolved.dimensions.filter((d) => shown(d.target)).map((d) => <DimensionView key={d.id} dim={d} fontSize={fontSize} hair={hair} link={varName(d.target, d.prop)} />)}
        {resolved.radiusLabels.filter((l) => shown(l.target)).map((l) => <RadiusLabelView key={l.id} label={l} fontSize={fontSize} link={varName(l.target, "r", l.corner)} />)}
        {preview?.kind === "draw" && <DrawPreview d={preview} hair={hair} />}
        {tool === "polyline" && draft && <PathDraftPreview draft={draft} pointer={editor.cursor} curve={shiftHeld} closing={closing} hair={hair} />}
      </g>
      {editPath
        ? <PathNodes path={editPath} view={view} selected={pathNode?.node.index ?? null} handles={editHandles} />
        : single && <Handles shape={single} view={view} />}
      {tool === "polyline" && draft && <DraftNodes draft={draft} view={view} closing={closing} />}
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

/** The handle in `handles` nearest `point`, within `tolerance` mm; null if none. */
function nearestHandle<H extends { point: Point }>(handles: H[], point: Point, tolerance: number): H | null {
  let best: H | null = null, bestD = Infinity;
  for (const h of handles) {
    const d = distance(h.point, point);
    if (d <= tolerance && d < bestD) { best = h; bestD = d; }
  }
  return best;
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
 * `colour`: its layer's, or null for the default ink. Set as --layer-colour,
 * so selection and hover, which stroke in --select, still win.
 */
function ShapeView({ shape, selected, reference, locked, inert, hair, colour }: { shape: ResolvedShape; selected: boolean; reference: boolean; locked: ReadonlySet<string>; inert: boolean; hair: number; colour: string | null }) {
  const d = pathToSvg(shape.path);
  const style = colour ? ({ "--layer-colour": colour } as CSSProperties) : undefined;
  if (inert) return <path d={d} className="shape inert" strokeWidth={hair * 1.2} style={style} />;
  const lock = locked.size === 2 ? " locked" : locked.has("x") ? " locked-x" : locked.has("y") ? " locked-y" : "";
  return (
    <g data-id={shape.id} className={`shape${selected ? " selected" : ""}${lock}`} style={style}>
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

/**
 * The path being drawn: its nodes and a provisional one at the pointer
 * (Shift: a curve), so auto curves bend as it moves; closed when the pointer
 * is on the start. Dashed, as other previews.
 */
function PathDraftPreview({ draft, pointer, curve, closing, hair }: { draft: Draft; pointer: readonly [number, number] | null; curve: boolean; closing: boolean; hair: number }) {
  const nodes = closing || !pointer ? draft.nodes : draftPreview(draft, [pointer[0], pointer[1]], curve);
  const shape = draftShape(nodes, closing);
  return shape ? <path className="preview" d={pathToSvg(shape.path)} strokeWidth={hair * 1.2} /> : null;
}

/** A path node's marker in screen space, `r` its half-width: a square for a corner (cusp), a circle for a smooth node. */
function NodeMarker({ type, at: [x, y], r, className }: { type: PolyNodeType; at: Point; r: number; className: string }) {
  if (type === "curve") return <circle className={className} cx={x} cy={y} r={r + 0.5} />;
  return <rect className={className} x={x - r} y={y - r} width={2 * r} height={2 * r} />;
}

/** The draft's nodes in screen space (by type, as NodeMarker); the start fills when a click would close it. */
function DraftNodes({ draft, view, closing }: { draft: Draft; view: View; closing: boolean }) {
  return (
    <g className="draft-nodes">
      {draft.nodes.map((n, i) => (
        <NodeMarker key={i} type={n.type} at={toScreen(view, [n.x, n.y])} r={3} className={`draft-node${i === 0 && closing ? " closing" : ""}`} />
      ))}
    </g>
  );
}

/**
 * A selected path's nodes in screen space, like resize handles: squares for
 * corners, circles for smooth nodes, the selected one filled. `handles`
 * (the selected node's, or those on the selected segment) show as dots,
 * each joined to its node by a guide line.
 */
function PathNodes({ path, view, selected, handles }: {
  path: ResolvedPolyline; view: View; selected: number | null; handles: Array<{ node: number; which: "in" | "out"; point: Point }>;
}) {
  const nodeOf = (index: number) => path.nodes.find((n) => n.index === index);
  return (
    <g className="path-nodes">
      {handles.map((h) => {
        const node = nodeOf(h.node);
        if (!node) return null;
        const [x0, y0] = toScreen(view, node.point), [x, y] = toScreen(view, h.point);
        return <line key={`guide-${h.node}-${h.which}`} className="node-guide" x1={x0} y1={y0} x2={x} y2={y} />;
      })}
      {path.nodes.map((n) => (
        <NodeMarker key={n.index} type={n.type} at={toScreen(view, n.point)} r={4} className={`node${n.index === selected ? " selected" : ""}`} />
      ))}
      {handles.map((h) => {
        const [x, y] = toScreen(view, h.point);
        return <circle key={`${h.node}-${h.which}`} className="node-handle" cx={x} cy={y} r={3.5} />;
      })}
    </g>
  );
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
