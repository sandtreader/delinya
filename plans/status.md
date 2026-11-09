# Delinya — Status and Handoff

Last updated 2026-11-09. Repo `sandtreader/delinya`, branch `main`, head
is the file save/load commit. Tree clean; 67 Vitest tests and `tsc` pass.

## Where we are

The abstract model is complete for the outline's v1 feature set and the
first visual slice is usable: you can draw, move, resize, type exact values,
link equal values and equal spacing, and undo. The collab adapter is wired
and tested against the real relay but has no UI. Nothing persists: there is
save/load to local files but no print or export yet.

## What is built

### Model (`src/model/`, all pure, fully tested)

- **Document** is `@sandtreader/collab`'s `DocState` (flat `{kind, props}`
  map). Kinds: `line`, `rect`, `circle`, `variable`, `link.spacing`,
  `dimension`, `radius-label`. Typed props in `types.ts`.
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
  `radius-clamped` issue shown in the inspector.
- **Spacing links** derive along-axis positions between the anchors' inner
  faces, by gaps or by centres. Items' stored along-axis position is
  ignored while linked; `unlinkSpacing` writes the derived value back.
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
`<g transform>` layer. Editor state (tool, selection, view, cursor, snap)
lives in a reducer and is never part of the document; the document is read
through `useSyncExternalStore`.

- **Tools**: select (V), line (L), rect (R), circle (C). Drawing a shape
  also adds its dimensions (rect: width and height; circle: diameter;
  line: length) and returns to select unless Shift is held. Shift
  constrains to square / 45°.
- **Pan/zoom** matches SynFlo: wheel and pinch zoom at the cursor,
  background drag pans, Space or middle button pans in any tool. Pan and
  zoom are reducer delta actions so rapid events never read a stale view.
- **Snapping** (`canvas/snap.ts`): to other shapes' snap points within
  10 px, else to an adaptive grid. Moving snaps the moving shape's own
  points onto others. The status bar shows the snap type.
- **Resize handles** on a single selection: rect corners (anchor opposite
  corner, flips across it), circle centre and radius, line ends.
- **Inspector**: x/y, each length with a linked badge and unlink, corner
  radii with a clamped indicator, spacing membership. Multi-selection can
  link widths/heights/diameters/lengths (names the variable via
  `window.prompt`) and space evenly by gaps or centres along x or y, with
  the outer two items as anchors. Variables are listed.
- **Files** (`app/file.ts`): New, Open…, Save, Save as… in the toolbar;
  ⌘O, ⌘S, ⇧⌘S. Uses the File System Access API where present (Chromium),
  so Save writes back to the opened file; elsewhere Save downloads and
  Open uses a file input. Extension `.delinya` (JSON; `.json` also
  opens). The toolbar and tab title show the file name and a • when
  dirty; New/Open confirm before discarding, and closing the tab warns.
  Loading clears selection, returns to select and resets the view.
- **Keys**: ⌘Z / ⇧⌘Z (Ctrl+Y) undo/redo, Delete/Backspace, Escape to
  select and clear. File keys work from inside a field: they blur it
  first so its value commits.

## Decisions taken (not in the outline)

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

1. **Print at scale** with a check ruler; **export** SVG, DXF, PDF.
   `view/svgPath.ts` already turns paths into SVG `d` strings.
2. **Manual dimension and radius-label tools**, and dragging dimension
   offsets.
3. **Collaboration UI**: connect, session panel, presence cursors. Needs
   the MUI decision and `ProxyPass` lines on a delinya.net vhost (same as
   synflo.net, port 2901 on st1).
4. **Fit view to drawing** (on open, and as a button); opening resets to
   the default view for now.
5. Rotation of rects, text, named variables/expressions, woodwork extras
   (see outline "Later").

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
