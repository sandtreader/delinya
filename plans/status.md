# Delinya — Status and Handoff

Last updated 2026-11-26. Repo `sandtreader/delinya`, branch `main`.
v1.1.1 (print: optional title block, default on, and check ruler,
default off) is committed and deployed to delinya.net, with its
documentation site at delinya.org
(`site/`; see Documentation site) and `CHANGELOG.md`. It builds on
v1.1.0 (per-layer fills and patterns, renaming variables), v1.0.0, the
first public release, v0.3.0
(collaboration: the Collaborate card with Start and Join session, share
links, other people's cursors; see Collaboration), v0.2.2 (line styles,
the corner radii "all" switch with "4× R" labels, radius labels inside
the curve, Rotate and Duplicate cards) and v0.2.1 (text boxes, fit view,
the Dimension tool). Vitest tests, `tsc` and the build pass.

## Where we are

The abstract model is complete for the outline's v1 feature set and the
first visual slice is usable: you can draw (lines, rectangles, circles and
paths of straight and curved segments), move, resize, edit path nodes, type exact values,
link equal values and equal spacing, put shapes on layers (with line
colours, see-through fills and patterns), undo,
save/load local files, print at
scale (tiled if needed, with a title block and optional check ruler) and export PDF,
SVG and DXF. Collaboration is SynFlo's: a Collaborate card from the
toolbar (the shared session panel), share links and other people's
cursors, through the relay at /collab.

## What is built

### Model (`src/model/`, all pure, fully tested)

- **Document** is `@sandtreader/collab`'s `DocState` (flat `{kind, props}`
  map). Kinds: `line`, `rect`, `circle`, `polyline`, `text` (see Text
  boxes), `variable`, `link.spacing`, `link.align`,
  `dimension`, `radius-label`, `layer`, and the singleton `document` (id
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
  `independent` breaks it into a cusp; a zero offset takes the handle
  off, a curve becoming a cusp keeping its other as drawn), `deletePolyNode`,
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
  `radius-clamped` issue shown in the shape panel. All four together
  (`model/corners.ts`): `cornersAlike` (the four stored radii the same,
  one number or one ref, a missing `r` all 0, and at most one radius
  label), `setAllCornerRadii` (the variable when all four share one, else
  all four the number; none for a negative or non-finite value),
  `joinCorners` (every corner the stored Length of the largest, so a
  variable stays linked; of any labels only the first corner's kept; one
  change, none when alike) and `toggleAllCornersLabel` (off takes every
  label off; on adds one at `ALL_CORNERS_LABEL_CORNER`, 2, bottom-right,
  clear of the width and height dimensions). `ResolvedRadiusLabel.count`
  is 4 when it is the rect's only radius label and all four effective
  (clamped) radii are equal, else 1; `radiusLabelText` (view/
  dimensionText.ts) reads "4× R10" or "R10" on screen and in output (×
  is WinAnsi 0xD7 in the PDF). Placement (`radiusLabelPlace`, same file,
  canvas and output alike): `ResolvedRadiusLabel` carries `at` (the arc
  midpoint, or the corner if sharp) and the rect's `rotation`; the text
  sits inside the curve, in from `at` by `RADIUS_LABEL_GAP` (0.3 em), in
  the rect's own frame so it turns with the rect: a left corner's starts
  there, a right corner's ends there (anchor end, right-aligned against
  the right-hand edge), a top corner's hangs below (gap + cap height
  `RADIUS_LABEL_CAP`, 0.7 em), a bottom corner's stands above. Kept
  readable as dimension text is (angle in [-90, 90)): turned past upright
  the text turns half round and the corner's role with it (top-left
  reads as bottom-right).
- **Rotation** (steps 1 and 2): a rect stores `rotation` (degrees, clockwise on
  screen like a line's angle, about its (x, y) corner; absent is 0, a bad
  value is 0 with a `bad-value` issue). Width, height and r stay its own
  sides and corners. `ResolvedRect.rotation` is in [0, 360); corners,
  arcs, path, snaps, dimension anchors and normals are turned (points
  snapped to 9 places, so quarter turns are exact and edges still meet
  their arcs), bounds come from the turned path, links move it whole.
  `model/rotate.ts`: `rotateShapes(state, ids, degrees, pivot?)` and
  `flipShapes(state, ids, axis, pivot?)` (pivot by default the centre of
  the shapes' bounds together) turn or mirror each shape as drawn and
  store a line's start and angle, a circle's centre, a path's nodes and
  handles, a rect's corner and rotation; a mirrored rect is a rect turned
  −r from the mirror of its old top-right (x) or bottom-left (y) corner,
  radii (as stored, refs kept) and radius labels' corners swapped to
  match. `setRotation(state, id, degrees)` spins a rect in place about
  its centre. `turnTo(base, ids, degrees, pivot)` is the live drag's
  version: `base` turned by `degrees`, all props absolute, and at 0 the
  turned props written back as `base` stores them (absent ones removed),
  so a drag can return to where it began. Angles are stored in [0, 360),
  numbers snapped, never -0; one Change per call. Circles and paths have
  no rotation of their own. A turned rect resizes in its own frame
  (`resizeTo` takes the pointer into it): corner handles on its turned
  corners, anchored opposite, sized along its sides, flipping across the
  anchor; the rotation stays. None while a link places it (its locks are
  on the page's axes). Grid snapping happens in the rect's own frame,
  from the anchor corner (`snapPoint`'s `frame`), so its sizes land on
  the grid; snaps to other shapes' points still win.
- **Text boxes** (stage 1: model and output; see the decision below):
  `text` kind, `TextProps { x, y, width, height, text, font?, bold?,
  italic?, align?, rotation?, mirror?, layer? }` (`TextAlign` "left" |
  "centre" | "right", `TEXT_ALIGNS`), sized and turned like a rect
  (width and height may be refs). `model/font.ts`: `FontStyle { family,
  bold, italic }`, `textAdvance(text, font, size)`, `wrapText(text, font,
  size, width)` (newlines first, an empty paragraph an empty line, then
  greedily at spaces, runs of spaces and tabs as one; a word wider than the
  width on a line of its own; "" is `[""]`), `LINE_SPACING` 1.2,
  `BASELINE` 0.9, `longestWord(text, font)` (the widest word's advance
  in em), `fitWidth(text, font, size, width)` (max(width, longestWord ×
  size): **a box is never narrower than its longest word**, so its lines
  align to that word's end rather than raggedly to a narrower box),
  `fitTextSize(text, font, width, height)` (wraps at fitWidth at each
  size tried: in em that is max(width / size, longest word), which never
  grows with the size, so lines never fall and the bisection holds),
  `standardFont`, `fontMetrics`, `winAnsiCode(ch)` (the PDF byte; defined
  for exactly the characters with widths: every WinAnsiEncoding
  character). `ResolvedText`: the box's `x, y, width,
  height, rotation, mirror` (`width` effective: fitWidth at its size, so
  wrapping, alignment, corners, path, bounds, snaps, handles, links and
  the typing field all use it; the stored width is only the panel's),
  `font` (bad values default to sans/false
  with a `bad-value` issue), `align` (absent or bad is left, bad with a
  `bad-value` issue), `text`, `size`, `lines` (`{ text, width, at }`:
  `at` the world point line i's baseline starts, local (o, (0.9 + 1.2i) ×
  size), or (width − o, …) mirrored, where o is 0 (left), spare / 2
  (centre) or spare (right), spare = max(0, width − line width), the line
  width its metric advance (wrapped lines carry no outer spaces); the
  clamp at 0 is now only an edge case (rounding), since the box widens to
  its longest word, but a line wider than the box would start at the left
  edge (the right when mirrored) whatever its alignment, as the CSS typing
  field does; turned with the box and snapped to 9
  places like a turned rect's; output draws each line start-anchored from
  `at`, so PDF and SVG follow alignment with no format of their own, and
  DXF adds its own justification, below), `corners`, `path` (the outline, for hit-
  testing and bounds only), `bounds`, snaps (corners, edge midpoints,
  centre). No dimensions. `model/text.ts`: `addText`, and `setText`,
  `setTextSize`, `setTextStyle(state, id, { font?, bold?, italic?,
  align? })` (only the parts that differ written), each keeping (or for
  setTextSize setting) the font size by rewriting the height to snap(lines
  at that size × 1.2 × size) through `setLength` (a linked height edits
  its variable), and first, if longestWord × size is wider than the
  stored width, writing that (snapped) as the width, also through
  `setLength`: the width only ever grows there, never shrinks, so the
  document and the panel's width field agree in normal editing; an
  align-only change writes just `align`, as it doesn't change the wrap;
  undefined for a non-text id or no change. `textBoxWidth(state, id,
  width, height?)`: the width a box sized so takes (the longest word at
  the size those give, if wider); `resizeTo` (upright or turned) and
  `dragHandle`'s locked path write it, so a corner dragged narrower than
  the word stops at it, the anchor corner staying put (the box grows away
  from it along its own x). `setTextWidth(state, id, width)` (the panel's
  width field): never narrower than the longest word, keeping the font
  size (height rewritten for the new wrap). `endTextEdit(state, id)`: deletes (`deleteEntity`) a box left
  empty or only whitespace, after typing into it. Moving, links, Duplicate, Equal (`EQUAL_PROPS` width/height),
  rotate, `setRotation` and corner resize handles (in its own frame when
  turned, none while a link places a turned one) all treat it like a rect;
  `flipShapes` mirrors its text (below). UI: the Text tool, canvas drawing
  and the panel's fields (see UI, Text boxes); the status bar reads "from
  x, y mm · w × h mm · text N mm [at r°]".
- **Dimensions** (`dimension`: target, prop width | height | diameter |
  length, offset mm). The **offset is signed**: positive stands off the
  near side, as before (a rect's top edge for width, its left for height,
  the top of a circle, a line's left as it runs); negative off the far
  side (`measure` in `resolve.ts`): a rect's width from its bottom edge
  (corners 3–2) and height from its right (1–2), turned with it; a
  circle's diameter below it (anchors (cx ± r, cy + r)); a line's is
  already signed by its normal (`lineNormal(angle)`, its left). So a
  dimension moved across its shape attaches to the other edge rather than
  drawing extension lines through it; the value still reads on the side
  away from the shape (`view/dimensionText.ts` needed no change).
  `placeDimension(shape, id, prop, offset)` is resolve's own placing,
  exported for the tool's preview. `model/dimensions.ts`:
  `dimensionProps(kind)` (rect: width, height; circle: diameter; line:
  length; else none); `dimensionOffsetAt(resolved, target, prop, point,
  step = 0.01)`, the signed offset a pointer gives (a rect in its own
  frame: pointer in the near half, max(distance out, 0); far half,
  −max(distance out, step), so it still says far; a circle by its top or
  bottom; a line by signed distance along its normal; magnitude rounded
  to the step, snapped, never −0; undefined if it can't measure that
  way); `dimensionTargetAt(resolved, point, tolerance, { hidden,
  locked }?)`, what the tool would measure: `{ kind: "dimension", target,
  prop } | { kind: "radius", target, corner } | null`, topmost visible
  unlocked shape first; a rect's rounded corner arc (`distanceToArc`,
  geometry) before its straight edges (top or bottom: width; sides:
  height; in its own frame), a circle's outline, a line; paths and text
  nothing. Actions: `toggleDimension(state, target, prop, newId, offset =
  DIMENSION_OFFSET)` removes every dimension of that target and prop, or
  with none adds one (undefined if it can't measure that way);
  `toggleRadiusLabel(state, target, corner, newId)` likewise (undefined
  for a non-rect; allowed on a sharp corner, which the model draws at the
  corner point); `setDimensionOffset(state, id, offset)` (undefined if not
  a dimension or no change); `dimensionsOf` / `radiusLabelsOf` list them.
  `DIMENSION_OFFSET` (10 mm) lives in `actions.ts` and is `addDimension`'s
  default. `deleteEntity` deletes one dimension or label on its own.
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
  `beginGesture()`/`endGesture()` for multi-entity drags; `gestureOpen`
  says one is open; `abandonGesture()` takes an open one back unrecorded:
  its inverses applied and emitted, no undo entry, redo untouched, dirty
  as before it; nothing without one). `markSaved()`
  and `dirty` track unsaved changes by history position, so undoing back
  to the saved point is clean again; remote changes and `replace` dirty
  it until the next `markSaved()`.
- **Files** (`file.ts`): `serializeDrawing` writes pretty JSON
  `{ format: "delinya", version: 1, doc }`; `parseDrawing` returns
  `{ ok, state } | { ok: false, error }` and never throws. It checks only
  the generic entity shape (resolve handles bad props), keeps unknown
  kinds, and refuses newer versions. Bump `FILE_VERSION` only when an
  older reader would misread a file.
- **Line styles** (`types.ts`, `lineStyle.ts`): lines, rects, circles and
  paths (not text) store optional `lineWidth` (a pen width on paper, mm:
  the same at any print scale, on screen at any zoom) and `lineDash`
  (`LineDash` "solid" | "dashed" | "dotted" | "dashdot", `LINE_DASHES`),
  absent meaning `DEFAULT_LINE_STYLE` { 0.35, solid }; `LINE_WIDTHS` are
  the ISO 128 pens offered (0.13 … 2). Resolve gives those shapes `style:
  LineStyle` (a bad width, not a positive number, or pattern is the
  default's with a `bad-value` issue each); `translateShape` keeps it.
  Patterns are ISO 128 in units u = max(width, `DASH_UNIT_MIN` 0.35), so
  thin lines still read as dashed: `dashLengths(dash, width)` as seen
  (dashed 12u dash 3u gap; dotted dots 3u apart; dash-dot 24u, 3u, dot,
  3u); `dashArray(dash, width)` is what SVG and PDF stroke with round
  caps (each dash shortened by the width, min 0, each gap lengthened by
  it; `roundCapArray(dash, unit, width)` for any units). Actions:
  `setLineStyle(state, ids, { width?, dash? })` on the stroked shapes
  among ids as one change (the default stored as nothing: the prop
  removed; undefined if nothing changes or the style is bad);
  `styleProps(style)` what a new shape stores (only what differs);
  `commonLineStyle(resolved, ids)` the stroked shapes' shared style, each
  part null where they differ, null with none. Splitting a path
  (`deletePolySegment`, `breakPolyNode`) gives the new part the old one's
  layer and style; turning, duplicating and joining (the first path's)
  keep them. Point-to-point measurements need no kind of their own: a line
  between snap points with its length dimension.

### Collaboration (`src/collab/`)

As SynFlo does it, on `@sandtreader/collab`. The app namespace is
`delinya`; identity (`delinya-userId`, `delinya-displayName`) is per
browser.

- **Core** (`collab/index.ts`, no MUI): `collabDocument(store, { replaced })`
  adapts the store (a snapshot or a peer's `state_replaced` goes through
  `store.replace`, clearing undo history, and calls `replaced("snapshot" |
  "state_replaced")`; other changes `applyRemote`); `bindCollab(store,
  client)` forwards emitted changes. `collabConfig(location)`: the relay
  at `ws(s)://<host>/collab` and share links `<origin>/s/<id>`.
  `joinCheck(confirm)`: the panel's `beforeJoin`, which starts a session
  of our own (`isNew`) at once and waits for `confirm()` before joining
  someone else's. `presenceSender(client, ms = 100)`: cursor at most every
  100 ms (first at once, latest at the end), selection on change, every
  message both (each replaces what the others hold). The client registers
  itself (`registerClient`); `sendCursor` (Canvas pointer moves, model mm;
  null on leaving), `sendSelection` (App, on change; flushed on joining),
  `sessionPeers()`, `useSessionView()` (status and others' count, for the
  toolbar) and `onSessionReplaced` work without loading the session.
- **Session** (`collab/session.tsx`, loaded by dynamic import only when
  the Collaborate card opens or a share link is followed, as it brings
  MUI): the client singleton, `SessionCard` (the package's `SessionPanel`
  with `beforeJoin={joinCheck(confirmBeforeJoin)}`, in an MUI theme of
  Delinya's font and accent), `SessionCursors` (`RemoteCursors`, absolute
  in a layer clipped to the drawing area, under the panels) and
  `autoJoin()`. The build puts it in its own chunk (~250 kB, 80 kB gzip;
  the main chunk has no MUI).
- **Starting and joining**: the panel (collab 0.1.4) fills its session
  field with a code it made up and reads "Start session" while that's
  there, "Join session" once another code is typed or pasted; its
  `beforeJoin(sessionId, isNew)` says which. Starting goes straight in
  (nobody else can be there; your drawing becomes the session's).
  Joining asks `confirmBeforeJoin()` (file.ts) first: with unsaved
  changes, "Save as…" (untitled) or "Save", or "Join anyway", or Cancel,
  since a session that already has a drawing replaces yours. A share link (`/s/<id>`) opens the card and
  joins at startup. A session's drawing arriving (the joining snapshot, or
  a peer's New or Open) detaches the file (`detachFile`: Untitled, no
  handle, clean, so Save can't write someone else's drawing over yours)
  and resets the editor as Open does (`useDrawingReset`), fitted; a
  rejoin after a dropped connection (a fresh snapshot without passing
  through disconnected) keeps the view and file. New and Open with others
  in the session ask first ("This replaces the drawing for everyone").
- `tests/collab.test.ts` runs two stores through the real relay (late
  joiner snapshot, linked edits, drag + undo); `tests/collabUi.test.ts`
  the core, the join check, the guards and the plumbing.

### UI (`src/canvas/`, `src/panels/`, `src/app/`, `src/view/`)

Vite 6, React 19, TypeScript, plain CSS. SVG canvas with a model-space
`<g transform>` layer. Editor state (tool, selection, view, cursor, snap,
grid show/snap) lives in a reducer and is never part of the document; the document is read
through `useSyncExternalStore`.

- **Tool palette** (`panels/ToolPalette.tsx`): select, line, rectangle,
  circle, path, text and dimension as icons, then the "Dimension new
  shapes" toggle, in a palette floating over the canvas, top left by
  default, dragged by its grip. Its position is per browser in
  localStorage (`delinya.toolPalette`, via `app/floatPosition.ts`), never
  in the document, and is kept on screen when the window shrinks. The
  position, grip drag and clamping are shared with the layer palette in
  `panels/floating.tsx` (`useFloating`, `Grip`); Reset view (in the
  status bar, beside the px/mm scale) resets zoom and pan and sends both
  palettes home (`sendPalettesHome`); Fit to drawing sits beside it (see
  Fit view). A full screen / window toggle sits
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
  (below by default; right in the palettes, above for the status bar's
  view buttons);
  `placeTip` flips it and keeps it in the window. A click, key, wheel or
  window blur hides it; nothing shows while a pointer button is held, so
  drags don't pop tips. Disabled buttons still show theirs. The bubble
  is aria-hidden: `tip()` (`panels/tip.ts`) sets the same text as the
  element's `aria-description` all the time, unless it is just its name,
  so screen readers get it on focus without waiting.
- **Fit view to drawing**: the view showing everything visible (shapes on
  shown layers, their dimensions' lines and radius labels' points;
  `drawingExtent`, `view/fit.ts`) as large as the canvas allows, with
  `FIT_PAD_PX` (40) clear all round, centred, within the zoom limits
  (`fitView`, `view/viewport.ts`, pure). A line along an axis fits by its
  length; a point keeps the default scale, centred; a canvas under 160 px
  across keeps a quarter of it as padding each side; nothing visible gives
  the default view. Asked for by opening a file (after its layers are
  reset; New still resets to the default view), the status bar's Fit to
  drawing button and F: each bumps `EditorState.fitRequest`, and the
  canvas, which knows its size, answers each new count with a `view`
  (waiting for a size if it has none yet).
- **Tools**: select (V), line (L), rect (R), circle (C), path (P), text
  (T), dimension (D). Drawing a shape also adds its dimensions (rect: width and height;
  circle: diameter; line: length; path and text: none), while this
  viewer's "Dimension new shapes" is on (below), and returns to
  select unless Shift is held. Shift constrains to square / 45° (for the
  path tool it makes a curve node instead; for text it does nothing, and
  text always returns to select). The path and text tools' tooltips say
  how they work.
- **Dimension tool** (D; `Canvas.tsx`, tool "dimension"): hovering
  highlights what `dimensionTargetAt` finds within 6 px (`DIM_PX`): the
  straight part of the rect edge nearer the pointer, a circle's outline, a
  line, or a rounded corner's arc (`view/dimensionTarget.ts`
  `targetPath`), with a pointer cursor; the status bar says what it would
  measure ("width 150 mm"; a corner: "top-left corner R20 mm · click to
  label it" or "remove its label"; `dimensionStatus` in `view/format.ts`,
  via editor `dimension` set by the `pointer` action). A press on an edge,
  outline or line starts a dimension of that prop following the pointer
  (offset from `dimensionOffsetAt`, the grid step when grid snapping is
  on, else 0.01 mm), drawn dashed in the select colour, the status bar
  reading "… · offset 25 mm, far side"; if the shape already has that
  dimension, it is picked up instead and moved live (`setDimensionOffset`
  in one `beginGesture()`). Press-drag-release places it on the release;
  a click leaves it following until the next click. Placing a new one
  commits `addDimension` (one step). Escape (capture listener, so the
  app's Escape doesn't run) cancels: a new one is never added, a moved one
  goes back (`abandonGesture()`); so does a change of tool or hiding
  dimensions. A press on a rounded corner commits `toggleRadiusLabel`
  (adds, or removes the one there). The tool stays selected, for placing
  several. Picking it turns Show dimensions on (it would place them
  unseen otherwise); with them off it does nothing. Not blocked by a
  hidden or locked current layer (dimensions aren't on layers), but it
  ignores shapes on hidden or locked layers.
- **Dimensions and radius labels with the select tool**: clickable
  (a wide transparent stroke along a dimension's line and a box over its
  value, a box over a label's "R…"; `data-label`, only on shapes that can
  be selected; still click-through with other tools). A click selects it
  (editor `label`, action `selectLabel`: one at a time, clearing the shape
  selection; cleared by `select`, `toggleSelect`, a change of tool,
  hiding dimensions, and when it goes or its shape's layer is hidden or
  locked) and draws it in the select colour; hover tints it. Dragging a
  dimension moves it (`setDimensionOffset` live in one gesture, one undo
  step), keeping the grabbed point under the pointer, across the shape to
  flip sides; Escape mid-drag puts it back. Delete/Backspace deletes the
  selected one (App keys, `deleteEntity`); Escape deselects. The "= name"
  link on a value still opens its link popup (`linkTargetAt` runs before
  the label hit); handles, path nodes and the rotate handle are checked
  before labels, so labels never take their presses.
- **Dimension settings** (`app/labelView.ts`, like `gridView.ts`):
  `LabelView { autoDimension, show }`, `DEFAULT_LABEL_VIEW` both on,
  `loadLabelView`/`saveLabelView` under localStorage `delinya.labels`
  (junk or missing parts fall back); editor `labels`, loaded at start and
  saved on change in `App`, action `{ type: "labels", labels }`. Per
  viewer, never in the document. "Dimension new shapes" is a toggle in its
  own group of the top toolbar, after Undo/Redo (`AutoDimensionIcon`: a
  rect with a dimension above, struck through when off; `aria-pressed`,
  tinted while on); off, drawing adds no dimensions. "Show dimensions" is a toggle in the status bar beside the
  view buttons (`DimensionsIcon`, struck through when off): off, no
  dimensions or radius labels are drawn or can be picked on screen.
  Print and export keep their own dimensions option. The layer palette's
  home is (10, 279), below the tool palette (259 px with the Dimension
  tool).
- **Line styles** (UI): the top toolbar's "Line style" group, after
  "Dimension new shapes": four pattern buttons (`LineDashIcon`: solid,
  dashed, dotted, dash-dot; tinted and `aria-pressed` for the one shown)
  and a pen width `<select>` ("0.35 mm"…; a width outside `LINE_WIDTHS`
  still listed; "mixed" when the selection differs). It shows
  `commonLineStyle` of the selection when that has lines, rects, circles
  or paths, else the viewer's current style. A choice sets the current
  style (editor `lineStyle`, action `{ type: "lineStyle", style }`;
  `app/lineStylePref.ts` `loadLineStyle`/`saveLineStyle` under
  localStorage `delinya.lineStyle`, each part falling back to the
  default; loaded at start and saved on change in `App`) and restyles the
  selected stroked shapes, one undo step per choice. Lines, rects, circles
  and paths drawn take `styleProps` of the current style (a path's as it
  is when finished). The canvas strokes each at its paper width at 96 px
  to the inch whatever the zoom (`view/lineScreen.ts`:
  `SCREEN_PX_PER_MM`, `screenLineWidth` at least 1 px, `screenDashArray`
  in px with the round-cap rule at the drawn width; × `hair` for world
  units), 0.8 px thicker when selected, hit area max(12, width + 8) px;
  locked layers' shapes too. Previews and text are as before.
- **Text boxes** (UI): the Text tool drags out a box like the rectangle
  tool (dashed preview; `newTextProps(start, current, layer)` in
  `view/textSvg.ts`: empty, sans, sized as a rect; nothing if no width or
  height) and the status bar reads "from x, y mm · w × h mm · text N mm",
  N the size one line of that height gives (height / 1.2). Releasing adds
  the box (no dimensions) inside a `beginGesture()` left open, selects it,
  returns to select and starts typing into it on the drawing (`editText`
  with `fresh: true`; below), which joins that gesture. (Drawing on a
  hidden or locked layer is blocked; should the box not be editable after
  all, the gesture just ends.)
- **Typing on the drawing**: editor `editText` (action `editText`, never in
  the document) names the box being typed into; it clears when the
  selection becomes anything but that box, on a toggle of the selection,
  and when the tool changes. It starts after drawing a box, on a
  double-click of a box with the select tool (before the path's
  double-click, which still adds nodes), and on Enter or F2 with one text
  box selected (App's keys; back to select; preventDefault, so no newline;
  a path being drawn keeps its Enter). While the box is shown and not
  locked, `canvas/TextEditor.tsx` lays a `<textarea>` over it, in the
  canvas area (a sibling of the SVG, same screen px; `.text-editor-clip`
  clips it to the area): `textEditorBox(t, view)` (`view/textEdit.ts`,
  pure) gives left/top (the box's (x, y) on screen), width and height ×
  scale, `rotate(r deg)` about its top left, the font stack, size × scale,
  `line-height` LINE_SPACING, bold, italic and `textAlign` (CSS "left",
  "center", "right"). Never mirrored, so it reads while typed: a mirrored
  box's field aligns as stored (right stays right), not as drawn. Transparent, no border, padding or resize, `overflow:
  hidden`, `pre-wrap` with `overflow-wrap`/`word-break: normal` (a long
  word runs on, as the model's wrap). Ink is the shape's (layer colour or
  `--shape`), caret too. It is shifted up by `translateY` so its first
  baseline lands at the model's BASELINE × size: the browser's own ascent
  and descent (canvas `measureText` font box, cached per font) centred in
  the 1.2 line; on screen it matches the SVG text to within about 1 px
  (exact at 50 px Helvetica and Times, 1 px at 12 px Courier). It follows
  zoom and pan (re-rendered from the view); a wheel over it zooms as over
  the canvas. While editing, the box's SVG text isn't drawn, its dashed
  outline is. The field takes focus (caret at the end; an empty box all
  selected) and each input commits `setText` live inside one gesture, as
  the panel's field (`app/liveText.ts` `useLiveText`, shared by both), so
  the box grows as you type and the edit is one undo step (its first
  change joins a gesture already open rather than beginning another; the
  field on the drawing passes `endOnUnmount: false`, as its `finish` ends
  the edit itself); the app's keys
  ignore it as any textarea. Escape (which here keeps the text, unlike the
  panel's), ⌘/Ctrl+Enter and leaving it (a press elsewhere on the canvas,
  which then selects or clears as usual; any other control) finish.
  `endTextEdit(state, id)` (`model/text.ts`: the `deleteEntity` change for
  a text box whose text is empty or only whitespace, else undefined) says
  whether the box goes. Undo: a box just drawn (editor `editFresh`, set by
  `editText` with `fresh`, false whenever `editText` clears) and left
  empty is taken back with `abandonGesture()` (live `join()` at mount,
  `abandon()`), so it leaves nothing in the drawing, the history or the
  unsaved mark; an existing box emptied is deleted inside the edit's
  gesture (`endWith(change)`, opening one if nothing was typed), so one
  undo brings it back with its text; drawing a box and typing into it is
  one step; otherwise the gesture just ends. A deleted box drops from the
  selection, then `editText` clears. Should undo come mid-edit (the app's
  keys ignore the field, and pressing the toolbar's button blurs it first),
  `undo()` closes the gesture into an entry and undoes it, so the box goes
  and the edit ends with no gesture left open. Pressing the toolbar's Undo
  on a box just drawn and still empty abandons it on the blur; the button
  notes `store.abandoned` (a count `abandonGesture()` bumps when it takes
  one back) at its pointerdown, and if that has changed by the click, the
  click undoes nothing more (a keyboard click, `detail` 0, undoes as
  usual). Redo needs no guard: drawing the box emptied the redo stack. The window
  losing focus is not leaving it. If the editor drops it without a blur
  (tool or selection change from elsewhere), the field's unmount finishes
  the same way (checked a microtask later, as StrictMode remounts at
  once). Its own pointer presses don't reach the canvas. The panel's
  field still works alongside; both read the document. Caveat: while
  typing, the field wraps with the viewer's real font, while the finished
  text wraps (and the box grows) by the Adobe metrics, so a line can
  break differently until you finish, or the field clip a last line; and,
  centred or right-aligned, spaces the model drops (leading, trailing,
  doubled) shift a line in the field until you finish. The box (and so
  the field) widens to its longest word as you type it, so a word wider
  than the box is left only where the viewer's font is wider than the
  metrics; it then starts at the left edge, whatever the alignment.
  The canvas draws each non-empty line as a `<text>` in model mm with
  `textElementAttrs` (the SVG export's attributes, hyphenated names made
  camelCase for React), filled with the layer colour or `--shape`
  (`.text-lines`; hover tints it `--select` as strokes; no pointer events,
  no DOM selection). The `<g data-id>` is as other shapes', its hit path a
  transparent *filled* box (`hit area`, `pointer-events: all`), so a click
  anywhere inside selects it. The outline is drawn thin and dashed only
  while selected, being typed into, or when the text is empty. On a locked layer it draws
  inert like other shapes.
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
  draggable). A handle dropped on its node comes off (the corner is
  sharp that side; a smooth node becomes a corner); only on release,
  so passing over the node mid-drag changes nothing. **Alt-drag a node**
  selects it and, past 3 px, pulls out a handle it lacks: `pullHandleSide`
  (`canvas/polyEdit.ts`) picks a corner's side with a segment but no
  handle (or a zero-length one), with both missing the one whose
  neighbour lies more the way the drag heads; the drag then turns into a
  handle drag on that side (`independent`; one gesture). A smooth node,
  or a corner missing none, moves as usual. **Segments**: a click on the selected path away from its
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
  (aria-labels; tooltips explain each, the corner one taking a handle
  off and pulling one out, the smooth one Alt-drag; `setPolyNodeType`), **Join** (chain; only on an open path's
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
  drawing, turning, dragging, selection, pointer.
- **Resize handles** on a single selection: rect corners (anchor opposite
  corner, flips across it), circle centre and radius, line ends. A turned
  rect's sit on its turned corners, cursors along the turned diagonals,
  snapping to the grid in its own frame from the anchor (sizes on the
  grid; other shapes' snap points still win); none if a link places it.
- **No sidebar.** The selection gets one floating panel top right of the
  canvas (`panels/SelectionPanel.tsx`; which one is `panelFor` in
  `app/editor.ts`), scrolling if taller than the canvas, with Delete at
  the bottom.
- **Shape panel** (`panels/ShapeFields.tsx`): one shape selected, with any
  tool, so a just-drawn shape can be sized at once. A path ("Path") shows
  its node count, a Closed checkbox (`setPolyClosed`; disabled below 3
  nodes) and, with the select tool, a hint on editing nodes and segments; no size
  fields. A text box ("Text"): **text**, a textarea committing `setText`
  as you type (`useLiveText`, shared with the field on the drawing: the
  first change opens `beginGesture()`, blur closes it, so the canvas
  follows and the edit is one undo step; an unmount mid-edit closes it
  too; Escape commits the text it had on focus, inside the
  gesture, then blurs; Enter is a newline; the app's keys ignore it as
  they do any textarea); **font** Sans / Serif / Mono (`.icon-toggle`,
  `setTextStyle`); **size** (mm, 2 decimals, `setTextSize`); **style**
  Bold / Italic toggles (`setTextStyle`); **align** Left / Centre / Right
  (`.icon-toggle` of `IconButton`s with `TextAlignIcon`, line stacks from
  `panels/icons.tsx`, tooltips via `tip()`; `setTextStyle({ align })`);
  x, y, width, height and
  rotation as a rect's; **mirrored**, a checkbox committing `{ mirror }`
  in place. Other shapes: x/y, each length with
  a linked badge and unlink, a rect's rotation (°, `setRotation`, so it
  spins about its centre), a **dimensions** row (rect, circle and line)
  with a checkbox per measurable prop (rect width and height, circle
  diameter, line length), ticked while the shape has that dimension,
  toggling it (`toggleDimension`, `newId("dim")`), corner radii with an
  **all** switch in the legend (default on; the panel's state, not the
  drawing's, reset per shape: one "radius" field and one **label**
  checkbox for all four while `cornersAlike`, the label "4× R…"; off, or
  whenever the corners aren't alike, a row per corner; switching it on
  commits `joinCorners`), a clamped indicator and a small **label**
  checkbox per corner on the field's line (the radius field narrowed to
  fit) (`toggleRadiusLabel`, `newId("radius")`; disabled while the corner
  is sharp, unless it has a label to take off; each radius field is named
  by `Num`'s `label`, as the row is a div, not a label),
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
- **Collaborate** (`panels/CollabButton.tsx`): a toolbar button between
  Properties and Print opening a card (`PopCard`, as Rotate and Duplicate
  but needing no selection; editor `collab`) with the session panel:
  display name, session ID and Join, then the share link (copy, QR code),
  status, members and Leave session. It loads with the card ("Loading…"
  meanwhile). A dot on the button while in a session: green connected,
  amber connecting or joining. Presses in an MUI dialog it opens (the QR
  code) don't close the card, and Escape there closes only the dialog.
  Other people's cursors (a dot and their name) show over the drawing
  while in a session.
- **Rotate and Duplicate cards** (`panels/ActionCards.tsx`): toolbar
  buttons "Rotate…" and "Duplicate…" in a group after Undo/Redo, disabled
  with no shapes selected, each dropping a small card below it
  (`CardButton`; editor `card`, one at a time, pressed while open, nudged
  left to stay in the window). The card acts on the selection's shapes,
  whatever the tool. It stays open while there is a selection (turn or
  copy again, or pick other shapes on the drawing: presses on the canvas
  don't close it) and closes on Escape (from a field, after the field has
  reverted an edit; from elsewhere, only the card, keeping the selection),
  its button again, a press anywhere else, or the selection emptying (the
  reducer: `select []`, toggling the last off, selecting a label). The
  selection panel keeps the shape fields or Arrange, and Delete.
- **Rotate** (card): "Rotate" by a
  typed angle (default 15°, kept while the app is open, not saved), and icons for 90°
  anticlockwise and clockwise, flip horizontally and vertically
  (`rotateShapes`/`flipShapes` about the selection's centre; one undo
  step). The status bar adds "at N°" for a turned rect.
- **Rotate handle**: with select, a selection all on visible, unlocked
  layers gets a circle on a stem `ROTATE_HANDLE_PX` (24) screen px above
  the top centre of its bounds (`view/rotateHandle.ts`,
  `rotateHandleSpot`), rising above any of the selection's dimensions
  crossing its column (within `LABEL_CLEAR_PX`, 16 px, either side) with
  that much room kept for their text, so it never hides one; shown with the
  resize handles or path nodes. Dragging it turns the selection about the
  centre of its bounds at the press, by the angle swept (`dragTurn`:
  whole degrees, Shift 15° steps, the short way round), committing
  `turnTo` from the document at the press on each change; one undo step,
  no snapping, a cross at the pivot. The status bar reads "turn N°
  clockwise/anticlockwise" (editor `turn`).
- **Duplicate** (card): direction toggles
  (→ ↓ ← ↑), a count (× 1–100, under the button) and a gap in mm (editor
  state `duplicate`, default one copy right, 10 mm, unlinked, not saved). The copy
  sits beside the selection's bounds, the gap clear of it
  (`duplicateOffset`); N copies make a row, copy k at k steps
  (`duplicateBeside`). Three checkboxes link the row: "gaps" (2+ copies) adds
  a gaps spacing link per shape, the shape and its last copy as anchors and
  the copies between as items; "size" puts each shape's plain sizes
  (`EQUAL_PROPS`: width/height, diameter, length) and its copies' on a new
  variable per size, named "width", "width 2"… (renameable afterwards,
  see Properties below); a size already on a variable is left shared;
  "align" adds an align link per shape (anchor the shape, items its
  copies, mode start across the row: tops for a row, left edges for a
  column; other axis from gaps, so no clash). All in the
  same batch, nothing moves. The
  copies become the selection, so pressing again carries on the row.
  `duplicateShapes` (`model/duplicate.ts`)
  copies shapes at their drawn position (link-derived positions copied as
  drawn, links not copied), keeps sizes' variable refs, radii and layer,
  and copies their dimensions and radius labels; one batch, one undo.
- **Properties…** (header, before Print / Export;
  `panels/PropertiesDialog.tsx`): a fixed-width dialog with tabs
  (Drawing | Grid | Variables; an ARIA tablist, Left/Right/Home/End move
  between tabs, roving tabindex; component state, Drawing first). Drawing:
  title, author, revision, notes, printed in the title block. Grid:
  spacing (mm, the drawing's), Show grid and Snap to grid (yours, this
  browser). Variables: a row each, name and value both editable. A
  variable is renamed wherever its name shows (here, and the `= name` field
  beside a linked length or radius in the shape panel), through
  `renameVariable` (trimmed; refuses empty, unchanged or another
  variable's name; links follow by id; `VariableName` in `fields.tsx`).
  Panels stay mounted (hidden) and share a min-height, so the dialog
  doesn't jump between tabs. Fields commit on blur, so closing or
  switching tab blurs first. Field widgets shared with the shape panel are
  in `panels/fields.tsx`; `Num` and `Text` take an optional `valid` check
  and revert text it refuses, and a `label` (aria-label).
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
  Loading clears selection, returns to select and resets hidden and
  locked layers; Open then fits the view to the drawing, New resets it.
- **Print / Export** (`panels/OutputDialog.tsx`, ⌘P): paper (A0–A4,
  Letter, Legal, Tabloid), orientation (auto picks fewer sheets), scale
  (2:1 … 1:100, Fit = largest that fits one sheet), dimensions on/off,
  title block (default on), 100 mm check ruler (default off), live
  preview of every sheet. Print uses `window.print()` on true-size
  page SVGs with an `@page` rule (`app/print.ts`); Download PDF writes the
  same pages. SVG and DXF download at 1:1 mm. Paper, orientation and the
  three checkboxes are remembered in localStorage (`delinya.output`);
  scale only for the session.
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
  dimension or radius label; a selected
  path node or segment, else the selection; while drawing a path, its
  last node), Escape (a dimension being placed or dragged goes back; a
  selected path node or segment first; while
  drawing a path, finishes it;
  else back to select and clear, which deselects a label too), V/L/R/C/P/T/D tools, F fit view to the
  drawing (not with Shift or Alt), ⌘P print/export, ⌘D one copy of the selection in
  the Duplicate card's direction and gap (always one, unlinked, whatever
  its count and links; via `duplicateBeside`), selecting it so repeating
  carries on the row. File keys and ⌘D
  work from inside a field: they blur it first so its value commits.

### Output (`src/output/`, all pure, fully tested)

- `drawingPrimitives(resolved)` turns the drawing into paths and text with
  roles (shape, dimension, furniture, guide), and layer fills (see Layers),
  once; every format renders those. Labels are measured with Helvetica metrics (`text.ts`, from
  `model/fontMetrics.ts`) everywhere; text boxes with their own font's.
  Ink is per role in `STYLE.colour`: dimensions mid blue (`#3070c0`),
  everything else black, unless a primitive carries its own `colour`
  (shapes on a coloured layer; see Layers). The canvas takes its
  `--dimension` colour from the same constant, so screen and paper match.
- `planPages` lays the drawing onto sheets at a scale: margins 10 mm, a
  footer band (`footer`, 30 mm by default), tiles overlapping 10 mm and
  labelled A1, A2, … B1.
- `composePages` gives each sheet in paper mm: the drawing (clipped to
  the area), overlap guides, and in the 30 mm footer band an optional
  100 mm check ruler bottom left (`PrintOptions.ruler`) and an optional
  80 × 30 mm title block bottom right (`titleBlock`: title, author,
  revision, scale, sheet, notes; title falls back to the file name).
  With both off there is no band and the drawing area reaches the bottom
  margin. With the block, a small 2 mm "Delinya" sits right-aligned just
  below it, in the page margin; without the block there's no "Delinya",
  and tiled sheets get "Sheet A2 (2 of 3)" at the bottom left of the margin.
- `pageToSvg` (preview and print), `exportPdf` (hand-written PDF 1.4,
  standard Helvetica, no dependencies), `exportSvg` (1:1 mm) and
  `exportDxf` (R12, mm, y flipped, shapes only; rects become closed
  polylines with bulges so CAM gets whole contours).
- **Text boxes in output**: `drawingPrimitives` gives a box one `TextPrim`
  per non-empty line (role shape, the layer's colour if any, `at`,
  `angle` = rotation, anchor start, the box's size, plus `font`, `mirror`
  and `width`, the line's metric advance) and no outline path;
  `primitivesBounds` uses `width` and the font's ascender/descender, back
  from `at` when mirrored; compose scales `width` with the rest. PDF: a
  font resource per standard font used (`/F1` Helvetica always, for the
  labels; others `/F<n>` by their place in `STANDARD_FONTS`, each a
  `/Type1` WinAnsi dict, objects after the pages), the line's font
  selected per text, mirrored by negating the text matrix's x column.
  SVG: each line's `<text>` takes its attributes from
  `view/textSvg.ts` `textElementAttrs` (shared with the canvas):
  `font-family` a portable stack (`fontStack`: Helvetica, Arial,
  Liberation Sans, Nimbus Sans; Times New Roman, Times, Liberation Serif,
  Nimbus Roman; Courier New, Courier, Liberation Mono, Nimbus Mono PS),
  `font-weight`/`font-style` when set, `textLength` + `lengthAdjust=
  "spacing"` so a substitute font fills the metric width, and `transform=
  "translate(x y) rotate(a) scale(-1 1)"` (rotate and scale only when
  needed); labels unchanged. DXF: a `TEXT` per line on the shape's layer
  (STANDARD style, insertion point 10/20 the baseline's start `at`, y
  flipped; height the font's cap height × size; angle negated like the
  rest; 71 = 2, backward, when mirrored; centred or right-aligned lines
  also 72 = 1 or 2 with the alignment point 11/21 at the baseline's middle
  or end, measured from `at` along the way the line reads (the box's +x,
  −x when mirrored), so a reader whose font differs from the Adobe metrics
  still centres or right-aligns it; a line wider than its box (now only
  a rounding edge case, the box widening to its longest word), drawn from
  the box's edge, keeps the codes about where it is drawn; left lines have
  no 72/11; "%" as "%%%", ° and ± as %%d/%%p, other non-ASCII as
  `\U+XXXX`), never the outline. `output/text.ts` labels now measure
  with the same Helvetica table (unchanged widths).
- **Line styles in output**: a shape's `PathPrim` carries `line` (its
  `LineStyle`) when it isn't the default; compose passes it through
  unscaled (paper widths). `strokeOf(prim)` (`style.ts`) gives width and
  round-cap dash array: the shape's, else the role's width, dashed only
  for guides. SVG writes `stroke-width` and `stroke-dasharray`; PDF sets
  `w` and `d` only when they change (the state holds the array as
  written, so guides' dashes still work). DXF (R12 has no line widths;
  group 39 is extrusion, not a pen) defines a linetype for each pattern
  used, DASHED, DOTTED, DASHDOT, in the LTYPE table at 0.35 mm's lengths
  (72 = 65, 73 count, 40 total, 49 each: dash +, gap −, dot 0), and names
  it (6) on the shape's LINE, CIRCLE, ARC or POLYLINE; solid names none,
  so is the layer's CONTINUOUS. Widths are left out.
- Dimension text (output and canvas, both via `view/dimensionText.ts`)
  runs along its line turned to read left to right (vertical reads bottom
  to top), on the side away from the shape, so a turned rect's or any
  line's dimension reads the right way up.

### Layers

- **Model** (`model/layers.ts`, layer parts of `resolve.ts`/`types.ts`):
  `layer` entities `{ name?, order, colour?, fill?, hatch? }`, nothing else. Position comes from
  a fractional `order` (lowest at the back, ties by ID), so
  `moveLayer` changes only the moved layer's order (midway between its new
  neighbours) and concurrent moves don't fight. A drawing with no layer
  entities has one implicit base layer at `BASE_LAYER_ID` (`"layer"`);
  actions that need it real (`addLayer`, `setLayerName`,
  `setLayerColour`, `setLayerFill`, `setLayerHatch`) materialise it
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
- **Fills**: like line
  colour, a layer's, in the document. `fill` (`"#rrggbb"`) and/or `hatch`
  (`HatchPattern`: `"dots" | "grid" | "lines" | "crosshatch"`,
  `HATCH_PATTERNS` with names, `isHatchPattern`) on the layer entity;
  `setLayerFill` / `setLayerHatch` as `setLayerColour` (null clears).
  `ResolvedLayer.fill` / `.hatch` (null for none; bad values null with a
  `bad-value` issue). `LAYER_FILLS`: None, Grey `#a0a0a0`, Pink `#ff8fa3`,
  Sand `#e8c07a`, Lemon `#ffe066`, Mint `#7fd9a8`, Sky `#7fbfff`, Lilac
  `#b89cf0`, always drawn at `FILL_OPACITY` 0.35, so very light pastels on
  paper. `isFillable`: rects, circles, closed paths. Output: per layer, back
  to front, `drawingPrimitives` emits a `FillPrim { path, fill?, hatch?,
  colour? }` (colour = the layer's ink, with a pattern) per visible
  fillable shape before the layer's strokes, so a layer's fills cover the
  layers behind but not its own lines. Patterns (`output/hatch.ts`):
  `hatchMarks(bounds, pattern)` on a lattice anchored at the origin,
  `HATCH_SPACING` 2.5, lines 0.18, dots 0.4 (paper mm); `hatchTile` the
  same as one repeating tile (side, path data, filled or stroked). SVG:
  colour path with `fill-opacity`, pattern as a `<pattern>` of
  `hatchTile` (opaque, faded once). PDF: an ExtGState `/GS1` (`/CA` `/ca`
  0.35, only on pages with fills), colour `f`, pattern clipped (`W n`)
  with the marks over the part of the shape's bounds on the page. DXF
  leaves fills out. `layerRuns(r, hidden)` (model) groups the visible
  shapes by layer, back to front, with each run's `filled` shapes; the
  output and the canvas both draw from it.
  **Canvas**: per layer, a `.shape-fills` group (each shape's colour path, then
  pattern path, at `FILL_OPACITY`) before the layer's ShapeViews. Patterns
  are `<pattern>`s of `hatchTile` in user space (model origin), one per
  pattern and ink (`canvas-hatch-<pattern>-<rrggbb|default>`; default ink
  `var(--shape)`), `patternTransform="scale(SCREEN_PX_PER_MM·hair)"` so
  they are a fixed size on screen at any zoom, as line widths are (lines
  never under 1 px). **Picking**: with the select tool a filled shape is
  picked anywhere inside (each fill `<g class="shape-fill" data-id>`,
  `pointer-events: fill`; none with other tools or on a locked layer).
  Within a layer, fills are behind all its lines and sorted largest
  first, so a shape inside another (a hole in a panel) can still be
  picked; a front layer's fill beats a back layer's outline. Hovering a
  fill highlights its outline (`fillHover` state, `.shape.hover`, since
  CSS `:hover` can't reach a sibling group). A link guide under a fill
  is still clickable (`linkUnderFill`: `elementsFromPoint` past the
  fills, stopping at any shape's line). Lasso, the Dimension tool and
  path editing are geometric, so unaffected.
  **Layer card**: the line-colour swatch became the layer's look
  button (`LookControl`): its chip is a square outlined in the line
  colour, filled with the fill as on paper and the pattern; label and
  tooltip "Layer look: Navy line, Sky fill, Lines pattern" ("no fill",
  "no pattern"). It opens a picker under the card, as wide as it, with
  three labelled rows (a label column, then the swatches in one row
  each): Line colour (`LAYER_COLOURS`), Fill (`LAYER_FILLS`, shown at
  `FILL_OPACITY` over white; None a struck-through chip) and Pattern
  (None, then `HATCH_PATTERNS` drawn small with `hatchMarks` in the
  layer's ink), groups `aria-label`led, swatches `aria-pressed`
  (`FillPicker` is the Fill and Pattern rows). A choice commits at once
  and the picker stays open, so all three can be set; it opens focused on
  the current line colour; Escape closes just the picker (focus back on
  the button), a press elsewhere closes it.
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
  palette by default (`delinya.layerPalette`, home y 245 now the tool
  palette has six tools; a stored position is kept). A numbered button per
  layer, 1 at the top; the current layer is highlighted like the active
  tool; hidden layers' numbers are dimmed with an eye-off mark, locked
  ones get a lock mark; a coloured layer has a thin bar in its colour
  down the button's left edge (dimmed when hidden). The tooltip (to the right) shows the name
  ("Layer N" if unnamed) and "· hidden, locked"; not while its card is
  open. Clicking makes the layer current and opens its
  card (click again, Escape or click outside closes it; Escape only
  closes the card): name field, look (line colour, fill and pattern; see
  Fills), hide/show, lock/unlock, and delete. Delete
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

### Documentation site (`site/`, delinya.org)

An Astro site on synflo.org's pattern: Astroship landing pages (home,
changelog, 404; `src/pages/`, `src/components/`; the Astroship-derived
parts stay GPL-3.0, `site/NOTICE.md` and `site/LICENSE-astroship`) and
Starlight docs under `/docs`
(`src/content/docs/docs/`), Tailwind 4, astro-icon (bx), sitemap. Same
dependency ranges as SynFlo's site (Astro 5, Starlight 0.30), without its
reference generator and screenshot scripts.

- **Its own package**: `site/package.json` and `site/pnpm-lock.yaml`
  (install inside `site/`), no pnpm workspace, so the app's install, `tsc`
  (its `include` is src, tests, vite.config) and Vite build never see it.
  Root scripts: `dev:site`, `build:site`, `publish:site`.
- **Look**: light like the app: paper background, the app's accent
  `#0b6e99`, Inter (close to the app's system-ui). The docs are light
  only: `src/components/starlight/ThemeProvider.astro` sets light and
  `ThemeSelect.astro` renders nothing (overrides in `astro.config.mjs`);
  `src/styles/starlight.css` sets the accent and greys. Logo and favicon
  are the app's `public/favicon.svg` (copied; a test checks they match).
  The hero (`src/assets/hero.png`) is a 2× screenshot of the app (a
  350 × 90 plate with R20 corners, eleven evenly spaced hatched holes
  linked to `d`, and "Delinya" in text above), with the window's rounded
  corners and bottom border cleaned off; `public/opengraph.png` is its top
  1200 × 630 crop.
- **Docs**: Introduction, Getting started, then autogenerated Guide
  (drawing shapes, paths, text, selecting and editing, dimensions, links,
  layers, line styles, rotate and duplicate, files, printing and export,
  collaboration), How-to (full-size template, laser/CNC export, evenly
  spaced holes, drawing together) and Reference (keyboard shortcuts, file
  format), ordered by `sidebar.order`. Written against the code: keep them
  in step when features change. `tests/site.test.ts` checks the pages
  exist with titles, that the shortcuts page lists every tool key in
  `App.tsx`, the package layout, scripts and favicon.
- **Screenshots**: `site/scripts/screenshots.mjs` (`pnpm screenshots:site`)
  starts the app's dev server on port 5199, drives it in headless
  Chromium (Playwright 1.59.1, a site devDependency; `pnpm exec playwright
  install chromium` once per machine) with real keys, drags and typing,
  and saves 2× PNGs to `site/src/assets/screenshots/`. One scene per docs
  page, each in a fresh browser (empty drawing, nothing remembered); name
  scenes to run only those (`pnpm --dir site screenshots drawing-shapes`),
  since every run changes the random shape ids in panel shots.
  `getting-started` keeps the app's parts at the top level (the whole app
  at 1100 × 720, then at 840 wide, as narrow as the toolbar goes: toolbar,
  tool and layer palettes, rulers, status bar mid-drag, selection panel);
  page scenes save to a folder of their own (`drawing-shapes/`, `paths/`,
  `text/`, `selecting-and-editing/`, `dimensions/`, `links/`, `layers/`).
  Helpers: `draw` (a tool's key and a drag, then Escape and park the
  pointer so nothing is hovered), `clickPath`/`drawArch` (the Paths
  example), `addText` (types on the drawing, then sets a round 10 mm
  size: at 2 px/mm snapping is every 5 mm, so a drag can't give one),
  `selectAt` (click, then Shift-click: the first is the reference),
  `setLayer` (a layer's name, look, hidden or locked, through its card),
  `around` (a region round several elements),
  `toolbarButton` (a toolbar button hovered till its tooltip shows,
  cropped with its neighbours), `setFields`, `setInput` (a field found by
  its label), `deselect`
  (blurs a field first: a focused field keeps
  Escape), `noDimensions` (turns off Dimension new shapes), and
  `drawingBox`, which crops to what's drawn, with handles, a lasso, the
  path cards and the text editor.
  `src/components/Screenshot.astro` shows one at half its pixel size with
  a 2× srcset; `ScreenshotRow.astro` sets several side by side. Getting
  started and Guide › Drawing shapes, Paths, Text, Selecting and
  editing, Dimensions, Links and Layers use them (Links answers Equal's
  name prompt with a `dialog` handler; Layers shows the native layer
  select as a list box, since an open native menu is outside the page and
  no screenshot catches it); the Guide pages
  are being illustrated one at a time. Rerun after UI changes.
- **Changelog**: `CHANGELOG.md` at the repo root, `## <version> — <date>`
  per release, newest first, user-facing bullets; the site's
  `/changelog` renders it (`marked`). A test checks its first entry is
  package.json's version, so bump both together.
- Copyright line in the footer: "© <year> Paul Clark" (the About dialog's
  "by Paul Clark @sandtreader"); SynFlo's says Greenwave Interactive Ltd.

## Decisions taken (not in the outline)

- Fills are per layer (like line colour), never per shape; always
  semi-transparent at one fixed `FILL_OPACITY` (indicative: lines behind
  show, overlaps deepen; no opacity setting); pattern spacing, angle and
  marks are fixed in paper mm, anchored at the origin so neighbours line
  up; DXF leaves them out.

- Licence: AGPL-3.0-or-later (`LICENSE`, both package.json files). The
  docs site's Astroship-derived components stay GPL-3.0
  (`site/LICENSE-astroship`), combined under GPL-3.0 section 13; listed in
  `site/NOTICE.md`. The collab library stays MIT.
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
  linkButtons.ts`). Dimensions and radius labels are click-through except
  with the select tool, which picks and drags them (a "= name" still opens
  its popup).
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
- Drawing a rect, circle or line adds its dimensions while this viewer's
  "Dimension new shapes" is on (the default); the Dimension tool and the
  shape panel's checkboxes add and remove them by hand. A dimension's
  offset is signed: negative is the far side.
- Undo is local-only; remote changes bypass history.
- Derived spacing positions are never written to the document except on
  unlink.
- MUI only for collaboration: the session panel and remote cursors come
  from the collab package's React entry, which needs MUI, Emotion,
  qrcode.react and bad-words. They load with the session (dynamic import);
  the rest of the UI is plain CSS. Nothing in the app's core imports
  `@mui`, `@emotion` or `@sandtreader/collab/react` (a test checks).
- **Text boxes**: the font size is never stored. It is derived: the
  largest size at which the text, wrapped to the width, fits the height
  (lines × 1.2 × size ≤ height). Lines never fall as the size grows, so
  `fitTextSize` halves (0, height / 1.2] a fixed 64 times (the same on
  every client), and when the height is what limits it returns exactly
  height / (1.2 × lines), so a full box's lines land exactly. No width or
  height gives 0, never NaN. Edits that should keep the size (text, font,
  style) or set it rewrite the height instead. Fonts are the PDF standard
  families, sans = Helvetica, serif = Times, mono = Courier, bold and
  italic for the whole box (Helvetica/Courier Oblique, Times Italic),
  measured with Adobe's Core 14 AFM widths generated once into the
  checked-in `model/fontMetrics.ts` by `scripts/afm-widths.mjs <afm-dir>`
  (by hand only; nothing reads AFM files at build or run time; every
  WinAnsiEncoding character: codes 32–126, then `EXTRA_CHARS` in code
  order with their bytes in `EXTRA_CODES` (0x80–0x9F's Windows set, then
  Latin-1, no-break space and soft hyphen as space and hyphen), which the
  PDF encodes through `winAnsiCode` too; anything else the font's "n"
  width and "?" in a PDF; cap height, ascender and descender per font;
  the AFMs' copyright notices kept in its header). So every client and output
  wraps the same; SVG pins each line's width for substitute fonts.
  `mirror` draws the glyphs reflected within the box, each line starting
  at its right-hand side: a flip mirrors text rather than keeping it
  readable. Flipping left to right is exactly a rect's x-flip (corner the
  mirror of the old top-right, rotation −r) with `mirror` toggled;
  flipping top to bottom is the x-flip then a half turn about the same
  pivot (a reflection across a horizontal line is the one across the
  vertical followed by a half turn about their crossing): rotation 180 −
  r, the corner the old top-right mirrored across the horizontal,
  `mirror` toggled. `mirror` is always written explicitly.

## Not built yet (in rough priority order)

1. Links: resizing one of several gap-spaced items drifts its centre
   slightly (the held point is approximated as centre). Spacing a
   selection that includes a containing shape (e.g. the panel with its
   holes) makes the panel an anchor and overflows; it could exclude
   shapes that contain the others.
2. Print refinements: a date in the title block, dimensions in DXF on
   their own layer, a custom scale.
3. Text box extras: system or embedded fonts beyond the PDF standard
   three, and vertical alignment. Then
   named variables/expressions, woodwork extras (see outline "Later").
4. Path extras (`plans/polyline.md` "Later"): dimensions, scaling by
   bounds, symmetric (equal-length) handles, converting rects/circles to
   paths; also Shift to constrain a handle's angle, selecting a node or
   segment on the click that selects the path, multi-node/segment
   selection, joining by dropping one end on another (now via the card).
5. Line style extras: by layer (a layer default, shapes overriding),
   line widths in DXF (needs R2000+, group 370).
6. Collaboration extras: show other people's selections (shapes someone
   else has selected outlined in their cursor colour; presence already
   carries `selection`).
7. ⌘A selects every shape (on visible, unlocked layers) instead of the
   page's text, except while typing in a field.
8. Shape names: a `name` prop on shapes, edited in the selection panel
   where the id shows now (e.g. `rect_bt5a44hq`), and an option to show
   names on the drawing. Decided: the name defaults to the id (unset or
   blank shows the id), and ids themselves never change, since they're
   the entity map's keys that dimensions, links and other entities
   reference.
9. Selection panel: replace the Delete button at the bottom with a bin
   icon button at the top right of the panel. Retake the docs screenshots
   that show the panel after (`getting-started`, `drawing-shapes`).

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
- Dev server: `pnpm dev` on http://localhost:5174/. For collaboration run
  the relay too, `pnpm relay` (the package's `collab-relay` on 2901); the
  dev server proxies `/collab` to it, so it works from the LAN as well.
  Share links are `/s/<id>` on the dev server (Vite serves the app for any
  path).
- Docs site: `pnpm dev:site` (Astro, port 4321 unless taken) and
  `pnpm build:site`; run `pnpm install` inside `site/` first. Its own
  `pnpm typecheck` is `astro check`.

## Working agreements

- Do not commit or push until asked. "cp" means commit and push.
- Woodwork is the first use case, not a limit: keep features general.
- Prove builds locally before tagging; one tag per working release.

## Hosting (st1)

- Live at https://delinya.net (0.1.0 deployed 2026-11-10; 0.1.1, 0.1.2
  and 0.2.1 2026-11-23; 0.2.2, 0.3.0, 1.0.0 and 1.1.0 2026-11-24; 1.1.1
  2026-11-26). DNS at
  Squarespace points delinya.net and www at st1 (109.123.121.122).
- Apache: `/etc/apache2/sites-available/delinya.net.conf` (http, redirects
  to https) and `delinya.net-le-ssl.conf` (docroot `/var/www/delinya.net`,
  `/collab` proxied to the relay on 2901: the shared `synflo-server`
  container, the collab package's relay, keyed by app). Let's Encrypt
  cert via certbot, auto-renewing.
- Share links: `public/.htaccess` (deployed with the app; the vhost has
  `AllowOverride All`) rewrites `/s/…` to `/index.html`, as SynFlo's vhost
  does.
- Deploy: `pnpm publish:web` (build, then rsync `dist/` to the docroot
  with `--delete`, as SynFlo's `publish:ui`).
- Favicon: `public/favicon.svg` (set square and pencil on graph paper);
  `favicon.ico` and `apple-touch-icon.png` are rendered from it with
  Inkscape and ImageMagick (the PNG without rounded corners).
- **delinya.org** (the docs site, `site/`): static files in docroot
  `/var/www/delinya.org`, deployed with `pnpm publish:site` (builds the
  site, then rsyncs `site/dist/` with `--delete`). `site/public/.htaccess`
  sets `ErrorDocument 404 /404.html` (the vhost has `AllowOverride All`).
  Apache: `delinya.org.conf` (http, redirects to https) and
  `delinya.org-le-ssl.conf`, copied from delinya.net's without the
  `/collab` proxy; DNS A records for delinya.org and www point at st1;
  Let's Encrypt cert for both via certbot, auto-renewing. Live since
  2026-11-24.
