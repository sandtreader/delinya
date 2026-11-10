# Delinya — Status and Handoff

Last updated 2026-11-10. Repo `sandtreader/delinya`, branch `main`, head
is the print and export commit. Tree clean; Vitest tests and `tsc` pass.

## Where we are

The abstract model is complete for the outline's v1 feature set and the
first visual slice is usable: you can draw, move, resize, type exact values,
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

- **Tool palette** (`panels/ToolPalette.tsx`): select, line, rectangle and
  circle as icons in a palette floating over the canvas, top left by
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
- **Tools**: select (V), line (L), rect (R), circle (C). Drawing a shape
  also adds its dimensions (rect: width and height; circle: diameter;
  line: length) and returns to select unless Shift is held. Shift
  constrains to square / 45°.
- **Pan/zoom**: wheel and pinch zoom at the cursor, as in SynFlo. Space
  or the middle button pans in any tool, and a finger pans the
  background; a mouse or pen no longer does (it lassoes). Pan and zoom
  are reducer delta actions so rapid events never read a stale view.
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
- **Snapping** (`canvas/snap.ts`): to other shapes' snap points within
  10 px, else to the drawn grid pitch. With grid snap off (`grid` null)
  free points and move deltas round only to 0.01 mm; shapes' snap points
  still apply. Moving snaps the moving shape's own points onto others.
  The status bar shows the snap type. Hovering with the select tool
  shows no position (`hoverShowsPosition`); moving, resizing and
  lassoing do. While a new shape is dragged out
  it shows its start and size instead of the pointer (`drawStatus` in
  `view/format.ts`: from x, y · w × h; centre · ⌀; from · length at angle).
- **Resize handles** on a single selection: rect corners (anchor opposite
  corner, flips across it), circle centre and radius, line ends.
- **No sidebar.** The selection gets one floating panel top right of the
  canvas (`panels/SelectionPanel.tsx`; which one is `panelFor` in
  `app/editor.ts`), scrolling if taller than the canvas, with Delete at
  the bottom.
- **Shape panel** (`panels/ShapeFields.tsx`): one shape selected, with any
  tool, so a just-drawn shape can be sized at once. x/y, each length with
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
  Open uses a file input. Extension `.delinya` (JSON; `.json` also
  opens). The tab title and the right end of the header show the file
  name and a • when dirty; the header adds the drawing's title in quotes
  (`quotedTitle`, left out when blank or the same) and clicking it opens
  Properties on the Drawing tab; New/Open ask before discarding (in-app dialog), and closing the
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
- **Questions and notices** (`app/ask.ts`, `panels/AskDialog.tsx`): the
  app's own confirm/alert, never the browser's. `ask({ title, message,
  confirm?, cancel?, danger? })` resolves true/false, `tell(title,
  message)` has only OK; module state (not React) so `file.ts` can use it,
  and questions queue, one shown at a time. The dialog sits above other
  dialogs, focuses its confirm button (red when `danger`), keeps Tab
  inside it, and while open swallows every key from a window capture
  listener registered at mount (Escape cancels, Enter/Space press the
  focused button), so no shortcut fires underneath. Clicking the backdrop
  cancels. Outside-click handlers (the layer card) ignore clicks while a
  question is up.
- **Keys**: ⌘Z / ⇧⌘Z (Ctrl+Y) undo/redo, Delete/Backspace, Escape to
  select and clear, ⌘P print/export. File keys work from inside a field:
  they blur it first so its value commits.

### Output (`src/output/`, all pure, fully tested)

- `drawingPrimitives(resolved)` turns the drawing into paths and text with
  roles (shape, dimension, furniture, guide) once; every format renders
  those. Text is measured with Helvetica metrics (`text.ts`) everywhere.
  Ink is per role in `STYLE.colour`: dimensions mid blue (`#3070c0`),
  everything else black. The canvas takes its `--dimension` colour from
  the same constant, so screen and paper match.
- `planPages` lays the drawing onto sheets at a scale: margins 10 mm, a
  30 mm footer band, tiles overlapping 10 mm and labelled A1, A2, … B1.
- `composePages` gives each sheet in paper mm: the drawing (clipped to
  the area), a 100 mm check ruler, overlap guides, and an 80 × 30 mm
  title block bottom right (title, author, revision, scale, sheet,
  notes; title falls back to the file name).
- `pageToSvg` (preview and print), `exportPdf` (hand-written PDF 1.4,
  standard Helvetica, no dependencies), `exportSvg` (1:1 mm) and
  `exportDxf` (R12, mm, y flipped, shapes only; rects become closed
  polylines with bulges so CAM gets whole contours).

### Layers

- **Model** (`model/layers.ts`, layer parts of `resolve.ts`/`types.ts`):
  `layer` entities `{ name?, order }`, nothing else. Position comes from
  a fractional `order` (lowest at the back, ties by ID), so
  `moveLayer` changes only the moved layer's order (midway between its new
  neighbours) and concurrent moves don't fight. A drawing with no layer
  entities has one implicit base layer at `BASE_LAYER_ID` (`"layer"`);
  actions that need it real (`addLayer`, `setLayerName`) materialise it
  in the same change, so a drawing only grows layer entities once layers
  are used. Shapes carry an optional `layer` prop; missing or dangling
  falls back to the base (else the first) layer. `resolved.layers` is
  back to front with 1-based `number`s; every resolved shape has `layer`;
  `resolved.order` is draw order (layer 1 at the back, document order
  within a layer).
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
  palette by default (`delinya.layerPalette`). A numbered button per
  layer, 1 at the top; the current layer is highlighted like the active
  tool; hidden layers' numbers are dimmed with an eye-off mark, locked
  ones get a lock mark. The tooltip (to the right) shows the name
  ("Layer N" if unnamed) and "· hidden, locked"; not while its card is
  open. Clicking makes the layer current and opens its
  card (click again, Escape or click outside closes it; Escape only
  closes the card): name field, hide/show, lock/unlock, and delete, which
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
  and the dialog says "Hidden layers are left out." when any are. DXF gets
  one layer per visible drawing layer, named after it ("Layer N" if
  unnamed, sanitised to R12's 31-character names, duplicates suffixed
  `_2`…).

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

UI to-do (requested 2026-11-10, in the order given):

10. Duplicate button in the selection panels, with direction and spacing.
11. ⌘D: immediate duplicate, stepped down and to the right.
12. "Delinya" in the header opens an About dialog with the version (text
    to come).
13. Rulers along the top and left edges of the canvas.
14. Small right-aligned "Delinya" watermark below the print title block.

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
