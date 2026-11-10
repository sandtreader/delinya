import { describe, it, expect, vi } from "vitest";
import { canFullscreen, isFullscreen, toggleFullscreen, type FullscreenDoc } from "../src/app/fullscreen";

/** Just enough of `document` for full screen. */
function fakeDoc(enabled = true) {
  const d = {
    fullscreenEnabled: enabled,
    fullscreenElement: null as Element | null,
    documentElement: { requestFullscreen: vi.fn(async () => { d.fullscreenElement = d.documentElement as unknown as Element; }) },
    exitFullscreen: vi.fn(async () => { d.fullscreenElement = null; }),
  };
  return d;
}

describe("full screen", () => {
  it("goes full screen from a window, and back", async () => {
    const d = fakeDoc();
    const doc = d as unknown as FullscreenDoc;
    expect(isFullscreen(doc)).toBe(false);
    await toggleFullscreen(doc);
    expect(d.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(isFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(d.exitFullscreen).toHaveBeenCalledOnce();
    expect(isFullscreen(doc)).toBe(false);
  });

  it("isn't offered where the browser can't (iPhone Safari, some iframes)", () => {
    expect(canFullscreen(fakeDoc(true) as unknown as FullscreenDoc)).toBe(true);
    expect(canFullscreen(fakeDoc(false) as unknown as FullscreenDoc)).toBe(false);
    expect(canFullscreen({} as FullscreenDoc)).toBe(false);
  });

  it("shrugs off a refusal: the browser says no without a user gesture", async () => {
    const d = fakeDoc();
    d.documentElement.requestFullscreen.mockRejectedValueOnce(new TypeError("Permissions check failed"));
    await expect(toggleFullscreen(d as unknown as FullscreenDoc)).resolves.toBeUndefined();
    expect(isFullscreen(d as unknown as FullscreenDoc)).toBe(false);
  });
});
