// Floating panel top right of the canvas for the selection. One shape (any
// tool, so a just-drawn shape can be sized): its exact values. Two or more
// (select tool): align, centre, space and equalise. The first-selected
// shape is the reference the others move to. "Keep linked" makes each
// action a live link instead of a one-off move, so the result follows
// later edits to the reference.

import { applyChange, type Change } from "@sandtreader/collab/protocol";
import {
  KINDS, alignLinksAmong, alignOnce, batch, deleteEntity, derivedAxes, equaliseOnce, linkAlign, linkLengths, linkSpacing, newId, outerAnchors, setAlignMode, spaceOnce,
  type AlignMode, type Axis, type EntityId, type SpacingMode,
} from "../model";
import { store, useDocument } from "../app/store";
import { panelFor, useEditor } from "../app/editor";
import { ShapeFields } from "./ShapeFields";
import { LayerSelect, hasLayerChoice } from "./LayerSelect";

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
  useDocument();
  const { editor, dispatch } = useEditor();
  const shapes = store.resolved.shapes;
  const panel = panelFor(editor.tool, editor.selection, shapes);
  if (!panel) return null;
  const ids = editor.selection.filter((id) => Object.hasOwn(shapes, id));
  const remove = () => { deleteSelection(ids); dispatch({ type: "select", ids: [] }); };

  return (
    <div
      className="selection-panel"
      role={panel === "shape" ? "region" : "toolbar"}
      aria-label={panel === "shape" ? "Selected shape" : "Arrange selection"}
    >
      {panel === "shape" ? <ShapeFields id={ids[0]!} /> : <Arrange shapes={ids} />}
      <div className="actions">
        <button className="danger" onClick={remove} title="Delete (Del)">Delete</button>
      </div>
    </div>
  );
}

/** Deletes the shapes, with their dimensions and link memberships, as one undo step. */
export function deleteSelection(ids: EntityId[]) {
  const changes = [];
  let state = store.state;
  for (const id of ids) {
    const c = deleteEntity(state, id);
    if (c) { changes.push(c); state = applyChange(state, c); }
  }
  if (changes.length === 1) store.commit(changes[0]!);
  else if (changes.length > 1) store.commit(batch(changes));
}

function Arrange({ shapes }: { shapes: EntityId[] }) {
  const state = useDocument();
  const { editor, dispatch } = useEditor();
  const [ref, ...others] = shapes as [EntityId, ...EntityId[]];
  const linked = editor.keepLinked;
  const kinds = new Set(shapes.map((id) => state.entities[id]!.kind));
  const equal = kinds.size === 1 ? EQUAL_PROPS[[...kinds][0]!] ?? [] : [];
  const commit = (c: Change | undefined) => { if (c) store.commit(c); };

  /** Items not already positioned on this axis by another link; a second link would conflict. */
  const free = (axis: Axis) => others.filter((id) => !derivedAxes(store.resolved, id).has(axis));

  // Align links already joining the selection, per axis: shown pressed, and
  // the align buttons for that axis change their mode instead of adding more.
  const existing = { x: alignLinksAmong(state, shapes, "x"), y: alignLinksAmong(state, shapes, "y") };
  const current = (axis: Axis) => new Set(existing[axis].map(([, l]) => l.mode));

  /** The change for aligning one axis: retarget existing links, else move once or link. */
  const alignChange = (axis: Axis, mode: AlignMode): Change | undefined => {
    if (existing[axis].length) {
      const changes = existing[axis].map(([id]) => setAlignMode(store.state, id, mode)).filter((c): c is Change => !!c);
      return changes.length ? batch(changes) : undefined;
    }
    if (!linked) return alignOnce(store.state, ref, others, axis, mode);
    const items = free(axis);
    return items.length ? linkAlign(newId("align"), ref, items, axis, mode) : undefined;
  };

  const align = (axis: Axis, mode: AlignMode) => commit(alignChange(axis, mode));

  const centre = () => {
    const changes = (["x", "y"] as const).flatMap((axis) => alignChange(axis, "centre") ?? []);
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
    <>
      <header>
        <strong>{shapes.length} selected</strong>
        <span className="hint" title="The first shape you selected; the others move to it">
          reference: {SHAPE_LABEL[state.entities[ref]!.kind] ?? "shape"}
        </span>
      </header>
      {hasLayerChoice() && (
        <div className="group">
          <span className="label">Layer</span>
          <LayerSelect ids={shapes} />
        </div>
      )}
      {(["x", "y"] as const).map((axis) => {
        const on = current(axis);
        return (
          <div className="group" key={axis}>
            <span className="label">{axis === "x" ? "Across" : "Down"}</span>
            <div className="icons">
              {ALIGNS.filter((a) => a.axis === axis).map((a) => {
                const pressed = on.has(a.mode);
                const title = pressed ? `${a.title} (linked)` : on.size ? `${a.title}: change the link to this` : a.title;
                return (
                  <button
                    key={a.mode} className={pressed ? "icon linked" : "icon"} aria-pressed={pressed}
                    title={title} aria-label={title} onClick={() => align(a.axis, a.mode)}
                  >
                    <AlignIcon axis={a.axis} mode={a.mode} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
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
    </>
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
