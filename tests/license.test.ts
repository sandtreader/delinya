import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import readme from "../README.md?raw";

// Delinya is AGPL-3.0-or-later. The one exception is the site's landing
// page components, adapted from the Astroship template, which stay under
// its GPL-3.0; GPL-3.0 section 13 lets the two combine.

const files = import.meta.glob<string>(
  ["../LICENSE", "../site/LICENSE", "../site/LICENSE-astroship", "../site/NOTICE.md", "../site/package.json"],
  { query: "?raw", import: "default", eager: true },
);

describe("licensing", () => {
  it("is the AGPL, version 3 or later", () => {
    expect(files["../LICENSE"]).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
    expect(pkg.license).toBe("AGPL-3.0-or-later");
    expect(JSON.parse(files["../site/package.json"]!).license).toBe("AGPL-3.0-or-later");
    expect(readme).toMatch(/AGPL-3\.0-or-later/);
  });

  it("keeps the template's GPL-3.0 with the code derived from it, and says so", () => {
    expect(files["../site/LICENSE"]).toBeUndefined();
    expect(files["../site/LICENSE-astroship"]).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    const notice = files["../site/NOTICE.md"]!;
    expect(notice).toMatch(/Astroship/);
    expect(notice).toMatch(/section 13/i);
    expect(notice).toMatch(/AGPL-3\.0-or-later/);
    expect(readme).toMatch(/site\/NOTICE\.md/);
  });
});
