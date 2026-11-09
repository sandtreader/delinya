import { describe, it, expect } from "vitest";
import { addRect, linkAlign, linkSpacing, resolve, type Segment } from "../src/model";
import { linkGuides } from "../src/view/linkGuides";
import { doc } from "./helpers";

const PAD = 2;

function guidesFor(selection: string[], ...changes: Parameters<typeof doc>) {
  const state = doc(...changes);
  return linkGuides(state, resolve(state), selection, PAD);
}

const seg = (s: Segment) => [...s.from, ...s.to].map((v) => Math.round(v * 1000) / 1000);

describe("linkGuides", () => {
  const panel = addRect("panel", { x: 100, y: 50, width: 400, height: 200 });
  const r = addRect("r", { x: 10, y: 400, width: 60, height: 30 });
  const s = addRect("s", { x: 300, y: 500, width: 20, height: 20 });

  it("is empty with no links", () => {
    expect(guidesFor([], panel, r)).toEqual([]);
  });

  it("draws an align guide along the shared edge, spanning every shape in the link", () => {
    const [g] = guidesFor([], panel, r, s, linkAlign("al", "panel", ["r", "s"], "x", "start"));
    expect(g).toMatchObject({ link: "al", kind: "align", emphasis: false, broken: false, marks: [] });
    expect(g!.path.map(seg)).toEqual([[100, 50 - PAD, 100, 520 + PAD]]);
  });

  it("draws a centre guide through the centres for a centre link on y", () => {
    const [g] = guidesFor([], panel, r, linkAlign("al", "panel", ["r"], "y", "centre"));
    expect(g!.path.map(seg)).toEqual([[10 - PAD, 150, 500 + PAD, 150]]);
  });

  it("is stronger when the link touches the selection", () => {
    const link = linkAlign("al", "panel", ["r"], "x", "end");
    expect(guidesFor(["r"], panel, r, link)[0]!.emphasis).toBe(true);
    expect(guidesFor(["panel"], panel, r, link)[0]!.emphasis).toBe(true);
    expect(guidesFor(["s"], panel, r, s, link)[0]!.emphasis).toBe(false);
  });

  it("marks each equal gap of a gaps spacing link", () => {
    const [g] = guidesFor(
      [],
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 500, y: 0, width: 20, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      linkSpacing("sp", "p", "q", ["x"], "x", "gaps"),
    );
    expect(g).toMatchObject({ link: "sp", kind: "spacing", broken: false });
    expect(g!.path.map(seg)).toEqual([[10, 5, 50, 5], [70, 5, 110, 5]]);
    expect(g!.marks).toEqual([[30, 5], [90, 5]]);
  });

  it("marks each equal pitch of a centres spacing link, from the anchors' inner faces", () => {
    const [g] = guidesFor(
      [],
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("a", { x: 30, y: 0, width: 20, height: 10 }),
      addRect("b", { x: 60, y: 0, width: 20, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }),
      linkSpacing("sp", "p", "q", ["a", "b"], "x", "centres"),
    );
    const third = 100 / 3;
    expect(g!.path.map(seg)).toEqual([
      [10, 5, 10 + third, 5], [10 + third, 5, 10 + 2 * third, 5], [10 + 2 * third, 5, 110, 5],
    ].map((a) => a.map((v) => Math.round(v * 1000) / 1000)));
    expect(g!.marks.length).toBe(3);
  });

  it("draws gaps between shapes at the height of their centres", () => {
    const [g] = guidesFor(
      [],
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("x", { x: 50, y: 20, width: 20, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 30 }),
      linkSpacing("sp", "p", "q", ["x"], "x", "gaps"),
    );
    expect(g!.path.map(seg)).toEqual([[10, 15, 50, 15], [70, 20, 110, 20]]);
  });

  it("flags links that are not in force, drawing them where the shapes are", () => {
    const gs = guidesFor([], panel, r, linkAlign("a1", "panel", ["r"], "x", "start"), linkAlign("a2", "panel", ["r"], "x", "end"));
    const broken = gs.find((g) => g.link === "a2")!;
    expect(broken.broken).toBe(true);
    expect(broken.path.map(seg)).toEqual([[500, 50 - PAD, 500, 430 + PAD]]);
    expect(gs.find((g) => g.link === "a1")!.broken).toBe(false);
  });

  it("skips a link whose anchor is missing", () => {
    expect(guidesFor([], r, linkAlign("al", "ghost", ["r"], "x", "start"))).toEqual([]);
  });
});
