# Delinya

2D drawing tool with real units (mm). General purpose; woodwork is the first
use case, not a limit. Plans live in `plans/`; `plans/status.md` is the
handoff: what is built, decisions taken, what is next. Keep it current.

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

- UI reads `store.resolved` only and writes only via `store.commit()`.
  Editor state (tool, selection, view) lives in `src/app/editor.ts` and is
  never part of the document.
- Plain CSS, no component library yet. The collab React entry needs MUI, so
  adding the session panel later means deciding on MUI then.

## Working agreements

- Do not commit or push until asked; "cp" means commit and push.

## Commands

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm dev` (port 5174).
