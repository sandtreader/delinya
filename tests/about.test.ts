import { describe, it, expect } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { APP_VERSION } from "../src/app/version";
import { editorReducer, initialEditor } from "../src/app/editor";
import aboutSource from "../src/panels/AboutDialog.tsx?raw";

describe("About", () => {
  it("knows the version, from package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("links the author to sandtreader.com", () => {
    expect(aboutSource).toMatch(/<a href="https:\/\/sandtreader\.com"[^>]*>@sandtreader<\/a>/);
  });

  it("says what it is", () => {
    expect(aboutSource).toContain("Collaborative 2D drawing with real units.");
  });

  it("links the home page and the documentation on delinya.org", () => {
    expect(aboutSource).toMatch(/<a href="https:\/\/delinya\.org\/"[^>]*>home page<\/a>/);
    expect(aboutSource).toMatch(/<a href="https:\/\/delinya\.org\/docs\/"[^>]*>documentation<\/a>/);
  });

  it("opens and closes like the other dialogs", () => {
    const open = editorReducer(initialEditor, { type: "dialog", dialog: "about" });
    expect(open.dialog).toBe("about");
    expect(editorReducer(open, { type: "dialog", dialog: null }).dialog).toBeNull();
  });
});
