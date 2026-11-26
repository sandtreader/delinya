# Delinya

Collaborative 2D drawing with real units, in the browser. Everything is
stored in millimetres; scale is a display and print setting. Woodwork was
the first use, not a limit. (*Delinya* is Cornish for "to draw".)

- **Use it:** <https://delinya.net>
- **Docs and how-tos:** <https://delinya.org>
- **What's new:** [`CHANGELOG.md`](CHANGELOG.md)
- **Full state, decisions and next steps:** [`plans/status.md`](plans/status.md)

## What it does

- Lines, rectangles (with rounded corners), circles, paths of straight and
  curved segments, and text boxes in the standard PDF fonts.
- Exact sizes typed in, snapping to the grid and to other shapes, rotation
  and flips, resize handles that work in a turned shape's own frame.
- Links: equal values through shared variables, and alignment and even
  spacing that follow later edits.
- Dimensions and radius labels, added automatically or by hand with the
  Dimension tool.
- Layers with colours, see-through fills and patterns, hiding and locking;
  line styles (ISO pen widths and dashed, dotted and centre lines).
- Save and open `.dln` files; print at true scale, tiled across sheets with
  a check ruler and title block; export PDF, SVG and DXF.
- Drawing together: start a session, share the link, and everyone edits
  the same drawing live with each other's cursors shown.

## Model in one paragraph

A drawing is a flat map of entities: shapes (`line`, `rect`, `circle`,
`polyline`, `text`), `variable`, the links `link.spacing` and `link.align`,
`dimension` and `radius-label`, `layer`, and the singleton `document`
(title block and grid). Any length prop may be a number or
`{ ref: variableId }`, which is how equal-value links work. Nothing derived
is stored: `resolve()` recomputes geometry, dimensions, labels and issues,
identically on every client, from the synced document. Every mutation is a
collab `Change` committed through the store, which gives undo and
collaboration the same path.

Coordinates have x to the right and y downwards; angles are degrees from
+x towards +y.

## Layout

| Path | Contents |
|---|---|
| `src/model/` | The document: kinds and props (`types.ts`), `resolve.ts`, actions as pure `(state, …) → Change` functions, the `DrawingStore` with undo, geometry, paths, text and font metrics, rotation, resizing, links, layers, line styles, corners and dimensions. |
| `src/output/` | Print, PDF, SVG and DXF from the resolved drawing: one page model for preview, printout and PDF. |
| `src/canvas/` | The SVG canvas: tools, snapping, hit-testing, path editing, on-drawing text editing, rulers. |
| `src/panels/` | Toolbar and its cards (rotate, duplicate, collaborate), tool and layer palettes, the selection panel, dialogs, status bar. |
| `src/view/` | Screen mapping and pure view helpers: viewport and fit, SVG paths, dimension text, link guides, formatting. |
| `src/app/` | The app's store instance and editor state (tool, selection, view: never part of the document), files, printing. |
| `src/collab/` | The binding to `@sandtreader/collab`. `session.tsx` (the session panel and cursors, with MUI) loads only when collaborating. |
| `tests/` | Vitest: model, output, UI logic, and stores converging through the real relay. |
| `site/` | delinya.org: an Astro site (landing pages, Starlight docs), with its own package and lockfile. |
| `plans/` | Design notes and `status.md`, the handoff. |
| `scripts/` | `afm-widths.mjs`, which generated `src/model/fontMetrics.ts` from the Adobe Core 14 metrics. |
| `public/` | Icons, and `.htaccess` serving the app for share links (`/s/<id>`). |

## Development

```bash
pnpm install
pnpm dev            # the app on port 5174
pnpm relay          # the collab relay on 2901, which the dev server proxies at /collab
pnpm test
pnpm typecheck
pnpm build
pnpm dev:site       # the docs site (install it first: pnpm --dir site install)
pnpm build:site
```

## Deploying

Both sites are static files on st1 (Apache, Let's Encrypt), and the relay
there is shared with SynFlo at `/collab`.

```bash
pnpm publish:web    # build the app and rsync it to delinya.net
pnpm publish:site   # build the docs and rsync them to delinya.org
```

Each release bumps the version in `package.json` and adds its entry to
`CHANGELOG.md` (a test checks they agree).

## Licence

Delinya is free software under the GNU Affero General Public License,
version 3 or any later version (`AGPL-3.0-or-later`): see [`LICENSE`](LICENSE).
The docs site's landing page components are adapted from the Astroship
template and stay under its GPL-3.0; see [`site/NOTICE.md`](site/NOTICE.md).
