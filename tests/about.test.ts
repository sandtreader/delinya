import { describe, it, expect } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { APP_VERSION } from "../src/app/version";
import { editorReducer, initialEditor } from "../src/app/editor";

describe("About", () => {
  it("knows the version, from package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("opens and closes like the other dialogs", () => {
    const open = editorReducer(initialEditor, { type: "dialog", dialog: "about" });
    expect(open.dialog).toBe("about");
    expect(editorReducer(open, { type: "dialog", dialog: null }).dialog).toBeNull();
  });
});
