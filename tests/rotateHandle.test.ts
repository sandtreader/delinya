import { describe, it, expect } from "vitest";
import { applyChange, type Change, type DocState } from "@sandtreader/collab/protocol";
import { addRect, handlesFor, linkAlign, linkLocks, resizeTo, resolve, rotateShapes, turnTo } from "../src/model";
import type { ResolvedRect } from "../src/model";
import { editorReducer, initialEditor } from "../src/app/editor";
import { positionStatus } from "../src/view/format";
import { dragTurn, rotateHandleAt, ROTATE_HANDLE_PX } from "../src/view/rotateHandle";
import { snapPoint } from "../src/canvas/snap";
import { doc } from "./helpers";

// Rotation, step 2: resize handles on a turned rect work in its own frame,
// and the canvas gets a rotate handle above the selection that turns it
// about its centre (whole degrees; Shift snaps to 15°).

const apply = (state: DocState, c: Change | undefined): DocState => {
  expect(c).toBeDefined();
  return applyChange(state, c!);
};
const rect = (state: DocState, id = "r") => resolve(state).shapes[id] as ResolvedRect;
const props = (state: DocState, id: string) => state.entities[id]!.props as Record<string, unknown>;

// 100 × 50 turned a quarter: tl (0,0), tr (0,100), br (-50,100), bl (-50,0).
const turned = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, rotation: 90 }));

describe("resize handles on a turned rect", () => {
  it("sit on its turned corners, anchored on the opposite one", () => {
    const hs = handlesFor(rect(turned));
    expect(hs.map((h) => h.point)).toEqual([[0, 0], [0, 100], [-50, 100], [-50, 0]]);
    expect(hs.map((h) => h.anchor)).toEqual([[-50, 100], [-50, 0], [0, 0], [0, 100]]);
  });

  it("point their cursors along the turned diagonals", () => {
    const hs = handlesFor(rect(turned));
    // Top-left now sits top right of its anchor.
    expect(hs.map((h) => h.cursor)).toEqual(["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]);
  });

  it("are off while a link places it", () => {
    const st = doc(
      addRect("a", { x: 0, y: 0, width: 10, height: 10 }),
      addRect("r", { x: 100, y: 0, width: 100, height: 50, rotation: 30 }),
      linkAlign("k", "a", ["r"], "x", "start"),
    );
    const res = resolve(st);
    expect(handlesFor(res.shapes.r!, linkLocks(res, "r"))).toEqual([]);
  });

  it("size it along its own sides, keeping the anchor and the turn", () => {
    const [tl, , br] = handlesFor(rect(turned));
    const big = apply(turned, resizeTo(turned, "r", br!.handle, [-60, 120], br!.anchor));
    expect(props(big, "r")).toMatchObject({ x: 0, y: 0, width: 120, height: 60, rotation: 90 });
    expect(rect(big).corners[2]).toEqual([-60, 120]);

    const moved = apply(turned, resizeTo(turned, "r", tl!.handle, [10, -10], tl!.anchor));
    expect(props(moved, "r")).toMatchObject({ x: 10, y: -10, width: 110, height: 60, rotation: 90 });
    expect(rect(moved).corners[2]).toEqual([-50, 100]);
  });

  it("flip across the anchor rather than going negative", () => {
    const br = handlesFor(rect(turned))[2]!;     // anchor tl (0,0)
    const st = apply(turned, resizeTo(turned, "r", br.handle, [10, -20], br.anchor));
    expect(props(st, "r")).toMatchObject({ x: 10, y: -20, width: 20, height: 10, rotation: 90 });
    expect(rect(st).corners).toContainEqual([0, 0]);
  });
});

describe("turnTo", () => {
  const base = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50 }));

  it("turns from a base state, as rotateShapes does", () => {
    expect(turnTo(base, ["r"], 30, [50, 25])).toEqual(rotateShapes(base, ["r"], 30, [50, 25]));
  });

  it("puts the shapes back at no turn, so a drag can return to where it began", () => {
    const st = apply(base, rotateShapes(base, ["r"], 30));
    const back = apply(st, turnTo(base, ["r"], 0, [50, 25]));
    expect(rect(back).corners).toEqual(rect(base).corners);
    expect(rect(back).rotation).toBe(0);
  });

  it("is undefined with no shapes", () => {
    expect(turnTo(base, ["nope"], 10, [0, 0])).toBeUndefined();
  });
});

describe("the rotate handle", () => {
  it("sits a fixed screen distance above the top centre of the bounds", () => {
    expect(ROTATE_HANDLE_PX).toBeGreaterThan(0);
    const scale = 2;
    expect(rotateHandleAt({ minX: 0, minY: 20, maxX: 100, maxY: 50 }, scale)).toEqual([50, 20 - ROTATE_HANDLE_PX / scale]);
  });

  it("turns by the angle swept about the pivot, clockwise on screen", () => {
    expect(dragTurn([0, 0], [0, -10], [10, 0], false)).toBe(90);
    expect(dragTurn([0, 0], [0, -10], [-10, 0], false)).toBe(-90);
  });

  it("takes the short way round across ±180°", () => {
    expect(dragTurn([0, 0], [-10, -1], [-10, 1], false)).toBe(-11);
  });

  it("turns by whole degrees, or 15° steps with Shift", () => {
    // From straight up to atan2(-9, 10): 48.01°.
    expect(dragTurn([0, 0], [0, -10], [10, -9], false)).toBe(48);
    expect(dragTurn([0, 0], [0, -10], [10, -9], true)).toBe(45);
    // 37°: nearer 30 than 45.
    const p: [number, number] = [Math.sin((37 * Math.PI) / 180) * 10, -Math.cos((37 * Math.PI) / 180) * 10];
    expect(dragTurn([0, 0], [0, -10], p, true)).toBe(30);
  });

  it("is 0 with the pointer on the pivot", () => {
    expect(dragTurn([5, 5], [5, 5], [10, 10], false)).toBe(0);
  });
});

describe("the status bar while turning", () => {
  const r = resolve(doc(addRect("a", { x: 10, y: 20, width: 50, height: 30 })));
  const idle = { tool: "select" as const, selection: ["a"], cursor: null, draw: null, measure: null };

  it("says how far and which way", () => {
    expect(positionStatus({ ...idle, turn: 30 }, r)).toBe("turn 30° clockwise");
    expect(positionStatus({ ...idle, turn: -45 }, r)).toBe("turn 45° anticlockwise");
    expect(positionStatus({ ...idle, turn: 0 }, r)).toBe("turn 0°");
    expect(positionStatus({ ...idle, turn: null }, r)).toBe("from 10, 20 mm · 50 × 30 mm");
  });

  it("is held in editor state by the pointer action", () => {
    const on = editorReducer(initialEditor, { type: "pointer", cursor: [0, 0], snap: null, turn: 15 });
    expect(on.turn).toBe(15);
    const off = editorReducer(on, { type: "pointer", cursor: [1, 1], snap: null });
    expect(off.turn).toBeNull();
  });
});

describe("snapping a turned rect's corner", () => {
  const turned30 = doc(addRect("r", { x: 0, y: 0, width: 100, height: 50, rotation: 30 }));
  const local = (p: readonly number[], origin: readonly number[], deg: number) => {
    const t = (-deg * Math.PI) / 180, dx = p[0]! - origin[0]!, dy = p[1]! - origin[1]!;
    return [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
  };
  const onGrid = (v: number, g: number) => Math.abs(v / g - Math.round(v / g)) < 1e-9;

  it("rounds to the grid in a given frame", () => {
    const res = resolve(doc());
    // A quarter turn about the origin: local (123, 47) rounds to (120, 50).
    expect(snapPoint(res, [-47, 123], 1, new Set(), 10, undefined, undefined, { origin: [0, 0], angle: 90 }))
      .toEqual({ point: [-50, 120], snap: null });
    const { point } = snapPoint(res, [61.3, 77.9], 1, new Set(), 5, undefined, undefined, { origin: [10, 20], angle: 30 });
    const [lx, ly] = local(point, [10, 20], 30);
    expect(onGrid(lx!, 5) && onGrid(ly!, 5)).toBe(true);
  });

  it("rounds to 0.01 mm in the frame with grid snap off", () => {
    const { point } = snapPoint(resolve(doc()), [61.3456, 77.9123], 1, new Set(), null, undefined, undefined, { origin: [10, 20], angle: 30 });
    const [lx, ly] = local(point, [10, 20], 30);
    expect(onGrid(lx!, 0.01) && onGrid(ly!, 0.01)).toBe(true);
  });

  it("still lands on another shape's snap point", () => {
    const res = resolve(doc(addRect("o", { x: 200, y: 200, width: 10, height: 10 })));
    expect(snapPoint(res, [200.4, 200.3], 1, new Set(), 10, undefined, undefined, { origin: [0, 0], angle: 30 }).point).toEqual([200, 200]);
  });

  it("gives whole grid sizes when the snapped point resizes the rect", () => {
    const br = handlesFor(rect(turned30))[2]!;
    const frame = { origin: br.anchor!, angle: 30 };
    const { point } = snapPoint(resolve(turned30), [70, 120], 1, new Set(["r"]), 10, undefined, undefined, frame);
    const st = apply(turned30, resizeTo(turned30, "r", br.handle, point, br.anchor));
    const p = props(st, "r");
    expect(onGrid(p.width as number, 10) && onGrid(p.height as number, 10)).toBe(true);
    expect(Number.isInteger(p.width) && Number.isInteger(p.height)).toBe(true);
    expect(p.rotation).toBe(30);
  });
});
