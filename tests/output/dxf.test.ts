import { describe, it, expect } from "vitest";
import { addCircle, addDimension, addLine, addRect, arcEnd, elementStart, resolve } from "../../src/model";
import { exportDxf } from "../../src/output/dxf";
import { doc } from "../helpers";

type Pair = [code: number, value: string];
interface Ent { type: string; pairs: Pair[] }

function pairsOf(dxf: string): Pair[] {
  const lines = dxf.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  expect(lines.length % 2, "group codes and values come in pairs").toBe(0);
  const out: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    expect(Number.isInteger(code), `group code at line ${i}`).toBe(true);
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

/** Entities in the ENTITIES section, each with its pairs up to the next 0. */
function entities(dxf: string): Ent[] {
  const pairs = pairsOf(dxf);
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === "ENTITIES" && pairs[i - 1]?.[1] === "SECTION");
  expect(start).toBeGreaterThan(0);
  const out: Ent[] = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c === 0 && v === "ENDSEC") break;
    if (c === 0) out.push({ type: v, pairs: [] });
    else out[out.length - 1]?.pairs.push(pairs[i]!);
  }
  return out;
}

const num = (e: Ent, code: number) => {
  const p = e.pairs.find(([c]) => c === code);
  return p ? Number(p[1]) : undefined;
};

describe("exportDxf", () => {
  it("returns null with nothing to export", () => {
    expect(exportDxf(resolve(doc()))).toBeNull();
  });

  it("is R12 in millimetres and ends with EOF", () => {
    const dxf = exportDxf(resolve(doc(addLine("l", { x: 0, y: 0, length: 10, angle: 0 }))))!;
    const pairs = pairsOf(dxf);
    const at = (name: string) => pairs.findIndex(([c, v]) => c === 9 && v === name);
    expect(pairs[at("$ACADVER") + 1]).toEqual([1, "AC1009"]);
    expect(pairs[at("$INSUNITS") + 1]).toEqual([70, "4"]);
    expect(pairs[pairs.length - 1]).toEqual([0, "EOF"]);
  });

  it("writes a line with y flipped up", () => {
    const [line] = entities(exportDxf(resolve(doc(addLine("l", { x: 5, y: 10, length: 100, angle: 90 }))))!);
    expect(line!.type).toBe("LINE");
    expect([num(line!, 10), num(line!, 20), num(line!, 11), num(line!, 21)]).toEqual([5, -10, 5, -110]);
  });

  it("writes a circle", () => {
    const [c] = entities(exportDxf(resolve(doc(addCircle("c", { cx: 10, cy: 20, diameter: 10 }))))!);
    expect(c!.type).toBe("CIRCLE");
    expect([num(c!, 10), num(c!, 20), num(c!, 40)]).toEqual([10, -20, 5]);
  });

  it("writes a rectangle as one closed polyline", () => {
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 100, height: 50 })));
    const ents = entities(exportDxf(r)!);
    expect(ents.map((e) => e.type)).toEqual(["POLYLINE", "VERTEX", "VERTEX", "VERTEX", "VERTEX", "SEQEND"]);
    expect((num(ents[0]!, 70)! & 1)).toBe(1);
    expect(num(ents[0]!, 66)).toBe(1);
    const verts = ents.filter((e) => e.type === "VERTEX").map((v) => [num(v, 10), num(v, 20)]);
    const expected = r.shapes.a!.path.map(elementStart).map(([x, y]) => [x, -y + 0]);
    expect(verts).toEqual(expected);
    for (const v of ents.filter((e) => e.type === "VERTEX")) expect(num(v, 42) ?? 0).toBe(0);
  });

  it("puts rounded corners in the polyline as bulges, clockwise as drawn", () => {
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 100, height: 50, r: [0, 10, 0, 0] })));
    const path = r.shapes.a!.path;
    const ents = entities(exportDxf(r)!).filter((e) => e.type === "VERTEX");
    expect(ents.length).toBe(path.length);
    path.forEach((e, i) => {
      const v = ents[i]!;
      const start = elementStart(e);
      expect(num(v, 10)).toBeCloseTo(start[0]);
      expect(num(v, 20)).toBeCloseTo(-start[1]);
      if (e.kind === "arc") {
        // 90° sweep, clockwise on screen: negative bulge in DXF's y-up frame.
        expect(num(v, 42)).toBeCloseTo(-Math.tan((90 * Math.PI) / 180 / 4));
        // The next vertex is where the arc ends.
        const next = ents[i + 1]!;
        expect(num(next, 10)).toBeCloseTo(arcEnd(e)[0]);
        expect(num(next, 20)).toBeCloseTo(-arcEnd(e)[1]);
      } else {
        expect(num(v, 42) ?? 0).toBe(0);
      }
    });
  });

  it("exports shapes only, never dimensions", () => {
    const r = resolve(doc(addRect("a", { x: 0, y: 0, width: 100, height: 50 }), addDimension("d", "a", "width")));
    const types = entities(exportDxf(r)!).map((e) => e.type);
    expect(types.filter((t) => t === "POLYLINE").length).toBe(1);
    expect(types).not.toContain("TEXT");
    expect(types).not.toContain("LINE");
  });
});
