import { describe, it, expect } from "vitest";
import { FieldDraft } from "../src/app/fieldDraft";

describe("FieldDraft", () => {
  it("commits what was typed once, on blur or Enter", () => {
    const d = new FieldDraft("Shelf");
    d.edit("Shelves");
    expect(d.text).toBe("Shelves");
    expect(d.take()).toBe("Shelves");
    expect(d.take()).toBeUndefined();
  });

  it("commits nothing when the text is unchanged", () => {
    const d = new FieldDraft("Shelf");
    d.edit("Shel");
    d.edit("Shelf");
    expect(d.take()).toBeUndefined();
  });

  it("Escape drops the edit, so the blur that follows commits nothing", () => {
    const d = new FieldDraft("Shelf");
    d.edit("Oops");
    expect(d.cancel()).toBe(true);
    expect(d.text).toBe("Shelf");
    expect(d.take()).toBeUndefined();
  });

  it("Escape with nothing typed says so, leaving the key to close a dialog", () => {
    expect(new FieldDraft("Shelf").cancel()).toBe(false);
  });

  it("a new value from outside (undo, a peer) replaces the draft", () => {
    const d = new FieldDraft("Shelf");
    d.edit("Oops");
    d.reset("Cupboard");
    expect(d.text).toBe("Cupboard");
    expect(d.take()).toBeUndefined();
  });
});
