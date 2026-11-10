# Path (polyline / Bézier) tool

Requested 2026-11-10. A free path of straight and curved segments through
nodes, drawn by clicking, edited by dragging nodes and handles.

**Status: built** (model, geometry, output, UI), 2026-11-10. The same
day the node types became the usual Bézier editor's two (corner, smooth;
a short-lived third "curved cusp" is gone) and segments became
selectable (straight/curve, bend by dragging, delete), and nodes could
be broken apart and end nodes joined (node card). Everything below
is done; deviations and choices are noted inline as *Built:*. See
`plans/status.md` (Path, Drawing a path, Editing a path, Node card,
Segment card).

## Model

Entity kind `polyline` (UI name "Path"):

    PolyProps { nodes: PolyNode[]; closed?: boolean; layer?: EntityId }
    PolyNode  { x: number; y: number; type: "cusp" | "curve";
                in?: [dx, dy]; out?: [dx, dy] }   // handle offsets from the node

- Node positions are plain numbers (like a rect's x, y); handles are
  offsets, so moving a node carries its handles.
- **Cusp** ("Corner" in the UI) nodes are a sharp point: `in` and `out`
  are each optional and move independently (a side without one bends
  only by the neighbour's handle, straight if it has none). Never auto; a
  missing handle is no issue. Snaps as a corner. Any other type
  (including the old `curvedCusp`) is a bad node (`bad-value`).
- **Curve** ("Smooth" in the UI) nodes are smooth: `in` and `out` are
  colinear and opposite.
  With no handles stored the node is **auto**: resolve computes them from
  its neighbours, Catmull-Rom style — tangent along (next − prev), in/out
  lengths a third of the distance to prev/next; an end node of an open path
  points along its one neighbour. Moving a neighbour re-smooths it.
  Dragging a handle stores both (the dragged one as placed, the other
  rotated opposite, keeping its own length): the node is then manual.
- Segment i runs node i → i+1 (and last → first when `closed`). It is a
  cubic Bézier when node i has an `out` or node i+1 an `in` (after auto
  smoothing, so any smooth end) — control points are node + out (or the
  node itself without one) and next + in (or next) — else a straight
  segment (with a midpoint snap). So whether a segment is straight is
  down to the handles at its ends; a segment is named by its start node's
  stored index (a closed path's closing segment by its last node's).
- A closed path has at least 3 nodes; any path at least 2.

## Geometry

`PathElement` gains `Cubic { kind: "cubic"; from; c1; c2; to }`, with
`cubicPoint(c, t)`, `cubicBounds` (true extrema), `elementLength`
(numeric), `flattenCubic(c, tolerance)` (for DXF) and support everywhere
paths are drawn, bounded, transformed or exported (canvas, SVG `C`, PDF
`c`, DXF as flattened POLYLINE vertices, print composition).

## Actions (`model/polyline.ts`)

`addPolyline`, `movePolyNode`, `setPolyNodeType`, `setPolyHandle`,
`deletePolyNode` (below 2 nodes deletes the shape; a closed path dropping
below 3 opens), `insertPolyNode` (split a segment at t, de Casteljau for
curves so the shape is unchanged), `setPolyClosed`, for segments
`setPolySegmentCurved`, `bendPolySegment`, `deletePolySegment`, and
`breakPolyNode` / `joinPolyEnds` (each undoing the other).

- `setPolyNodeType`: to cusp keeps the resolved handles (smoothed ones
  included), so the shape stays. To curve: a cusp with both handles has
  them lined up along u = normalize(out − in), each keeping its length;
  with one, the other goes opposite, a third of the distance to that
  side's neighbour (an open end with no such neighbour: the same length);
  with none, auto.
- `setPolyHandle(…, which, offset, gesture, independent)`: a cusp sets
  only that handle (added if absent; the other untouched). A curve is
  smooth (the other turns opposite, keeping its length; auto becomes
  manual), unless `independent`: then the node becomes a cusp, the other
  handle staying where it was drawn.
- `insertPolyNode`: a segment is split as a curve when either end has a
  handle on it; a cusp end gets the split control point on that side and
  keeps its other handle as stored (possibly absent).
- `setPolySegmentCurved(…, segment, curved)`: curve puts handles on its
  ends a third of the way along it (shape unchanged until dragged);
  straight takes them off, and a smooth end becomes a cusp keeping its
  other handle as drawn. Undefined if already so.
- `bendPolySegment(…, segment, t, delta, gesture)`: Inkscape's bend. On
  the segment's cubic (a straight one taken with handles at thirds), t
  held to 0.1–0.9, weight w(t) (0 up to 1/6, a cubic ease to ½ at the
  middle, 1 from 5/6), c1 += δ(1−w)/(3t(1−t)²), c2 += δw/(3t²(1−t)), so
  the point at t moves by exactly δ. Linear in δ, so a drag applies each
  move's delta. A smooth end stays smooth (other handle turned, keeping
  its length; an auto one materialised); a corner's other handle stays.
- `deletePolySegment(…, segment, makeId)` → `{ change, ids }`: a closed
  path opens there (nodes rotated to start at the segment's end). An open
  path splits: nodes up to the segment's start stay as the path, the
  rest become a new path (`makeId("polyline")`, same layer); a part with
  fewer than 2 nodes goes, and if both do the path is deleted
  (`deleteEntity`). Auto smooth nodes at the cut keep their smoothed
  handles, so what's left keeps its shape. One undo step.
- `breakPolyNode(…, index, makeId)` → `{ change, ids, node }`: the node
  becomes two corners on the same spot, the first keeping only its drawn
  `in`, the second only its `out` (an auto node's smoothed ones), so
  nothing moves. An open path splits: nodes 0..i stay as the path, i..
  become a new path (`makeId("polyline")`, same layer). A closed path
  opens, rotated to [i′, i+1, …, i−1, i″]. `node`: the end left on the
  original path (its last node). Undefined at an open path's end. One
  undo step.
- `joinPolyEnds(state, a, b)` (`PolyNodeRef { shape, index }`) →
  `{ change, node }`: a and b different ends of open paths. One path's
  two ends close it: merged at the first node (in from the last, out from
  the first), the last dropped; undefined under 3 nodes. Two paths: a's
  is kept, turned (if need be) to end at a, then b's turned to start at b
  (turning swaps every node's in/out), b's nodes brought into a's stored
  frame by the difference of their `drawnOffset`s, b's path deleted with
  its links (`deleteEntity`, applied first so a link anchored on it
  writes a's position back). The merged node sits at a; it is smooth if
  its two handles line up opposite (so break then join restores a smooth
  node exactly), else a corner. Distance isn't checked: the UI only
  offers ends on the same spot. One undo step. `polyEnd(r, ref)` says
  whether a node is an open path's end.

Moving, duplicating, links and lasso treat a path like any shape
(translate every node; bounds from the curve).

## Drawing (tool "Path", key P)

- First click places the start node; each click adds a cusp node and a
  straight segment; **Shift-click** adds a curve node.
- A live preview runs from the last node to the pointer (as a provisional
  node, so auto curves bend as you move).
- Clicking the start node (within the snap tolerance) closes the path and
  finishes it.
- Enter, Escape or double-click finishes an open path; Backspace removes
  the last node while drawing. Fewer than 2 nodes draws nothing.
- Nodes snap like other points (shapes' snap points, grid).
- Finished paths are one undo step, selected, tool back to select (unless
  Shift was held, as for other tools).
- *Built:* a click is press + release within 3 px (a drag adds nothing);
  a click within 4 px of the last node adds nothing (double-click);
  closing snaps the pointer to the start within 10 px. Switching tool
  mid-path finishes it open (2+ nodes); New/Open drop the draft. Shift on
  the finishing click, Enter or Escape keeps the tool. A hidden or locked
  current layer blocks drawing. Backspace and Delete both take back a node.

## Editing (select tool, one path selected)

- Every node shows as a small handle (square for a corner, circle for a
  smooth node).
- Drag a node to move it (snapping); click a node to select it.
- A selected smooth node shows its two handle points joined to it by
  guide lines; drag them to reshape (smooth). A corner shows the handles
  it has; dragging one moves it alone. *Built:* Alt (Option) held at the
  press or during a handle drag on a smooth node breaks it into a corner,
  the other handle staying put.
- Click a segment (away from nodes and handles) to select it: it draws
  thicker in the selection colour and shows the handles on it (its
  start's out, its end's in) on guide lines, dragged like node handles.
  Dragging the selected segment bends it (`bendPolySegment`, t from the
  press, one gesture, no snapping); dragging any other part of the path
  still moves the path. A node and a segment are never both selected.
- A segment card pops up beside the selected segment's middle: Straight
  / Curve icon toggle (`setPolySegmentCurved`) and a bin
  (`deletePolySegment`; selects what is left). Delete/Backspace deletes
  the selected segment; Escape deselects it first.
- Double-click a segment to insert a node there.
- *Built:* a node card's **Join** (chain icon) shows on an open path's
  end with another open end on the same spot (`joinTarget` in
  `canvas/polyEdit.ts`: within 0.005 mm, drawn; the path's own other end
  first if closing leaves 3+ nodes, else other paths' ends in drawing
  order, not on hidden or locked layers); **Break apart** (broken chain)
  on any node that isn't an open path's end. Both select the kept path
  and the end node left on the spot, so they toggle. A dragged node
  snaps to its own path's other nodes too (`ownNodeSnaps`, as snapPoint's
  `extra`), so an end can be dropped onto the other end and joined.
- Delete/Backspace deletes the selected node or segment (not the path);
  with neither selected it deletes the path as now.
- A node card pops up beside the selected node: type (Corner / Smooth
  icon toggle, tooltips explaining each) and a bin button, then x and y
  fields on a row each. Escape deselects the node.
- The shape panel shows "Path", node count, Closed checkbox, layer.
- *Built:* dragging a handle snaps it like a node (other shapes, grid).
  An open path's end node shows only the handle its segment uses. A
  handle wins over a node only when nearer. A plain click on the path
  away from nodes selects the segment there (a click off every segment,
  on the path's hit stroke, deselects both). The double-click that selects a
  path can already insert a node. Node and handle drags under a link take
  the link's offset at the press (a link holding the path's edge may
  still shift the path as its bounds change). No Shift-constrain for
  handle angles yet.

## Later

Dimensions for paths, scaling the whole path by its bounds, a symmetric
(equal-length) handle mode, converting rects/circles to paths. Selecting
several nodes or segments; joining ends by dropping one onto another
(now: drop it, then Join in the node card). Pulling a handle out of a corner that has none on
that side other than via the segment (Curve, or a bend).
