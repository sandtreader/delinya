import { describe, it, expect } from "vitest";
import { clampPosition, loadPosition, savePosition } from "../src/app/floatPosition";

const DEFAULT = { x: 10, y: 10 };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

describe("clampPosition", () => {
  const size = { w: 40, h: 160 };
  const area = { w: 800, h: 600 };

  it("leaves a position that fits alone", () => {
    expect(clampPosition({ x: 100, y: 200 }, size, area)).toEqual({ x: 100, y: 200 });
  });

  it("keeps the panel inside the area with a margin", () => {
    expect(clampPosition({ x: -50, y: -5 }, size, area)).toEqual({ x: 8, y: 8 });
    expect(clampPosition({ x: 790, y: 590 }, size, area)).toEqual({ x: 800 - 40 - 8, y: 600 - 160 - 8 });
    expect(clampPosition({ x: 790, y: 590 }, size, area, 0)).toEqual({ x: 760, y: 440 });
  });

  it("pins to the top-left margin when the area is smaller than the panel", () => {
    expect(clampPosition({ x: 300, y: 300 }, size, { w: 30, h: 100 })).toEqual({ x: 8, y: 8 });
  });
});

describe("loadPosition / savePosition", () => {
  it("round-trips through storage", () => {
    const s = memoryStorage();
    savePosition(s, "k", { x: 123, y: 45 });
    expect(JSON.parse(s.data.k!)).toEqual({ x: 123, y: 45 });
    expect(loadPosition(s, "k", DEFAULT)).toEqual({ x: 123, y: 45 });
  });

  it("falls back when nothing is stored, the value is junk, or storage is unavailable", () => {
    expect(loadPosition(memoryStorage(), "k", DEFAULT)).toEqual(DEFAULT);
    for (const junk of ["not json", "null", "[1,2]", '{"x":"1","y":2}', '{"x":1}', '{"x":null,"y":2}', '{"x":1e999,"y":2}']) {
      expect(loadPosition(memoryStorage({ k: junk }), "k", DEFAULT), junk).toEqual(DEFAULT);
    }
    expect(loadPosition(null, "k", DEFAULT)).toEqual(DEFAULT);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPosition(throwing, "k", DEFAULT)).toEqual(DEFAULT);
    expect(() => savePosition(throwing, "k", { x: 1, y: 2 })).not.toThrow();
    expect(() => savePosition(null, "k", { x: 1, y: 2 })).not.toThrow();
  });
});
