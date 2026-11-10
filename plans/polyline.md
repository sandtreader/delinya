# Path (polyline / Bézier) tool

Requested 2026-11-10. A free path of straight and curved segments through
nodes, drawn by clicking, edited by dragging nodes and handles.

**Status: built** (model, geometry, output, UI), 2026-11-10. Everything
below is done; deviations and choices are noted inline as *Built:*. See
`plans/status.md` (Path, Drawing a path, Editing a path, Node card).

## Model

Entity kind `polyline` (UI name "Path"):

    PolyProps { nodes: PolyNode[]; closed?: boolean; layer?: EntityId }
    PolyNode  { x: number; y: number; type: "cusp" | "curve";
                in?: [dx, dy]; out?: [dx, dy] }   // handle offsets from the node

- Node positions are plain numbers (like a rect's x, y); handles are
  offsets, so moving a node carries its handles.
- **Cusp** nodes have no handles: a sharp corner.
- **Curve** nodes are smooth: `in` and `out` are colinear and opposite.
  With no handles stored the node is **auto**: resolve computes them from
  its neighbours, Catmull-Rom style — tangent along (next − prev), in/out
  lengths a third of the distance to prev/next; an end node of an open path
  points along its one neighbour. Moving a neighbour re-smooths it.
  Dragging a handle stores both (the dragged one as placed, the other
  rotated opposite, keeping its own length): the node is then manual.
- Segment i runs node i → i+1 (and last → first when `closed`). It is a
  cubic Bézier when either end is a curve node — control points are
  node + out (or the node itself if cusp) and next + in (or next) — and a
  straight segment when both ends are cusps.
- A closed path has at least 3 nodes; any path at least 2.

## Geometry

`PathElement` gains `Cubic { kind: "cubic"; from; c1; c2; to }`, with
`cubicPoint(c, t)`, `cubicBounds` (true extrema), `elementLength`
(numeric), `flattenCubic(c, tolerance)` (for DXF) and support everywhere
paths are drawn, bounded, transformed or exported (canvas, SVG `C`, PDF
`c`, DXF as flattened POLYLINE vertices, print composition).

## Actions (`model/polyline.ts`)

`addPolyline`, `movePolyNode`, `setPolyNodeType` (to curve: auto; to cusp:
drops handles), `setPolyHandle`, `deletePolyNode` (below 2 nodes deletes the
shape; a closed path dropping below 3 opens), `insertPolyNode` (split a
segment at t, de Casteljau for curves so the shape is unchanged),
`setPolyClosed`. Moving, duplicating, links and lasso treat a path like any
shape (translate every node; bounds from the curve).

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

- Every node shows as a small handle (square for cusp, circle for curve).
- Drag a node to move it (snapping); click a node to select it.
- A selected curve node shows its two handle points joined to it by guide
  lines; drag them to reshape (smooth).
- Double-click a segment to insert a node there.
- Delete/Backspace deletes the selected node (not the path); with no node
  selected it deletes the path as now.
- A node card pops up beside the selected node: type (Cusp / Curve
  toggle), x, y fields, and a bin button. Escape deselects the node.
- The shape panel shows "Path", node count, Closed checkbox, layer.
- *Built:* dragging a handle snaps it like a node (other shapes, grid).
  An open path's end node shows only the handle its segment uses. A
  handle wins over a node only when nearer. A plain click on the path
  away from nodes deselects the node. The double-click that selects a
  path can already insert a node. Node and handle drags under a link take
  the link's offset at the press (a link holding the path's edge may
  still shift the path as its bounds change). No Shift-constrain for
  handle angles yet.

## Later

Dimensions for paths, scaling the whole path by its bounds, symmetric /
independent handle modes, converting rects/circles to paths.
