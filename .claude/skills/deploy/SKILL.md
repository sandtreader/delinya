---
name: deploy
description: Release and deploy Delinya, or deploy only its docs. Use when the user asks to release, cut a version, tag, deploy, publish, or "deploy the docs", or to refresh the docs screenshots after UI changes. Covers the version bump, CHANGELOG, local checks, tagging, publishing the app (delinya.net) and the docs site (delinya.org) in the right order, and checking them live.
---

# Deploying Delinya

Two sites, both rsynced to st1:

- **App**: delinya.net, `pnpm publish:web` (builds, then rsyncs `dist/`).
- **Docs**: delinya.org, `pnpm publish:site` (builds `site/`, then rsyncs `site/dist/`).

Both are production. Publish only when the user asks in this conversation;
an earlier yes doesn't carry over. Claude Code's permission check may block
a publish command until the user says so explicitly: then stop and ask, and
don't look for another way to run it.

Commit only when asked ("cp" means commit and push). End commit messages
with the attribution line the session asks for.

## A release (app and docs)

1. **Version.** The user picks it (e.g. "this can be 1.1.1"): patch for
   fixes and small changes, minor for features. Then:
   - `package.json` `version`;
   - `CHANGELOG.md`: a new first entry `## X.Y.Z — YYYY-MM-DD`, user-facing
     bullets (`tests/site.test.ts` checks it matches `package.json`);
   - `plans/status.md`: the opening paragraph (what this version is).
2. **Prove it locally**, before any tag:
   `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm build:site`, and
   `grep -o "X.Y.Z" dist/assets/*.js` to see the version in the build.
   Type errors in files you didn't touch usually mean a stale install:
   `pnpm install --frozen-lockfile`.
3. **Docs in step.** The docs must describe this release: features added,
   defaults changed. If the UI changed, retake the affected screenshots (see
   below).
4. **Commit, tag, push**, once the user says go:
   `git commit` ("Version X.Y.Z: summary"), `git tag -a vX.Y.Z -m "Version X.Y.Z"`,
   `git push`, `git push origin vX.Y.Z`. One tag per working release; never
   move or delete a pushed tag. If something's wrong after tagging, fix it
   and release the next patch.
5. **Publish the app first, then the docs**: `pnpm publish:web`, then
   `pnpm publish:site`. Docs going live before the app would describe
   features users can't see yet.
6. **Check them live**:
   - the app: `curl -sS https://delinya.net/` names a new `/assets/index-*.js`,
     and that file contains `"X.Y.Z"`;
   - the docs: `https://delinya.org/changelog/` has `X.Y.Z — date`, and a
     page that changed shows the change.
7. **Record it** in `plans/status.md`: the opening paragraph says deployed,
   and the Hosting section's list of deploys gains `X.Y.Z` and the date.
   Commit and push that when asked ("Status: X.Y.Z deployed").

## Docs only

When only `site/` changed (text, screenshots, the home page):

1. Check the docs don't describe app changes that aren't live: compare
   `git log vX.Y.Z..HEAD -- src` (app changes since the last release tag)
   with what the changed docs say. If they do, it's a release, not a docs
   deploy.
2. `pnpm test` and `pnpm build:site`.
3. Commit and push (when asked), then `pnpm publish:site`.
4. Check live: the changed pages, e.g.
   `curl -sS https://delinya.org/docs/guide/<page>/ | grep -c 'class="screenshot"'`
   for screenshot counts, and that an image URL from the page returns 200.

## Screenshots

The docs screenshots (`site/src/assets/screenshots/`) are all scripted by
`site/scripts/screenshots.mjs`, which drives the app in headless Chromium:
see "Screenshots" in `plans/status.md` for how. After a UI change:

- `pnpm --dir site screenshots <scene> ...` retakes the named scenes (each
  docs page's slug, e.g. `drawing-shapes`, plus `getting-started`, which
  holds the app's parts used across pages); `pnpm screenshots:site` retakes
  them all. `collaboration` starts the collab relay itself unless
  `pnpm relay` is running.
- Look at every retaken image before committing. Panel shots show random
  shape ids, so a retake always differs: restore scenes whose look didn't
  change with `git checkout -- site/src/assets/screenshots/<scene>`.
- Needs Playwright's Chromium once per machine:
  `pnpm --dir site exec playwright install chromium`.
- Don't pipe the script into `head`: cutting its output short leaves its dev
  server on port 5199 running. Write the output to a file instead.

Not scripted: the home page hero (`site/src/assets/hero.png`) and
`site/public/opengraph.png` come from the user's own screenshots. To swap
in a new one, trim the window's rounded corners and border (paint the
corners white, drop the bottom border rows); the hero takes the full image
and the OpenGraph image is its top 1200 × 630 crop.
