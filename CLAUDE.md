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
- Plain CSS, no component library. MUI is used only by the collab
  package's session panel and remote cursors, loaded lazily with the
  session (`src/collab/session.tsx`); keep `@mui`, `@emotion` and
  `@sandtreader/collab/react` out of everything else.

## Working agreements

- Do not commit or push until asked; "cp" means commit and push.

## Commands

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm dev` (port 5174),
`pnpm relay` (the collab relay on 2901, which the dev server proxies at
`/collab`). The delinya.org docs site is its own package in `site/`
(`pnpm install` there first): `pnpm dev:site`, `pnpm build:site`,
`pnpm publish:site` (build and rsync to st1), `pnpm screenshots:site`
(retake the docs' app screenshots after UI changes). `CHANGELOG.md` feeds its
changelog page; add an entry with each version bump. Releases, docs
deploys and retaking screenshots: the `deploy` skill
(`.claude/skills/deploy/SKILL.md`).
