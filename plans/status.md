# Delinya — Status and Handoff

Last updated 2026-11-10. Repo `sandtreader/delinya`, branch `main`. The
path (Bézier) tool and its node/segment editing are committed; in the
working tree, not yet committed: breaking a path apart at a node and
joining end nodes on the same spot (`breakPolyNode`, `joinPolyEnds`, the
node card's Join / Break apart, a dragged node snapping to its own
path's other nodes; `tests/pathJoin.test.ts`). Vitest tests, `tsc` and
the build pass.

## Where we are

The abstract model is complete for the outline's v1 feature set and the
first visual slice is usable: you can draw (lines, rectangles, circles and
paths of straight and curved segments), move, resize, edit path nodes, type exact values,
link equal values and equal spacing, put shapes on layers, undo,
save/load local files, print at
scale (tiled if needed, with a check ruler and title block) and export PDF,
SVG and DXF. The collab adapter is wired and tested against the real relay
but has no UI.

## What is built

### Model (`src/model/`, all pure, fully tested)

- **Document** is `@sandtreader/collab`'s `DocState` (flat `{kind, props}`
  map). Kinds: `line`, `rect`, `circle`, `variable`, `link.spacing`,
  `dimension`, `radius-label`, and the singleton `document` (id
  `DOCUMENT_ID`) holding title, author, revision and notes for the title
  block, and `gridSpacing` (mm). Typed props in `types.ts`;
  `setDocumentProps` edits the text (`DOCUMENT_FIELDS`, which the title
  block and resolve iterate; it excludes the spacing), `setGridSpacing`
  the spacing (positive numbers only), and `resolved.document` reads them
  ("" when unset; spacing 1 mm when unset, or when bad, with a
  `bad-value` issue).
- **Lengths** are `number | { ref: variableId }`. Equal-value links are
  refs (outline option A). There is no `link.equal` entity.
- **Line** is stored as `{ x, y, length, angle }` so its length can be a
  ref. Angles are degrees from +x towards +y; y is down.
- **Path** (`polyline` kind; spec `plans/polyline.md`; model, geometry,
  output and UI built): `{ nodes: PolyNode[], closed?, layer? }`, each
  node `{ x, y, type: "cusp" | "curve", in?, out? }` with handles as
  offsets: a cusp ("Corner": each handle optional and independent; never
  auto, no issue for a missing one) or a curve ("Smooth"). A curve node
  with no handles is auto (smoothed from its neighbours, Catmull-Rom
  style, at resolve); both handles stored makes it manual; one only is
  flagged and treated as auto. Any other type (the old `curvedCusp`
  included; no compatibility) is a bad node. A segment is a cubic when its
  start has an `out` or its end an `in` (after smoothing), else straight.
  Resolve drops bad nodes (`bad-value`), needs 2 nodes (3 closed, else it
  opens). `ResolvedPolyline.nodes` carry their stored `index` (node
  actions take stored indexes; a segment is named by its start node's),
  drawn point and effective handles. Snaps: nodes (open ends endpoint,
  cusps corner, curve nodes tangent) and straight segments' middles. No
  dimensions or resize handles. Actions in `polyline.ts`: `movePolyNode`,
  `setPolyNodeType` (to cusp keeps the resolved handles, so the shape
  stays; to curve lines two handles up along out − in, each keeping its
  length, turns one's partner opposite at a third of the way to that
  neighbour, else auto), `setPolyHandle` (cusp: that handle only, added
  if absent; curve: smooth, materialising an auto node, or with
  `independent` breaks it into a cusp), `deletePolyNode`,
  `insertPolyNode` (de Casteljau; shape unchanged; a cusp keeps its other
  handle as stored), `setPolyClosed`; for segments `setPolySegmentCurved`
  (handles at thirds, or off with smooth ends becoming corners),
  `bendPolySegment` (Inkscape's weighting; the point grabbed at t moves by
  exactly the delta; linear in it; smooth ends stay smooth) and
  `deletePolySegment` (opens a closed path there, splits an open one into
  two paths on the same layer, dropping parts under 2 nodes; auto ends at
  the cut keep their handles, so nothing left moves; returns the ids left),
  `breakPolyNode` (two corners on the spot, each keeping the drawn handle
  its side uses; splits an open path, opens a closed one; returns `ids`
  and the end `node` left on the path) and `joinPolyEnds` (open ends as
  `PolyNodeRef`s; one path's two ends close it, two paths become a's,
  turned as needed with handles swapped, b's nodes moved into a's stored
  frame, b deleted with its links; the merged node smooth if its handles
  line up opposite, so break then join is exact). Moving, duplicating,
  links and one-shot arranging shift every node (a link's write-back only
  on its own axis).
- **Geometry** has `Cubic` path elements (`cubic`, `cubicPoint`,
  `cubicBounds` from the derivative's roots, `splitCubic`, numeric
  `elementLength`, `flattenCubic(c, tol)` by adaptive subdivision) beside
  segments and arcs; `elementStart`/`elementEnd`/`elementBounds` cover
  all three. SVG writes `C`, PDF `c`, print maps cubics to paper, DXF
  flattens them (0.01 mm) into the run's POLYLINE vertices.
- **`resolve(state)`** (`resolve.ts`) returns shapes (as segments and arcs;
  a circle is one full arc), snap points, dimensions with anchors and
  normals, radius labels at arc midpoints, active spacings, variables and
  `issues`. It never throws. Dangling refs resolve to 0 and raise an Issue.
- **Corner radii** are clamped with the CSS `border-radius` rule (scale all
  radii by the smallest ratio side ÷ adjacent-pair sum). This settles the
  outline's "clamp or flag" question: clamp, and flag with a
  `radius-clamped` issue shown in the shape panel.
- **Spacing links** derive along-axis positions between the anchors' inner
  faces, by gaps or by centres. Items' stored along-axis position is
  ignored while linked; `unlinkSpacing` writes the derived value back.
- **Align links** (`link.align`: anchor, items, axis, mode start/centre/
  end) put items' left/centre/right or top/middle/bottom on the anchor's.
  Centring both ways is two links. `unlinkAlign` writes back like spacing.
- **Link rules** (both kinds, in `resolve.ts`): a shape's position on an
  axis can come from only one link — the first by ID wins and a later
  claimant is inactive with `link-conflict`. Links are applied per axis in
  dependency order (a link waits for whichever links place its anchors),
  ties by ID, so chains work whatever the IDs; cycles go inactive with
  `link-cycle`. `derivedAxes(resolved, id)` says which axes a link controls.
- **One-shot arranging**: `alignOnce`, `spaceOnce` and `equaliseOnce` move
  or resize once, using the same arithmetic as the live links, and leave
  no link. They skip shapes a live link already places on that axis.
- **Actions** (`actions.ts`) are `(state, …) → Change`. `setLength` edits
  the variable when the prop is a ref. `deleteEntity` cascades to
  dimensions, labels and spacing membership/anchors. `resize.ts` has
  `handlesFor(shape)` and `resizeTo(...)` for the canvas handles.
- **`DrawingStore`** (`store.ts`) is the single point of mutation:
  `commit` (local, undo-recorded, emitted), `applyRemote`, `replace`,
  change-based undo/redo via `invert()`, and gesture folding
  (`gestureStart`/`gestureEnd` flags on one entity, or
  `beginGesture()`/`endGesture()` for multi-entity drags). `markSaved()`
  and `dirty` track unsaved changes by history position, so undoing back
  to the saved point is clean again; remote changes and `replace` dirty
  it until the next `markSaved()`.
- **Files** (`file.ts`): `serializeDrawing` writes pretty JSON
  `{ format: "delinya", version: 1, doc }`; `parseDrawing` returns
  `{ ok, state } | { ok: false, error }` and never throws. It checks only
  the generic entity shape (resolve handles bad props), keeps unknown
  kinds, and refuses newer versions. Bump `FILE_VERSION` only when an
  older reader would misread a file.

### Collaboration (`src/collab/index.ts`)

`collabDocument(store)` adapts the store to the package's document
interface; `bindCollab(store, client)` forwards emitted changes.
`tests/collab.test.ts` runs two stores through the real relay (late joiner
snapshot, linked edits, drag + undo). The app namespace is `delinya`. There
is no connect UI, session panel or presence yet, and no relay vhost for
delinya.net.

### UI (`src/canvas/`, `src/panels/`, `src/app/`, `src/view/`)

Vite 6, React 19, TypeScript, plain CSS. SVG canvas with a model-space
`<g transform>` layer. Editor state (tool, selection, view, cursor, snap,
grid show/snap) lives in a reducer and is never part of the document; the document is read
through `useSyncExternalStore`.

- **Tool palette** (`panels/ToolPalette.tsx`): select, line, rectangle,
  circle and path as icons in a palette floating over the canvas, top left by
  default, dragged by its grip. Its position is per browser in
  localStorage (`delinya.toolPalette`, via `app/floatPosition.ts`), never
  in the document, and is kept on screen when the window shrinks. The
  position, grip drag and clamping are shared with the layer palette in
  `panels/floating.tsx` (`useFloating`, `Grip`); Reset view (in the
  status bar, beside the px/mm scale) resets zoom and pan and sends both
  palettes home (`sendPalettesHome`). A full screen / window toggle sits
  at the right end of the status bar (`app/fullscreen.ts`; follows
  `fullscreenchange`, so Esc/F11 keep it right; hidden where the browser
  can't). Header and status bar buttons are
  icons (`panels/icons.tsx`, `IconButton`).
- **Tooltips**: one shared tooltip (`panels/Tooltip.tsx`, mounted once in
  `Shell`) for every element with `data-tip`; nothing uses the browser's
  `title`. It shows after resting on the element for 1 s (or on keyboard
  focus), then at once for the next within 0.5 s, like native tooltips
  (`TipTimer`, `view/tooltip.ts`). Fixed-position, so never clipped by a
  scrolling panel, and above dialogs. `data-tip-side` picks the side
  (below by default; right in the palettes, above for Reset view);
  `placeTip` flips it and keeps it in the window. A click, key, wheel or
  window blur hides it; nothing shows while a pointer button is held, so
  drags don't pop tips. Disabled buttons still show theirs. The bubble
  is aria-hidden: `tip()` (`panels/tip.ts`) sets the same text as the
  element's `aria-description` all the time, unless it is just its name,
  so screen readers get it on focus without waiting.
- **Tools**: select (V), line (L), rect (R), circle (C), path (P). Drawing a
  shape also adds its dimensions (rect: width and height; circle: diameter;
  line: length; path: none) and returns to select unless Shift is held.
  Shift constrains to square / 45° (for the path tool it makes a curve
  node instead). The path tool's tooltip says how it works.
- **Drawing a path** (`canvas/Canvas.tsx`, pure parts
  `canvas/polyDraft.ts`): clicks, not a drag. Each click (press and
  release within 3 px) adds a node at the snapped point (shapes' snap
  points, else the grid; free 0.01 mm with grid snap off), a cusp, or a
  curve node with Shift. The nodes so far are a draft in the canvas (like
  a drag, never in the document or editor state), drawn dashed with a
  provisional node at the pointer (Shift: a curve), resolved as a real
  path would be so auto curves bend as the pointer moves; the draft's
  nodes show as small squares/circles (drawing makes cusps without
  handles and auto curves). A click within 4 px of the last node adds nothing (the second
  click of a double-click). With 3+ nodes, the pointer within 10 px of the
  start snaps to it (endpoint marker, start node filled, preview closed)
  and a click there closes and finishes. Enter, Escape or a double-click
  finish it open; Backspace/Delete take back the last node (the last one
  ends the draft). Those keys are caught in a window capture listener
  while drafting, so the app's Escape/Delete don't also run (not while
  typing in a field, a dialog or a question is up). Finishing commits one
  `addPolyline` on the layer that was current when the draft began (one
  undo step), selects it and returns to select unless Shift was held on
  the finishing click/key. Fewer than 2 nodes draw nothing. The status bar
  shows the segment from the last node to the pointer as a line reads
  (`draw` tool `polyline` in `drawStatus`). **Switching tool mid-path
  finishes it, open** (if it has 2 nodes); New and Open drop it instead
  (`discardPathDraft`, called from the file commands' reset), so it isn't
  finished onto the new drawing. A hidden or locked current layer blocks
  it like the other tools.
- **Editing a path** (select tool, exactly one path selected, not on a
  locked layer; hit-testing in `canvas/polyEdit.ts`): every node shows as
  a screen-space handle like resize handles (square: corner, circle:
  smooth; the selected node filled; drafts the same). The selected node
  shows its in/out handles (dots on guide lines; the effective ones, so an
  auto node's smoothed handles; a corner only those it has; an open path's
  ends only the one their segment uses). Press on a node selects it
  (editor `node: { shape, index }`, stored index; action `node`; cleared
  when the selection changes to anything but that path alone, by
  `toggleSelect`, or leaving the select tool; `selectedPathNode(r,
  editor)` also checks the node still exists); dragging it (past 3 px)
  moves it with `movePolyNode`, snapped to other shapes' points, the
  path's own other nodes (`ownNodeSnaps`, passed as `snapPoint`'s
  `extra`; so an end drops onto the other end) and the grid, as one
  gesture. If a link draws the path away
  from its stored nodes, the offset (`drawnOffset`) is taken at the press
  and subtracted, so the node follows the pointer. Dragging a handle uses
  `setPolyHandle` (smooth on a smooth node, alone on a corner; snapped the
  same way; one gesture). Alt (Option) held at the press or at any point
  in the drag passes `independent`, so a smooth node's handle breaks it
  into a corner (the other handle stays put; it stays broken). Handle
  beats node only when nearer (a zero-length handle leaves its node
  draggable). **Segments**: a click on the selected path away from its
  nodes and handles selects the segment there (within 6 px; editor
  `segment: NodeRef` named by its start node, action `segment`; never
  with a node: setting either clears the other; same lifetime as `node`;
  `selectedPathSegment(r, editor)` gives its drawn `position` and
  `element`); a click off every segment lets go of both. The selected
  segment draws over the path in the selection colour, 3.5 px, and shows
  the handles on it (`segmentHandles`: its start's out, its end's in) on
  guide lines, dragged exactly like node handles. Pressing on the
  selected segment and dragging (past 3 px) bends it: t from `segmentAt`
  at the press, each move's model delta through `bendPolySegment`, one
  gesture, no snapping. A drag on any other part of the path moves the
  whole path as before. Double-click on the path's segment (within 6 px)
  inserts a node there (`insertPolyNode`, shape unchanged) and selects
  it; this also works on the double-click that first selects the path.
  Clicking a node or segment of an unselected path just selects the path.
  Delete/Backspace deletes the selected node (`deletePolyNode`; if the
  path goes, so does the selection) or segment (`deleteSegment`, as the
  card's bin); Escape lets go of either first. The status bar shows "node
  N of M · x, y mm" or "segment N of M · length mm" (N among the drawn
  nodes/segments) ahead of the selection readout, also while dragging.
- **Node card** (`panels/NodeCard.tsx`): a small card beside the selected
  node (16 px below right, flipped and kept inside `.canvas-area` by
  `view/placeNear.ts`; the frame, placement and bin icon are
  `panels/PathCard.tsx`, shared with the segment card), following it
  (named "Node N of M" for screen readers; no visible number). Top row: a
  two-way icon toggle, Corner (lines meeting at a filled square) / Smooth
  (aria-labels; tooltips explain each, the smooth one mentioning
  Alt-drag; `setPolyNodeType`), **Join** (chain; only on an open path's
  end with another open end within 0.005 mm, `joinTarget` in
  `canvas/polyEdit.ts`: its own other end first if 3+ nodes would be
  left, else other paths' in drawing order, not on hidden or locked
  layers; tooltip says whether it closes the path), **Break apart**
  (broken chain; any node but an open path's end), and a bin
  (`deleteNode`, shared with the Delete key). Join and Break select the
  kept path and the end left on the spot, so each offers the other. Then x and y on a row each, showing the drawn position
  (typed values have `drawnOffset` taken off before `movePolyNode`).
  Escape in a field reverts as other fields do. A press on the canvas
  blurs a focused input first, so an edit in the card (or a panel)
  commits before the press can unmount it.
- **Segment card** (`panels/SegmentCard.tsx`): the same kind of card
  beside the selected segment's middle (`cubicPoint` at 0.5, or the
  midpoint), named "Segment N of M". One row: Straight / Curve icon
  toggle (`setPolySegmentCurved`; the segment's own kind pressed) and a
  bin, "Delete segment" (`deleteSegment`: `deletePolySegment` with
  `newId`, then selects the ids left, both parts after a split, nothing
  if the path went). CSS shared as `.path-card`, `.icon-toggle` (the node
  card's rows keep the class `node-card-row`).
- **Pan/zoom**: wheel and pinch zoom at the cursor, as in SynFlo. Space
  or the middle button pans in any tool, and a finger pans the
  background; a mouse or pen no longer does (it lassoes). Pan and zoom
  are reducer delta actions so rapid events never read a stale view.
- **Rulers** (`canvas/Rulers.tsx`, `view/rulers.ts`): 20 px strips along
  the top and left with an "mm" corner, outside `.canvas-area` (a
  `.canvas-frame` grid holds them), so the palettes, panels and their
  stored positions are unchanged. A tick on every drawn grid line,
  longer every 5th, labelled every 10th (every 5th or every line once
  those are ≥ 80 px apart, i.e. zoomed in past the spacing). They follow
  pan/zoom and the grid spacing whether or not the grid shows. A marker
  follows the pointer (`canvas/hover.ts`; snapped while drawing). Wheel
  over a ruler zooms as on the canvas; presses there do nothing.
- **Lasso** (`canvas/lasso.ts`): with the select tool, a mouse/pen drag
  on the background (past 3 px) selects the shapes wholly inside the
  rectangle, live, skipping hidden and locked layers. Shift adds to the
  selection from before the drag; Esc cancels and restores it; a click
  without movement clears the selection.
- **Grid**: the spacing is the drawing's (`gridSpacing` on the document
  entity, default 1 mm: saved, synced, undoable). Zoomed out, the drawn
  grid coarsens to multiples of it (×1, ×2, ×5, ×10, ×20, ×50…, no cap) so
  lines stay at least 8 px apart (`gridPitch(view, spacing)` in
  `view/viewport.ts`); every tenth line is darker. **Show grid** and
  **Snap to grid** are each viewer's own choice, like layer hide/lock:
  `editor.grid: GridView { visible, snap }` (action `grid`), not synced,
  saved or undoable, kept on New/Open, and remembered per browser in
  localStorage (`delinya.grid`, `app/gridView.ts`; loaded lazily into the
  reducer, saved on change). Hiding the grid keeps the origin axis lines
  (`grid-axis`): they are the axes, not the grid.
- **Snapping** (`canvas/snap.ts`): to other shapes' snap points (and any
  `extra` points passed) within 10 px, else to the drawn grid pitch. With grid snap off (`grid` null)
  free points and move deltas round only to 0.01 mm; shapes' snap points
  still apply. Moving snaps the moving shape's own points onto others.
  The status bar shows the snap type. Hovering with the select tool
  shows no position (`hoverShowsPosition`); moving, resizing and
  lassoing do. While a new shape is dragged out
  it shows its start and size instead of the pointer (`drawStatus` in
  `view/format.ts`: from x, y · w × h; centre · ⌀; from · length at angle).
  Moving a selected shape or dragging its handle shows that shape's live
  position and size the same way (`shapeStatus`, editor `measure`; the
  grabbed shape when several move), and with the select tool the
  selection shows it as soon as it is selected (several: their bounds,
  from x, y · w × h). Priority is `positionStatus` in `view/format.ts`:
  drawing, dragging, selection, pointer.
- **Resize handles** on a single selection: rect corners (anchor opposite
  corner, flips across it), circle centre and radius, line ends.
- **No sidebar.** The selection gets one floating panel top right of the
  canvas (`panels/SelectionPanel.tsx`; which one is `panelFor` in
  `app/editor.ts`), scrolling if taller than the canvas, with Delete at
  the bottom.
- **Shape panel** (`panels/ShapeFields.tsx`): one shape selected, with any
  tool, so a just-drawn shape can be sized at once. A path ("Path") shows
  its node count, a Closed checkbox (`setPolyClosed`; disabled below 3
  nodes) and, with the select tool, a hint on editing nodes and segments; no size
  fields. Other shapes: x/y, each length with
  a linked badge and unlink, corner radii with a clamped indicator,
  spacing and alignment membership with remove. Position fields a link
  controls are locked and show the derived position.
- **Arrange panel**: two or more shapes selected, select tool only. The
  first-selected shape is the reference (drawn with a halo). Align (six
  icons), Centre on
  reference, Space (gaps/centres across/down, three or more shapes, the
  outer two as anchors) and Equal (width/height, diameter or length for
  same-kind selections). Align has an Across and a Down row; an align link
  already joining the selection on an axis shows pressed (purple), and
  that row's buttons change its mode (`setAlignMode`) rather than adding a
  conflicting link. "Keep linked" (editor state, off by default)
  switches every action from a one-off move/resize to a live link; equal
  values then go through a named variable.
- **Duplicate** (both selection panels, above Delete): direction toggles
  (→ ↓ ← ↑) and a gap in mm (editor state `duplicate`, default right,
  10 mm, not saved). The copy sits beside the selection's bounds, the gap
  clear of it (`duplicateOffset`), and becomes the selection, so pressing
  again carries on the row. `duplicateShapes` (`model/duplicate.ts`)
  copies shapes at their drawn position (link-derived positions copied as
  drawn, links not copied), keeps sizes' variable refs, radii and layer,
  and copies their dimensions and radius labels; one batch, one undo.
- **Properties…** (header, before Print / Export;
  `panels/PropertiesDialog.tsx`): a fixed-width dialog with tabs
  (Drawing | Grid | Variables; an ARIA tablist, Left/Right/Home/End move
  between tabs, roving tabindex; component state, Drawing first). Drawing:
  title, author, revision, notes, printed in the title block. Grid:
  spacing (mm, the drawing's), Show grid and Snap to grid (yours, this
  browser). Variables: their editable values. Panels stay mounted (hidden)
  and share a min-height, so the dialog doesn't jump between tabs.
  Fields commit on blur, so closing or switching tab blurs first. Field
  widgets shared with the shape panel are in `panels/fields.tsx`; `Num`
  takes an optional `valid` check and reverts text it refuses.
- **Files** (`app/file.ts`): New, Open…, Save, Save as… in the toolbar;
  ⌘O, ⌘S, ⇧⌘S. Uses the File System Access API where present (Chromium),
  so Save writes back to the opened file; elsewhere Save downloads and
  Open uses a file input. Extension `.dln` (JSON inside); Open
  offers only `.dln`. The tab title and the right end of the header show the file
  name and a • when dirty; the header adds the drawing's title in quotes
  (`quotedTitle`, left out when blank or the same) and clicking it opens
  Properties on the Drawing tab; New/Open ask before discarding (in-app
  dialog: for a drawing with a file of its own, Save / Cancel / Discard,
  saving first then going on; untitled, Discard / Cancel), and closing the
  tab warns (the browser's own prompt; that one can't be replaced). Open
  and save errors show in the in-app dialog too.
  Loading clears selection, returns to select and resets the view.
- **Print / Export** (`panels/OutputDialog.tsx`, ⌘P): paper (A0–A4,
  Letter, Legal, Tabloid), orientation (auto picks fewer sheets), scale
  (2:1 … 1:100, Fit = largest that fits one sheet), dimensions on/off,
  live preview of every sheet. Print uses `window.print()` on true-size
  page SVGs with an `@page` rule (`app/print.ts`); Download PDF writes the
  same pages. SVG and DXF download at 1:1 mm. Paper, orientation and
  dimensions are remembered in localStorage; scale only for the session.
- **About** (`panels/AboutDialog.tsx`): "Delinya" at the left of the
  header opens it: name, version (`app/version.ts`, package.json via
  Vite's `define` `__APP_VERSION__`) and a placeholder line until the
  real text arrives.
- **Questions and notices** (`app/ask.ts`, `panels/AskDialog.tsx`): the
  app's own confirm/alert, never the browser's. `ask({ title, message,
  confirm?, cancel?, danger? })` resolves true/false; `choose` adds an
  `alternative` third button (left, red, e.g. Discard) and resolves
  "confirm" | "cancel" | "alternative"; `tell(title, message)` has only OK; module state (not React) so `file.ts` can use it,
  and questions queue, one shown at a time. The dialog sits above other
  dialogs, focuses its confirm button (red when `danger`), keeps Tab
  inside it, and while open swallows every key from a window capture
  listener registered at mount (Escape cancels, Enter/Space press the
  focused button), so no shortcut fires underneath. Clicking the backdrop
  cancels. Outside-click handlers (the layer card) ignore clicks while a
  question is up.
- **Keys**: ⌘Z / ⇧⌘Z (Ctrl+Y) undo/redo, Delete/Backspace (a selected
  path node or segment, else the selection; while drawing a path, its
  last node), Escape (a selected path node or segment first; while
  drawing a path, finishes it;
  else back to select and clear), V/L/R/C/P tools, ⌘P print/export, ⌘D duplicate the selection exactly
  as the panel's Duplicate does (its last direction and gap, via
  `duplicateBeside`), selecting the copies so repeating it carries on the
  row. File keys and ⌘D
  work from inside a field: they blur it first so its value commits.

### Output (`src/output/`, all pure, fully tested)

- `drawingPrimitives(resolved)` turns the drawing into paths and text with
  roles (shape, dimension, furniture, guide) once; every format renders
  those. Text is measured with Helvetica metrics (`text.ts`) everywhere.
  Ink is per role in `STYLE.colour`: dimensions mid blue (`#3070c0`),
  everything else black, unless a primitive carries its own `colour`
  (shapes on a coloured layer; see Layers). The canvas takes its
  `--dimension` colour from the same constant, so screen and paper match.
- `planPages` lays the drawing onto sheets at a scale: margins 10 mm, a
  30 mm footer band, tiles overlapping 10 mm and labelled A1, A2, … B1.
- `composePages` gives each sheet in paper mm: the drawing (clipped to
  the area), a 100 mm check ruler, overlap guides, and an 80 × 30 mm
  title block bottom right (title, author, revision, scale, sheet,
  notes; title falls back to the file name), and a small 2 mm "Delinya"
  right-aligned just below the block, in the page margin.
- `pageToSvg` (preview and print), `exportPdf` (hand-written PDF 1.4,
  standard Helvetica, no dependencies), `exportSvg` (1:1 mm) and
  `exportDxf` (R12, mm, y flipped, shapes only; rects become closed
  polylines with bulges so CAM gets whole contours).

### Layers

- **Model** (`model/layers.ts`, layer parts of `resolve.ts`/`types.ts`):
  `layer` entities `{ name?, order, colour? }`, nothing else. Position comes from
  a fractional `order` (lowest at the back, ties by ID), so
  `moveLayer` changes only the moved layer's order (midway between its new
  neighbours) and concurrent moves don't fight. A drawing with no layer
  entities has one implicit base layer at `BASE_LAYER_ID` (`"layer"`);
  actions that need it real (`addLayer`, `setLayerName`,
  `setLayerColour`) materialise it
  in the same change, so a drawing only grows layer entities once layers
  are used. Shapes carry an optional `layer` prop; missing or dangling
  falls back to the base (else the first) layer. `resolved.layers` is
  back to front with 1-based `number`s; every resolved shape has `layer`;
  `resolved.order` is draw order (layer 1 at the back, document order
  within a layer).
- **Line colour** is part of the drawing (saved, synced, undoable, unlike
  hide/lock): `colour` on the layer entity, `"#rrggbb"` lower case,
  absent = the default ink. `setLayerColour(state, id, hex | null)`
  (undefined if unchanged, unknown, or not `#rrggbb`; null clears, even a
  bad stored value). `ResolvedLayer.colour` is the hex or null; a bad
  stored value resolves to null with a `bad-value` issue. The UI offers
  `LAYER_COLOURS` (`{ name, hex, aci }`): Default (null, ACI 7), Grey
  `#808080` (8), Red `#e00000` (1), Brown `#8b4513` (34), Green `#1e8c1e`
  (3), Teal `#00897b` (4), Navy `#1a2b99` (5), Magenta `#c0189c` (6) —
  dark enough for fine lines on paper, clear of the canvas's own orange,
  purple, red and dimension blue. Any `#rrggbb` resolves; one outside the
  palette gets the nearest entry's name/ACI (`layerColourEntry`). The
  canvas strokes shapes via `--layer-colour` on the shape (selection,
  hover and preview still win with `--select`); locked layers' shapes
  keep their colour.
- **Hidden and locked are local to each viewer**: editor state
  (`editor.layerView: { hidden, locked }`, sets of layer IDs; action
  `toggleLayer`), never in the document, so not synced, saved, undoable
  or marking the file dirty. New and Open clear them (`resetLayers`, which
  also clears the current layer), so a drawing opens all shown and
  unlocked. **Hidden** layers are not drawn, snapped to, selected or
  output, and neither are their shapes' dimensions, radius labels or
  "= name"s; link guides with any member on a hidden layer are skipped.
  **Locked** layers are drawn and snapped to but not selectable (shapes
  are click-through, no hover). Links still apply across layers whatever
  their state. Queries take the view: `isVisible(r, id, hidden)`,
  `isSelectable(r, id, layerView)`; snapping, link guides/buttons and
  output take an optional `hidden` set (default: none hidden).
  `layerChoice` is the other query.
- **Current layer** is editor state (`editor.layer`, action `layer`),
  never in the document. `currentLayer(r, wanted)` falls back to layer 1
  when unset or gone (e.g. after deleting it). New shapes go on it; if it
  is hidden or locked, drawing tools don't start (cursor not-allowed).
- **Selection pruning**: the Shell drops any selected id that isn't
  selectable (`selectableOnly(r, ids, layerView)`) whenever the document,
  selection or layer view changes, which covers hiding/locking, moving
  shapes to such a layer, undo and peers.
- **Layer palette** (`panels/LayerPalette.tsx`): floating, below the tool
  palette by default (`delinya.layerPalette`, home y 211 now the tool
  palette has five tools; a stored position is kept). A numbered button per
  layer, 1 at the top; the current layer is highlighted like the active
  tool; hidden layers' numbers are dimmed with an eye-off mark, locked
  ones get a lock mark; a coloured layer has a thin bar in its colour
  down the button's left edge (dimmed when hidden). The tooltip (to the right) shows the name
  ("Layer N" if unnamed) and "· hidden, locked"; not while its card is
  open. Clicking makes the layer current and opens its
  card (click again, Escape or click outside closes it; Escape only
  closes the card): name field, line colour, hide/show, lock/unlock, and
  delete. The colour is a swatch button opening a 4 × 2 grid of the
  palette (each swatch a button with its name as tooltip, the current one
  `aria-pressed`, focused on open); choosing commits `setLayerColour` and
  closes the grid. Escape or a press elsewhere in the card closes just the
  grid; a press outside the palette closes both. Delete
  deletes the layer and its shapes as one undo step (asks first, in the
  in-app dialog, if it has shapes; disabled for the only layer). "+" adds
  a layer in front and makes it current. Dragging a button (after 4 px) reorders, others
  making room; the drop index is `view/reorder.ts` `dropIndex`, committed
  with `moveLayer`, and numbers follow the new order.
- **Selection panels**: with more than one layer, the shape panel and
  arrange panel have a Layer select ("N · name"); a mixed multi-selection
  shows a disabled "mixed" until a layer is picked (`setShapesLayer`).
- **Output** follows what you see: layers this viewer has hidden, with
  their dimensions and labels, are left out of print, PDF, SVG and DXF
  (`PrintOptions.hidden`, `exportSvg`'s `hidden`, `exportDxf(r, hidden)`),
  and the dialog says "Hidden layers are left out." when any are. A
  coloured layer's shapes print in its colour (`PathPrim.colour`, set by
  `drawingPrimitives` on those shape paths only; SVG `stroke`, PDF `RG`);
  dimensions, labels and furniture keep theirs. DXF gets one layer per
  visible drawing layer, named after it ("Layer N" if unnamed, sanitised
  to R12's 31-character names, duplicates suffixed `_2`…), with the
  layer's ACI as its colour (group 62; 7 for the default); entities stay
  BYLAYER.

## Decisions taken (not in the outline)

- Arranging moves once by default; "Keep linked" makes live links. The
  first-selected shape is the reference (Illustrator's key object).
- Deleting a link's anchor writes its items' derived positions back before
  removing the link, so they stay where the link put them (one undo step).
  An align link emptied of items is removed; a spacing link is not.
- **Live links on the canvas** (screen only, never printed), in purple:
  dashed guides along aligned edges/centre lines, a line with "=" marks
  across each equal gap or pitch, and "= name" after linked dimension and
  radius values. All links are faint; links touching the selection are
  strong; links not in force (conflict, cycle) are red. Geometry is the
  pure `view/linkGuides.ts`; guides run 16 px past their shapes so an
  edge-aligned guide has a clickable stretch beyond the shape's edge.
- **Removing links** (`panels/LinkButtons.tsx`): clicking a guide or a
  "= name" opens a small broken-chain popup that removes that link
  (`unlinkTarget`: align/spacing write positions back; a linked length or
  corner keeps its value). With two or more shapes selected, every link
  joining them shows a broken-chain button on the canvas (`view/
  linkButtons.ts`). Dimension lines are click-through.
- Resize handles respect links (`linkLocks`, `dragHandle`): the point a
  link holds (edge or centre; spacing counts as centre) stays put and the
  handle follows the pointer from it; a handle that would have to move the
  held point can't move that way. Cursors show no-entry or the free
  direction, and a right-edge-held circle's radius handle sits on its left.
- Drags can't move a shape along an axis a link controls (`freeDelta`);
  a shape locked both ways makes no edit or undo step. The cursor says so:
  no-entry when locked both ways, an up-down or left-right arrow when
  only one way is free.
- Print and PDF share one page model; the PDF and DXF writers are
  hand-written (no jsPDF / dxf libraries). Exact print scale depends on the
  print dialog being at 100%; the check ruler is how users verify it.
  Verified on paper 2026-11-09: the ruler measured exactly 100 mm.
- Document properties are a singleton entity, so they save, sync and undo
  like everything else. Grid spacing is one of them; showing and snapping
  to the grid are per viewer (editor state + localStorage), like layer
  hide/lock.
- Equal-value links are refs, not link entities.
- Lines store length and angle, not two endpoints.
- Corner radii clamp (CSS rule) and flag rather than reject.
- Dimensions are created automatically with each shape; there is no manual
  dimension tool yet.
- Undo is local-only; remote changes bypass history.
- Derived spacing positions are never written to the document except on
  unlink.
- No MUI yet. The collab package's React entry needs MUI, so the session
  panel forces that decision.

## Not built yet (in rough priority order)

1. **Manual dimension and radius-label tools**, and dragging dimension
   offsets.
2. **Collaboration UI**: connect, session panel, presence cursors. Needs
   the MUI decision and `ProxyPass` lines on a delinya.net vhost (same as
   synflo.net, port 2901 on st1).
3. **Fit view to drawing** (on open, and as a button); opening resets to
   the default view for now.
4. Links: resizing one of several gap-spaced items drifts its centre
   slightly (the held point is approximated as centre). Spacing a
   selection that includes a containing shape (e.g. the panel with its
   holes) makes the panel an anchor and overflows; it could exclude
   shapes that contain the others.
5. Print refinements: a date in the title block, dimensions in DXF on
   their own layer, a custom scale.
6. Rotation of rects, text, named variables/expressions, woodwork extras
   (see outline "Later").
7. Path extras (`plans/polyline.md` "Later"): dimensions, scaling by
   bounds, symmetric (equal-length) handles, converting rects/circles to
   paths; also Shift to constrain a handle's angle, selecting a node or
   segment on the click that selects the path, multi-node/segment
   selection, joining by dropping one end on another (now via the card).

## Gotchas for whoever picks this up

- Every mutation goes through an action and `store.commit()`. Undo, the
  collab adapter and the tests all assume that.
- `vite.config.ts` imports `defineConfig` from `vitest/config`, not `vite`,
  so the `test` block typechecks.
- When adding pointer handlers in `Canvas.tsx`, dispatch deltas rather than
  computing from a captured `view`; several events can arrive per render.
- Drag gestures: call `beginGesture()` on the first move of a multi-entity
  drag and `endGesture()` on pointer-up, or undo splits the drag into steps.
- The relay tests need `ws` installed (it is a devDependency).
- Dev server: `pnpm dev` on http://localhost:5174/.

## Working agreements

- Do not commit or push until asked. "cp" means commit and push.
- Woodwork is the first use case, not a limit: keep features general.
- Prove builds locally before tagging; one tag per working release.
