# delinya.org

The Delinya website and user documentation: an [Astro](https://astro.build)
site with landing pages (from the Astroship template, as synflo.org) and
[Starlight](https://starlight.astro.build) docs under `/docs`, styled with
Tailwind. It is its own package with its own lockfile; the app in the
parent directory never sees it.

```bash
pnpm install          # in site/
pnpm dev              # http://localhost:4321
pnpm build            # static site in dist/
```

From the repo root: `pnpm dev:site`, `pnpm build:site`, and
`pnpm publish:site`, which builds and rsyncs `dist/` to
`st1:/var/www/delinya.org/`.

- Landing pages: `src/pages/` (home, changelog, 404) and
  `src/components/`.
- Docs: `src/content/docs/docs/` (Markdown/MDX; the sidebar in
  `astro.config.mjs` autogenerates the Guide, How-to and Reference
  sections from their folders, ordered by each page's `sidebar.order`).
- The changelog page renders the repo's `CHANGELOG.md`.
- `public/.htaccess` points Apache's 404 at `404.html`.

The template code is GPL-3.0 (see `LICENSE`), as Astroship's.
