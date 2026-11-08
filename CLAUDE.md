# Delinya

2D drawing tool with real units (mm). General purpose; woodwork is the first
use case, not a limit. Plans live in `plans/`.

## Architecture rules

- The document is `@sandtreader/collab`'s `DocState`: a flat entity map.
  Delinya names the kinds and typed props in `src/model/types.ts`.
- Derived geometry is never stored or synced. `resolve()` in
  `src/model/resolve.ts` is pure and must never throw; dangling references
  become `Issue`s.
- Every mutation is a collab `Change` built by a function in
  `src/model/actions.ts` and applied through `DrawingStore.commit()`. Do not
  mutate state anywhere else; the collab client and undo depend on it.
- Lengths may be `number | { ref: variableId }`. Editing a linked length
  edits the variable (`setLength` handles this).
- Coordinates: x right, y down, angles in degrees from +x towards +y.

## Commands

`pnpm test`, `pnpm typecheck`, `pnpm dev` (placeholder page only so far).
