import { describe, it, expect } from "vitest";
import html from "../index.html?raw";
import svg from "../public/favicon.svg?raw";

// The favicon: an SVG for browsers that take one, a PNG for iOS home
// screens and an .ico for anything that asks for /favicon.ico directly.

const publicFiles = Object.keys(import.meta.glob("../public/*"));

describe("favicon", () => {
  it("is linked from the page", () => {
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  });

  it("is a square SVG", () => {
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);
  });

  it("has raster fallbacks", () => {
    expect(publicFiles).toContain("../public/favicon.ico");
    expect(publicFiles).toContain("../public/apple-touch-icon.png");
  });
});
