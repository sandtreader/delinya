// The drawing's own properties, in tabs: the title-block text, the grid
// (spacing for the drawing; showing and snapping for this viewer) and the
// variables, the shared values that linked lengths follow.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { KINDS, isGridSpacing, propsChanged, setDocumentProps, setGridSpacing, type DocumentField } from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { useFileName } from "../app/file";
import { Num, Row, Text } from "./fields";
import { tip } from "./tip";

type Tab = "drawing" | "grid" | "variables";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "drawing", label: "Drawing" },
  { id: "grid", label: "Grid" },
  { id: "variables", label: "Variables" },
];

const tabId = (t: Tab) => `properties-tab-${t}`;
const panelId = (t: Tab) => `properties-panel-${t}`;

/** Fields commit on blur: blur first so an edit in progress is kept. */
function blurField() {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

export function PropertiesDialog() {
  const { dispatch } = useEditor();
  const [tab, setTab] = useState<Tab>("drawing");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const close = () => {
    blurField();
    dispatch({ type: "dialog", dialog: null });
  };

  // Panels are only hidden, not unmounted, but a field being edited commits
  // on blur, so blur it rather than leave the edit waiting, unseen, on a hidden tab.
  const choose = (t: Tab, focus = false) => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('[role="tabpanel"]')) active.blur();
    setTab(t);
    if (focus) tabRefs.current[t]?.focus();
  };

  // Arrow keys move between tabs (and select them); Home and End go to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to =
      e.key === "ArrowRight" ? (i + 1) % TABS.length
      : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    choose(TABS[to]!.id, true);
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal properties-dialog" role="dialog" aria-modal="true" aria-labelledby="properties-title">
        <header>
          <h2 id="properties-title">Properties</h2>
          <button className="close" onClick={close} {...tip("Close (Esc)", "Close")} aria-label="Close">×</button>
        </header>
        <div className="tabs" role="tablist" aria-label="Properties" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }}
              id={tabId(t.id)} role="tab" className="tab"
              aria-selected={tab === t.id} aria-controls={panelId(t.id)} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => choose(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="properties-body">
          {/* Every panel stays mounted, so each tab's aria-controls names a real element. */}
          {TABS.map((t) => (
            <div key={t.id} id={panelId(t.id)} role="tabpanel" aria-labelledby={tabId(t.id)} className="tab-panel" hidden={tab !== t.id}>
              {t.id === "drawing" && <Properties />}
              {t.id === "grid" && <GridSettings />}
              {t.id === "variables" && <Variables />}
            </div>
          ))}
          <div className="buttons">
            <button className="primary" onClick={close}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Printed in the title block. */
function Properties() {
  useDocument();
  const fileName = useFileName();
  const d = store.resolved.document;
  const set = (field: DocumentField) => (v: string) => {
    const c = setDocumentProps(store.state, { [field]: v });
    if (c) store.commit(c);
  };
  return (
    <>
      <Row label="Title"><Text value={d.title} placeholder={fileName} onCommit={set("title")} /></Row>
      <Row label="Author"><Text value={d.author} onCommit={set("author")} /></Row>
      <Row label="Revision"><Text value={d.revision} onCommit={set("revision")} /></Row>
      <label className="row stacked">
        <span className="label">Notes</span>
        <Text value={d.notes} onCommit={set("notes")} multiline />
      </label>
      <p className="hint">Printed in the title block.</p>
    </>
  );
}

/** Spacing is the drawing's (saved, shared, undoable); showing and snapping are this viewer's. */
function GridSettings() {
  useDocument();
  const { editor, dispatch } = useEditor();
  const spacing = store.resolved.document.gridSpacing;
  return (
    <>
      <Row label="Spacing">
        <Num value={spacing} valid={isGridSpacing} onCommit={(v) => { const c = setGridSpacing(store.state, v); if (c) store.commit(c); }} />
      </Row>
      <label className="row check">
        <input type="checkbox" checked={editor.grid.visible} onChange={(e) => dispatch({ type: "grid", grid: { visible: e.target.checked } })} />
        Show grid
      </label>
      <label className="row check">
        <input type="checkbox" checked={editor.grid.snap} onChange={(e) => dispatch({ type: "grid", grid: { snap: e.target.checked } })} />
        Snap to grid
      </label>
      <p className="hint">
        Spacing is saved with the drawing; zoomed out, the grid shows multiples of it.
        Show and snap are your own choice, kept in this browser.
        Snapping to shapes&rsquo; points works either way.
      </p>
    </>
  );
}

function Variables() {
  const state = useDocument();
  const vars = Object.entries(state.entities).filter(([, e]) => e.kind === KINDS.variable);
  return vars.length === 0
    ? <p className="hint">None yet. Link equal lengths from the arrange panel to make one.</p>
    : (
      <>
        {vars.map(([id, e]) => (
          <Row key={id} label={(e.props.name as string | undefined) ?? id}>
            <Num value={e.props.value as number} onCommit={(v) => store.commit(propsChanged(id, { value: v }))} />
          </Row>
        ))}
      </>
    );
}
