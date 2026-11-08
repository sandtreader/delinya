import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { formatMm } from "../canvas/Canvas";

export function StatusBar() {
  useDocument();
  const { editor } = useEditor();
  const issues = store.resolved.issues;
  const n = Object.keys(store.state.entities).length;
  return (
    <footer className="status">
      <span>{editor.cursor ? `${formatMm(editor.cursor[0])}, ${formatMm(editor.cursor[1])} mm` : ""}</span>
      <span>{editor.snap ? `snap: ${editor.snap.type}` : ""}</span>
      <span className="grow" />
      <span>{n} entities</span>
      {issues.length > 0 && <span className="warn" title={issues.map((i) => `${i.entity}: ${i.message}`).join("\n")}>{issues.length} issues</span>}
    </footer>
  );
}
