// Floating panel over the canvas for a multi-selection: align, centre,
// space and equalise. The first-selected shape is the reference the others
// move to. "Keep linked" makes each action a live link instead of a
// one-off move, so the result follows later edits to the reference.

import type { Change } from "@sandtreader/collab/protocol";
import {
  KINDS, alignOnce, batch, derivedAxes, equaliseOnce, linkAlign, linkLengths, linkSpacing, newId, outerAnchors, spaceOnce,
  type AlignMode, type Axis, type EntityId, type SpacingMode,
} from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";

const SHAPE_LABEL: Record<string, string> = { rect: "Rectangle", circle: "Circle", line: "Line" };

const EQUAL_PROPS: Record<string, Array<{ prop: string; label: string }>> = {
  [KINDS.rect]: [{ prop: "width", label: "Width" }, { prop: "height", label: "Height" }],
  [KINDS.circle]: [{ prop: "diameter", label: "Diameter" }],
  [KINDS.line]: [{ prop: "length", label: "Length" }],
};

const ALIGNS: Array<{ axis: Axis; mode: AlignMode; title: string }> = [
  { axis: "x", mode: "start", title: "Align left edges" },
  { axis: "x", mode: "centre", title: "Align centres horizontally" },
  { axis: "x", mode: "end", title: "Align right edges" },
  { axis: "y", mode: "start", title: "Align top edges" },
  { axis: "y", mode: "centre", title: "Align centres vertically" },
  { axis: "y", mode: "end", title: "Align bottom edges" },
];

export function SelectionPanel() {
  const state = useDocument();
  const { editor, dispatch } = useEditor();
  const shapes = editor.selection.filter((id) => store.resolved.shapes[id]);
  if (editor.tool !== "select" || shapes.length < 2) return null;

  const [ref, ...others] = shapes as [EntityId, ...EntityId[]];
  const linked = editor.keepLinked;
  const kinds = new Set(shapes.map((id) => state.entities[id]!.kind));
  const equal = kinds.size === 1 ? EQUAL_PROPS[[...kinds][0]!] ?? [] : [];
  const commit = (c: Change | undefined) => { if (c) store.commit(c); };

  /** Items not already positioned on this axis by another link; a second link would conflict. */
  const free = (axis: Axis) => others.filter((id) => !derivedAxes(store.resolved, id).has(axis));

  const align = (axis: Axis, mode: AlignMode) => {
    if (!linked) return commit(alignOnce(store.state, ref, others, axis, mode));
    const items = free(axis);
    if (items.length) commit(linkAlign(newId("align"), ref, items, axis, mode));
  };

  const centre = () => {
    const changes = (["x", "y"] as const).flatMap((axis) => {
      if (!linked) return alignOnce(store.state, ref, others, axis, "centre") ?? [];
      const items = free(axis);
      return items.length ? [linkAlign(newId("align"), ref, items, axis, "centre")] : [];
    });
    if (changes.length) commit(batch(changes));
  };

  const space = (axis: Axis, mode: SpacingMode) => {
    if (!linked) return commit(spaceOnce(store.state, shapes, axis, mode));
    const { anchorA, anchorB, items } = outerAnchors(store.resolved, shapes, axis);
    commit(linkSpacing(newId("spacing"), anchorA, anchorB, items, axis, mode));
  };

  const equalise = (prop: string) => {
    if (!linked) return commit(equaliseOnce(store.state, ref, others, prop));
    const name = window.prompt("Variable name", prop);
    if (name === null) return;
    // The reference goes first, so the new variable takes its value.
    commit(linkLengths(store.state, shapes.map((id) => ({ id, prop })), newId("var"), name || undefined));
  };

  return (
    <div className="selection-panel" role="toolbar" aria-label="Arrange selection">
      <header>
        <strong>{shapes.length} selected</strong>
        <span className="hint" title="The first shape you selected; the others move to it">
          reference: {SHAPE_LABEL[state.entities[ref]!.kind] ?? "shape"}
        </span>
      </header>
      <div className="group">
        <span className="label">Align</span>
        <div className="icons">
          {ALIGNS.map((a) => (
            <button key={a.axis + a.mode} className="icon" title={a.title} aria-label={a.title} onClick={() => align(a.axis, a.mode)}>
              <AlignIcon axis={a.axis} mode={a.mode} />
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <span className="label">Centre</span>
        <button onClick={centre} title="Centre the others on the reference, both ways">On reference</button>
      </div>
      {shapes.length >= 3 && (
        <div className="group">
          <span className="label">Space</span>
          <div className="buttons">
            <button onClick={() => space("x", "gaps")} title="Equal gaps across, between the outermost two">Gaps ↔</button>
            <button onClick={() => space("y", "gaps")} title="Equal gaps down, between the outermost two">Gaps ↕</button>
            <button onClick={() => space("x", "centres")} title="Equal centre pitch across, between the outermost two">Centres ↔</button>
            <button onClick={() => space("y", "centres")} title="Equal centre pitch down, between the outermost two">Centres ↕</button>
          </div>
        </div>
      )}
      {equal.length > 0 && (
        <div className="group">
          <span className="label">Equal</span>
          <div className="buttons">
            {equal.map((e) => (
              <button key={e.prop} onClick={() => equalise(e.prop)} title={linked ? `Link ${e.prop}s to one shared value` : `Set ${e.prop}s to the reference's`}>
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="keep-linked" title="Off: move or resize once. On: create live links that follow the reference.">
        <input type="checkbox" checked={linked} onChange={(e) => dispatch({ type: "keepLinked", on: e.target.checked })} />
        Keep linked
      </label>
    </div>
  );
}

/** A guide line with two bars lined up against it. */
function AlignIcon({ axis, mode }: { axis: Axis; mode: AlignMode }) {
  // Drawn for x (vertical guide); y is the same rotated a quarter turn.
  const guide = mode === "start" ? 2.5 : mode === "end" ? 13.5 : 8;
  const bar = (w: number, y: number) => {
    const x = mode === "start" ? guide : mode === "end" ? guide - w : guide - w / 2;
    return <rect x={x} y={y} width={w} height={3} rx={0.5} />;
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <g transform={axis === "y" ? "rotate(90 8 8)" : undefined}>
        <line x1={guide} y1={1} x2={guide} y2={15} className="guide" />
        {bar(10, 3.5)}
        {bar(6, 9.5)}
      </g>
    </svg>
  );
}
