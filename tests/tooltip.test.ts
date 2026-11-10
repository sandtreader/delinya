import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TIP_DELAY, TIP_WARM, TipTimer, placeTip } from "../src/view/tooltip";

describe("placeTip", () => {
  const viewport = { w: 1000, h: 800 };
  const tip = { w: 100, h: 20 };
  // A 30 px button.
  const at = (x: number, y: number) => ({ x, y, w: 30, h: 30 });

  it("centres below the anchor by default", () => {
    expect(placeTip(at(200, 10), tip, viewport, "below")).toEqual({ x: 165, y: 46, side: "below" });
  });

  it("goes above when there is no room below, and below when there is no room above", () => {
    expect(placeTip(at(200, 770), tip, viewport, "below")).toEqual({ x: 165, y: 744, side: "above" });
    expect(placeTip(at(200, 10), tip, viewport, "above")).toEqual({ x: 165, y: 46, side: "below" });
  });

  it("sits to the right, centred, for a palette; to the left with no room", () => {
    expect(placeTip(at(10, 100), tip, viewport, "right")).toEqual({ x: 46, y: 105, side: "right" });
    expect(placeTip(at(900, 100), tip, viewport, "right")).toEqual({ x: 794, y: 105, side: "left" });
  });

  it("stays inside the window along the other axis", () => {
    expect(placeTip(at(980, 10), tip, viewport, "below").x).toBe(896);
    expect(placeTip(at(-20, 10), tip, viewport, "below").x).toBe(4);
    expect(placeTip(at(10, 790), tip, viewport, "right").y).toBe(776);
  });
});

describe("TipTimer", () => {
  let shown: string | null;
  let t: TipTimer<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = null;
    t = new TipTimer((el) => { shown = el; });
  });
  afterEach(() => vi.useRealTimers());

  it("shows a tooltip after resting on its element for the delay", () => {
    expect(TIP_DELAY).toBe(1000);
    t.enter("save");
    vi.advanceTimersByTime(TIP_DELAY - 1);
    expect(shown).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown).toBe("save");
  });

  it("shows nothing if the pointer leaves first", () => {
    t.enter("save");
    vi.advanceTimersByTime(500);
    t.leave();
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown).toBeNull();
  });

  it("restarts the delay when moving to another element before anything shows", () => {
    t.enter("save");
    vi.advanceTimersByTime(800);
    t.enter("open");
    vi.advanceTimersByTime(800);
    expect(shown).toBeNull();
    vi.advanceTimersByTime(200);
    expect(shown).toBe("open");
  });

  it("once one shows, the next shows at once: across buttons and for a moment after leaving", () => {
    t.enter("save");
    vi.advanceTimersByTime(TIP_DELAY);
    t.enter("open");
    expect(shown).toBe("open");
    t.leave();
    expect(shown).toBeNull();
    vi.advanceTimersByTime(TIP_WARM - 1);
    t.enter("new");
    expect(shown).toBe("new");
  });

  it("goes back to waiting once it has been a while since one showed", () => {
    t.enter("save");
    vi.advanceTimersByTime(TIP_DELAY);
    t.leave();
    vi.advanceTimersByTime(TIP_WARM);
    t.enter("open");
    expect(shown).toBeNull();
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown).toBe("open");
  });

  it("a press hides the tooltip and cancels one on its way", () => {
    t.enter("save");
    vi.advanceTimersByTime(TIP_DELAY);
    t.press();
    expect(shown).toBeNull();
    t.enter("open");
    vi.advanceTimersByTime(300);
    t.press();
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown).toBeNull();
  });

  it("a press is not a warm start: the next waits the full delay", () => {
    t.enter("save");
    vi.advanceTimersByTime(TIP_DELAY);
    t.press();
    t.enter("open");
    expect(shown).toBeNull();
    vi.advanceTimersByTime(TIP_DELAY);
    expect(shown).toBe("open");
  });
});
