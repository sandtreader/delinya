// The drawing's own properties (printed in the title block) and its
// variables, the shared values that linked lengths follow.

import { useEffect } from "react";
import { KINDS, propsChanged, setDocumentProps, type DocumentField } from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { useFileName } from "../app/file";
import { Num, Row, Text } from "./fields";
import { tip } from "./tip";

export function PropertiesDialog() {
  const { dispatch } = useEditor();
  // Fields commit on blur: blur first so an edit in progress is kept.
  const close = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    dispatch({ type: "dialog", dialog: null });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
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
        <div className="properties-body">
          <Properties />
          <Variables />
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
    <section>
      <h3>Drawing</h3>
      <Row label="Title"><Text value={d.title} placeholder={fileName} onCommit={set("title")} /></Row>
      <Row label="Author"><Text value={d.author} onCommit={set("author")} /></Row>
      <Row label="Revision"><Text value={d.revision} onCommit={set("revision")} /></Row>
      <label className="row stacked">
        <span className="label">Notes</span>
        <Text value={d.notes} onCommit={set("notes")} multiline />
      </label>
    </section>
  );
}

function Variables() {
  const state = useDocument();
  const vars = Object.entries(state.entities).filter(([, e]) => e.kind === KINDS.variable);
  return (
    <section>
      <h3>Variables</h3>
      {vars.length === 0
        ? <p className="hint">None yet. Link equal lengths from the arrange panel to make one.</p>
        : vars.map(([id, e]) => (
          <Row key={id} label={(e.props.name as string | undefined) ?? id}>
            <Num value={e.props.value as number} onCommit={(v) => store.commit(propsChanged(id, { value: v }))} />
          </Row>
        ))}
    </section>
  );
}
