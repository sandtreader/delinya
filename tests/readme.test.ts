import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import readme from "../README.md?raw";

// The README is the repo's front page: what Delinya is and where it lives,
// then the code's layout and how to work on it. These keep it from going
// stale: every path in its layout table exists, and every pnpm command it
// gives is a real script.

// Every file under the paths the README can name, keyed "../<path>".
const files = Object.keys(import.meta.glob([
  "../src/**", "../tests/**", "../plans/**", "../scripts/**", "../public/**",
  "../site/*", "../site/src/**", "../site/public/**",
// This file's own folder comes back as "./".
])).map((k) => k.replace(/^\.\//, "../tests/"));
const exists = (p: string) => {
  const key = `../${p.replace(/\/$/, "")}`;
  return files.some((f) => f === key || f.startsWith(`${key}/`));
};

describe("README", () => {
  it("points to the app, the docs, the changelog and the status", () => {
    for (const s of ["https://delinya.net", "https://delinya.org", "CHANGELOG.md", "plans/status.md"]) expect(readme).toContain(s);
  });

  it("names only paths that exist in its layout table", () => {
    const paths = [...readme.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(exists(p), p).toBe(true);
  });

  it("gives only real pnpm scripts", () => {
    const scripts = pkg.scripts as Record<string, string>;
    const used = [...readme.matchAll(/^pnpm ([a-z:]+)/gm)].map((m) => m[1]!).filter((s) => s !== "install");
    expect(used.length).toBeGreaterThan(5);
    for (const s of used) expect(scripts, s).toHaveProperty(s);
  });

  it("lists every entity kind in the model paragraph", () => {
    for (const k of ["line", "rect", "circle", "polyline", "text", "variable", "link.spacing", "link.align", "dimension", "radius-label", "layer", "document"]) {
      expect(readme, k).toContain(`\`${k}\``);
    }
  });
});
