import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import appSource from "../src/App.tsx?raw";

// delinya.org: the documentation site, an Astro site in site/ on the same
// pattern as synflo.org (Astroship landing pages, Starlight docs under
// /docs, Tailwind), with its own package and lockfile so the app's install
// and build never see it. Deployed to st1's /var/www/delinya.org.

// Read as the other tests do, through Vite's ?raw (the app's tsconfig has
// no Node types): every file these tests look at, keyed "../<path>".
const files = import.meta.glob<string>(
  [
    "../site/package.json", "../site/pnpm-lock.yaml", "../site/astro.config.mjs",
    "../site/src/content/docs/docs/**/*.mdx", "../site/src/pages/*.astro",
    "../site/src/components/navbar/navbar.astro", "../site/src/components/hero.astro", "../site/public/favicon.svg",
    "../public/favicon.svg", "../CHANGELOG.md", "../pnpm-workspace.yaml",
  ],
  { query: "?raw", import: "default", eager: true },
);
const has = (p: string) => `../${p}` in files;
const read = (p: string) => {
  const text = files[`../${p}`];
  if (text === undefined) throw new Error(`no ${p}`);
  return text;
};
const DOCS = "site/src/content/docs/docs";

/** The docs, section by section: user guide, how-tos and reference. */
const PAGES = [
  "index.mdx",
  "getting-started.mdx",
  "guide/drawing-shapes.mdx",
  "guide/paths.mdx",
  "guide/text.mdx",
  "guide/selecting-and-editing.mdx",
  "guide/dimensions.mdx",
  "guide/links.mdx",
  "guide/layers.mdx",
  "guide/line-styles.mdx",
  "guide/rotate-and-duplicate.mdx",
  "guide/files.mdx",
  "guide/printing-and-export.mdx",
  "guide/collaboration.mdx",
  "howto/print-a-full-size-template.mdx",
  "howto/export-for-laser-or-cnc.mdx",
  "howto/evenly-spaced-holes.mdx",
  "howto/draw-together.mdx",
  "reference/keyboard-shortcuts.mdx",
  "reference/file-format.mdx",
];

describe("the site package", () => {
  it("is Astro with Starlight, on its own", () => {
    const site = JSON.parse(read("site/package.json"));
    expect(site.private).toBe(true);
    expect(site.dependencies).toHaveProperty("astro");
    expect(site.dependencies).toHaveProperty("@astrojs/starlight");
    expect(site.scripts).toMatchObject({ dev: expect.any(String), build: expect.any(String) });
    expect(has("site/pnpm-lock.yaml")).toBe(true);
    expect(has("pnpm-workspace.yaml")).toBe(false);
  });

  it("is built and published from the root", () => {
    const s = pkg.scripts as Record<string, string>;
    expect(s["dev:site"]).toMatch(/site/);
    expect(s["build:site"]).toMatch(/site/);
    expect(s["publish:site"]).toMatch(/rsync .*--delete site\/dist\/ st1:\/var\/www\/delinya\.org\//);
  });

  it("is delinya.org, with its docs titled", () => {
    const config = read("site/astro.config.mjs");
    expect(config).toMatch(/site:\s*"https:\/\/delinya\.org"/);
    expect(config).toMatch(/title:\s*"Delinya Docs"/);
    for (const dir of ["guide", "howto", "reference"]) expect(config).toContain(`docs/${dir}`);
  });
});

describe("the docs", () => {
  it("has every page, each with a title and description", () => {
    for (const p of PAGES) {
      expect(has(`${DOCS}/${p}`), p).toBe(true);
      const front = read(`${DOCS}/${p}`).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      expect(front, p).toMatch(/^title: .+/m);
      expect(front, p).toMatch(/^description: .+/m);
    }
  });

  it("lists every tool's key among the shortcuts", () => {
    const keys = Object.keys(Function(`return ${appSource.match(/TOOL_KEYS[^=]*=\s*(\{[^}]*\})/)![1]}`)() as object);
    expect(keys.length).toBeGreaterThan(5);
    const shortcuts = read(`${DOCS}/reference/keyboard-shortcuts.mdx`);
    for (const k of keys) expect(shortcuts, k).toMatch(new RegExp(`\\b${k.toUpperCase()}\\b`));
  });
});

describe("the landing pages", () => {
  it("has a home page, a 404 and the changelog", () => {
    for (const p of ["index.astro", "404.astro", "changelog.astro"]) expect(has(`site/src/pages/${p}`), p).toBe(true);
    expect(read("site/src/pages/changelog.astro")).toContain("CHANGELOG.md");
  });

  it("says where the name comes from", () => {
    const hero = read("site/src/components/hero.astro");
    expect(hero).toMatch(/Cornish for .drawing./);
    expect(hero).toContain('href="https://en.wiktionary.org/wiki/delinya"');
  });

  it("opens the app at delinya.net", () => {
    expect(read("site/src/components/navbar/navbar.astro")).toContain("https://delinya.net");
  });

  it("wears the app's icon", () => {
    expect(read("site/public/favicon.svg")).toBe(read("public/favicon.svg"));
  });
});

describe("the changelog", () => {
  it("starts with the app's current version", () => {
    const log = read("CHANGELOG.md");
    expect(log.match(/^## (\S+)/m)?.[1]).toBe(pkg.version);
    for (const v of ["0.3.0", "0.2.2", "0.2.1", "0.1.2", "0.1.1", "0.1.0"]) expect(log).toContain(`## ${v}`);
  });
});
