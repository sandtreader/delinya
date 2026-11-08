# Delinya

Browser-based 2D drawing tool with real units. Everything is stored in
millimetres; scale is a display and print setting. See `plans/outline.md`
for the goal and `plans/collab.md` for the collaboration design.

## Status

Model only. There is no canvas yet; the model under `src/model` is exercised
by the tests and a placeholder page is all `pnpm dev` shows.

## Layout

| Path | Contents |
|---|---|
| `src/model/types.ts` | Entity kinds and their typed props. The document itself is `@sandtreader/collab`'s `DocState`. |
| `src/model/geometry.ts` | Points, segments, arcs, bounds. No model knowledge. |
| `src/model/resolve.ts` | `resolve(state)`: the pure pass from document to geometry, dimensions, labels and issues. |
| `src/model/actions.ts` | User operations as pure `(state, …) → Change` functions. |
| `src/model/store.ts` | `DrawingStore`: the single point of mutation, with change-based undo/redo. |
| `src/collab/` | Adapter binding a store to a `CollabClient`. |
| `tests/` | Vitest: resolve, actions, store, and two stores through the real relay. |

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
