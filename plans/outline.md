# Delinya — 2D Drawing Tool — Outline

## Goal
A browser-based 2D drawing tool that handles real scale and dimensions properly. Better than Inkscape or paper, without the complexity of full CAD. Woodwork plans are the first use case, not the limit.

## Principles
- 2D only.
- Real units throughout: store everything in mm; scale is a display and print setting only.
- Keep it simple: no constraint solver. Links are deterministic one-way calculations.
- Reuse SynFlo's collaboration layer (github.com/sandtreader/synflo).

## Shapes
- **Line**: exact length typed in.
- **Rectangle**: exact width and height typed in, plus an optional radius per corner (a property of the rectangle, not a separate shape).
- **Circle**: centre plus diameter (show the radius only if needed).
- Circles and radiused corners are stored internally as arcs, so one piece of arc code serves drawing and export.
- Edge case: a corner radius larger than half the shortest side must be clamped or flagged (decision needed).

## Links
- **Equal value**: linked items point at one shared variable (a length, a diameter or a corner radius). Editing any linked item updates the variable, and every linked item redraws.
- **Equal spacing**: a set of items between two end anchors, recomputed live whenever an anchor moves or an item changes size.
  - By gaps: gap = (span − total item widths) ÷ (n + 1)
  - By centres: for hole rows, such as shelf pins and hinge positions.

## Snapping
- Edges, corners and midpoints.
- Circle centres and quadrant points.
- The points where a corner arc meets a straight edge.

## Dimensions
- Dimension labels attached to the geometry, so they update when it changes.
- Radius labels (R10 and so on) attached to their corner.

## Output
- Print at true 1:1 or at a chosen scale, with a check ruler on the page.
- Export to SVG and DXF (for CNC or laser) and to PDF (for printing).

## Collaboration
- Sync the model: shapes, links and values. Don't sync derived positions.
- Each client recomputes the links locally; because the calculations are deterministic, every client shows the same drawing.
- Shared entity-document protocol and package extracted from SynFlo: see [collab.md](collab.md).

## Later / out of scope for now
- Named variables and expressions (for example `shelf.width = carcass_w - 2*t`).
- A constraint solver for angled or irregular geometry (candidates: `planegcs`, the SolveSpace solver).
- Woodwork extras: stock thickness per part, cut lists, grain direction.
