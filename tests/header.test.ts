import { describe, it, expect } from "vitest";
import { quotedTitle } from "../src/view/format";

// The header shows the file name at its right end, then the drawing's
// title from Properties in quotes.

describe("quotedTitle", () => {
  it("quotes the drawing's title", () => {
    expect(quotedTitle("Kitchen bench", "bench-v2")).toBe("“Kitchen bench”");
    expect(quotedTitle("  Kitchen   bench ", "bench-v2")).toBe("“Kitchen bench”");
  });

  it("shows nothing for a blank title, or one that just repeats the file name", () => {
    expect(quotedTitle("", "bench-v2")).toBeNull();
    expect(quotedTitle("   ", "bench-v2")).toBeNull();
    expect(quotedTitle("bench-v2", "bench-v2")).toBeNull();
  });
});
