import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import {
  addDimension, addRadiusLabel, addRect, addVariable, alignLinksAmong, linkAlign, linkLengths, linkSpacing, resolve,
  setAlignMode, unlinkAlign, unlinkSpacing, unlinkTarget,
} from "../src/model";
import { describeLink, linkButtons } from "../src/view/linkButtons";
import { doc } from "./helpers";

const PAD = 2;
const apply = (s: DocState, c: Change | undefined) => { expect(c).toBeDefined(); return applyChange(s, c!); };

const panel = addRect("panel", { x: 100, y: 50, width: 400, height: 200 });
const r = addRect("r", { x: 10, y: 400, width: 60, height: 30 });
const s = addRect("s", { x: 300, y: 500, width: 20, height: 20 });

/** Two shelves sharing a "shelf" width, each with its width dimension. */
function shelves() {
  let st = doc(
    addRect("A", { x: 0, y: 100, width: 200, height: 30 }),
    addRect("B", { x: 0, y: 200, width: 180, height: 30 }),
    addVariable("v", 200, "shelf"),
    addDimension("dA", "A", "width"),
    addDimension("dB", "B", "width"),
  );
  st = apply(st, linkLengths(st, [{ id: "A", prop: "width" }, { id: "B", prop: "width" }], "v"));
  return st;
}

describe("unlinkTarget", () => {
  it("removes align and spacing links as unlinking them does", () => {
    const st = doc(panel, r, linkAlign("al", "panel", ["r"], "x", "end"));
    expect(unlinkTarget(st, { kind: "link", id: "al" })).toEqual(unlinkAlign(st, "al"));
    const sp = doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }), addRect("x", { x: 50, y: 0, width: 20, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }), linkSpacing("sp", "p", "q", ["x"], "x", "gaps"),
    );
    expect(unlinkTarget(sp, { kind: "link", id: "sp" })).toEqual(unlinkSpacing(sp, "sp"));
  });

  it("unlinks one shape's length from its variable, keeping its value", () => {
    const st = apply(shelves(), unlinkTarget(shelves(), { kind: "value", shape: "B", prop: "width" }));
    expect(st.entities.B!.props.width).toBe(200);
    expect(st.entities.A!.props.width).toEqual({ ref: "v" });
  });

  it("unlinks one corner radius", () => {
    let st = doc(addVariable("v", 5), addRect("k", { x: 0, y: 0, width: 50, height: 50, r: [0, { ref: "v" }, 0, 3] }));
    st = apply(st, unlinkTarget(st, { kind: "value", shape: "k", prop: "r", corner: 1 }));
    expect(st.entities.k!.props.r).toEqual([0, 5, 0, 3]);
  });

  it("does nothing for something that isn't linked", () => {
    expect(unlinkTarget(shelves(), { kind: "link", id: "nope" })).toBeUndefined();
    expect(unlinkTarget(shelves(), { kind: "value", shape: "A", prop: "height" })).toBeUndefined();
  });
});

describe("alignLinksAmong / setAlignMode", () => {
  const st = doc(
    panel, r, s,
    linkAlign("ax", "panel", ["r"], "x", "centre"),
    linkAlign("ay", "panel", ["r", "s"], "y", "start"),
    linkAlign("other", "s", ["r"], "x", "end"),
  );

  it("finds the links on an axis whose anchor and at least one item are selected", () => {
    expect(alignLinksAmong(st, ["panel", "r"], "x").map(([id, l]) => [id, l.mode])).toEqual([["ax", "centre"]]);
    expect(alignLinksAmong(st, ["panel", "r"], "y").map(([id]) => id)).toEqual(["ay"]);
    expect(alignLinksAmong(st, ["r", "s"], "x").map(([id]) => id)).toEqual(["other"]);
    expect(alignLinksAmong(st, ["panel"], "x")).toEqual([]);
  });

  it("changes a link's mode, or does nothing if it's already that or isn't an align link", () => {
    expect(setAlignMode(st, "ax", "start")).toEqual({ type: "props_changed", id: "ax", props: { mode: "start" } });
    expect(setAlignMode(st, "ax", "centre")).toBeUndefined();
    expect(setAlignMode(st, "panel", "start")).toBeUndefined();
    const left = resolve(apply(st, setAlignMode(st, "ax", "start")));
    expect(left.shapes.r!.bounds.minX).toBe(100);
  });
});

describe("linkButtons", () => {
  it("puts an align link's button at the start of its guide", () => {
    const st = doc(panel, r, linkAlign("al", "panel", ["r"], "x", "centre"));
    expect(linkButtons(st, resolve(st), ["panel", "r"], PAD)).toEqual([
      { target: { kind: "link", id: "al" }, at: [300, 50 - PAD], label: "Aligned: centres across" },
    ]);
    const y = doc(panel, r, linkAlign("al", "panel", ["r"], "y", "end"));
    expect(linkButtons(y, resolve(y), ["r", "panel"], PAD)[0]!.at).toEqual([10 - PAD, 250]);
  });

  it("shows only links joining two or more selected shapes", () => {
    const st = doc(panel, r, s, linkAlign("al", "panel", ["r"], "x", "start"));
    expect(linkButtons(st, resolve(st), ["panel", "s"], PAD)).toEqual([]);
    expect(linkButtons(st, resolve(st), ["r"], PAD)).toEqual([]);
  });

  it("puts a spacing link's button on its first = mark", () => {
    const st = doc(
      addRect("p", { x: 0, y: 0, width: 10, height: 10 }), addRect("x", { x: 50, y: 0, width: 20, height: 10 }),
      addRect("q", { x: 110, y: 0, width: 10, height: 10 }), linkSpacing("sp", "p", "q", ["x"], "x", "gaps"),
    );
    expect(linkButtons(st, resolve(st), ["p", "x"], PAD)).toEqual([
      { target: { kind: "link", id: "sp" }, at: [30, 5], label: "Equal spacing: gaps" },
    ]);
  });

  it("gives each selected shape sharing a variable a button on its dimension", () => {
    const st = shelves();
    const res = resolve(st);
    const dA = res.dimensions.find((d) => d.id === "dA")!.line, dB = res.dimensions.find((d) => d.id === "dB")!.line;
    const mid = (l: typeof dA) => [(l.from[0] + l.to[0]) / 2, (l.from[1] + l.to[1]) / 2];
    expect(linkButtons(st, res, ["A", "B"], PAD)).toEqual([
      { target: { kind: "value", shape: "A", prop: "width" }, at: mid(dA), label: "= shelf" },
      { target: { kind: "value", shape: "B", prop: "width" }, at: mid(dB), label: "= shelf" },
    ]);
    expect(linkButtons(st, res, ["A"], PAD)).toEqual([]);
  });

  it("uses the radius label for a linked corner", () => {
    let st = doc(
      addVariable("v", 5, "fillet"),
      addRect("k", { x: 0, y: 0, width: 50, height: 50, r: [0, { ref: "v" }, 0, 0] }),
      addRect("m", { x: 100, y: 0, width: 50, height: 50, r: [0, { ref: "v" }, 0, 0] }),
      addRadiusLabel("lk", "k", 1),
    );
    st = apply(st, { type: "props_changed", id: "m", props: {} } as Change);
    const res = resolve(st);
    const label = res.radiusLabels.find((l) => l.id === "lk")!;
    expect(linkButtons(st, res, ["k", "m"], PAD)).toEqual([
      { target: { kind: "value", shape: "k", prop: "r", corner: 1 }, at: label.at, label: "= fillet" },
    ]);
  });

  it("describes any link for a popup", () => {
    const st = doc(panel, r, linkAlign("al", "panel", ["r"], "y", "start"));
    expect(describeLink(st, { kind: "link", id: "al" })).toBe("Aligned: top edges");
    expect(describeLink(shelves(), { kind: "value", shape: "A", prop: "width" })).toBe("= shelf");
    expect(describeLink(st, { kind: "link", id: "gone" })).toBe("Link");
  });
});
