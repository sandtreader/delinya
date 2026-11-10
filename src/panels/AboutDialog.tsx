// About Delinya, from the name in the header: what it is and the version.
// The text is a placeholder until the real wording arrives.

import { useEffect } from "react";
import { useEditor } from "../app/editor";
import { APP_VERSION } from "../app/version";

export function AboutDialog() {
  const { dispatch } = useEditor();
  const close = () => dispatch({ type: "dialog", dialog: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header>
          <h2 id="about-title">About Delinya</h2>
          <button className="close" onClick={close} aria-label="Close">×</button>
        </header>
        <div className="about-body">
          <p className="about-name">Delinya <span className="about-version">version {APP_VERSION}</span></p>
          <p>2D drawing with real units.</p>
          <p>by Paul Clark <a href="https://github.com/sandtreader" target="_blank" rel="noreferrer">@sandtreader</a></p>
          <div className="buttons">
            <button className="primary" onClick={close} autoFocus>OK</button>
          </div>
        </div>
      </div>
    </div>
  );
}
