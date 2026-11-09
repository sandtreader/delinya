# Delinya

Browser-based 2D drawing tool with real units. Everything is stored in
millimetres; scale is a display and print setting. See `plans/outline.md`
for the goal and `plans/collab.md` for the collaboration design.

## Status

First working slice: draw lines, rectangles and circles with snapping, move
and resize them with handles, type exact values and corner radii in the
inspector, link equal values and equal spacing from a multi-selection,
undo/redo, save and open `.delinya` files, print at scale (tiled across
sheets if needed, with a check ruler and a title block from the document
properties) and export PDF, SVG and DXF. Dimensions are attached
automatically. The collaboration adapter is wired and tested but has no UI.
Full state, decisions and next steps: `plans/status.md`.

Keys: V select, L line, R rectangle, C circle, Shift constrains while
drawing, Delete removes the selection, ⌘Z / ⇧⌘Z undo and redo, ⌘O open,
⌘S / ⇧⌘S save and save as, ⌘P print and export. Wheel or pinch zooms;
dragging the background pans (Space or the middle button pans in any
tool).

## Layout

| Path | Contents |
|---|---|
| `src/model/types.ts` | Entity kinds and their typed props. The document itself is `@sandtreader/collab`'s `DocState`. |
| `src/model/geometry.ts` | Points, segments, arcs, bounds. No model knowledge. |
| `src/model/resolve.ts` | `resolve(state)`: the pure pass from document to geometry, dimensions, labels and issues. |
| `src/model/actions.ts` | User operations as pure `(state, …) → Change` functions. |
| `src/model/store.ts` | `DrawingStore`: the single point of mutation, with change-based undo/redo. |
| `src/model/resize.ts` | Resize handles per shape and the change a handle drag produces. |
| `src/collab/` | Adapter binding a store to a `CollabClient`. |
| `src/view/` | Screen/model mapping and geometry to SVG path. |
| `src/canvas/` | The SVG canvas: tools, snapping, rendering of shapes, dimensions and labels. |
| `src/panels/` | Toolbar, inspector, status bar. |
| `src/app/` | The app's store instance and editor (non-document) state. |
| `tests/` | Vitest: resolve, actions, store, resize, and two stores through the real relay. |

## Model in one paragraph

A drawing is a flat map of entities (`line`, `rect`, `circle`, `variable`,
`link.spacing`, `dimension`, `radius-label`). Any length prop may be a
number or `{ ref: variableId }`, which is how equal-value links work. A
spacing link derives its items' along-axis positions from two anchor
shapes. Nothing derived is stored: `resolve()` recomputes it, identically
on every client, from the synced document.

Coordinates have x to the right and y downwards; angles are degrees from
+x towards +y.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```
