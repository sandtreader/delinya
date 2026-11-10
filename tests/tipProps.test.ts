import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tip } from "../src/panels/tip";
import { IconButton } from "../src/panels/icons";

// The bubble only shows after a rest, so a screen reader gets the tooltip
// text as the element's description, all the time.

describe("tip", () => {
  it("gives the tooltip text as the element's description", () => {
    expect(tip("Equal gaps across, between the outermost two"))
      .toEqual({ "data-tip": "Equal gaps across, between the outermost two", "aria-description": "Equal gaps across, between the outermost two" });
  });

  it("doesn't repeat a tooltip that is just the element's name", () => {
    expect(tip("Hide layer", "Hide layer")).toEqual({ "data-tip": "Hide layer" });
  });
});

describe("IconButton", () => {
  const html = (props: { label: string; tip?: string }) => renderToStaticMarkup(createElement(IconButton, { ...props, children: "·" }));

  it("is described by a tip that says more than its name", () => {
    const out = html({ label: "Undo", tip: "Undo (⌘Z)" });
    expect(out).toContain('aria-label="Undo"');
    expect(out).toContain('aria-description="Undo (⌘Z)"');
  });

  it("has no description when the tip is its name", () => {
    expect(html({ label: "Hide layer" })).not.toContain("aria-description");
  });
});
