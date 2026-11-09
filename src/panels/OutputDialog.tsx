// Print and export: paper, orientation, scale and dimensions, a live
// preview of the pages, then Print, PDF, SVG or DXF.
//
// Print and PDF draw the same composed pages as the preview. SVG and DXF
// are always full size in mm; DXF carries shapes only, for CNC and laser.

import { useEffect, useMemo, useState } from "react";
import type { Resolved } from "../model";
import { store, useDocument } from "../app/store";
import { useEditor } from "../app/editor";
import { useFileName } from "../app/file";
import { downloadBlob } from "../app/download";
import { printPages } from "../app/print";
import {
  PAPERS, SCALES, composePages, exportDxf, exportPdf, exportSvg, formatScale, pageToSvg, titleInfo,
  type Orientation, type PrintOptions, type TitleInfo,
} from "../output";

const PREVIEW_LIMIT = 24;
const STORAGE_KEY = "delinya.output";

type Stored = Pick<PrintOptions, "orientation" | "dimensions"> & { paper: string };

// Paper, orientation and dimensions are remembered per browser; scale only
// for this session, since it belongs to the drawing.
let sessionScale: number | null = null;

function loadStored(): Stored {
  const fallback: Stored = {
    paper: /^en-(US|CA)$/i.test(navigator.language) ? "Letter" : "A4",
    orientation: "auto",
    dimensions: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Stored>) } : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(o: PrintOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ paper: o.paper.name, orientation: o.orientation, dimensions: o.dimensions }));
  } catch { /* private mode: not remembered */ }
}

/** The largest standard scale that puts the whole drawing on one sheet. */
function fitToSheet(resolved: Resolved, o: PrintOptions, info: TitleInfo): number {
  return SCALES.find((scale) => composePages(resolved, { ...o, scale }, info)?.pages.length === 1) ?? SCALES[SCALES.length - 1]!;
}

export function OutputDialog() {
  const { dispatch } = useEditor();
  useDocument();
  const resolved = store.resolved;
  const fileName = useFileName();
  const doc = resolved.document;
  const info = useMemo(() => titleInfo(doc, fileName), [doc, fileName]);

  const [options, setOptions] = useState<PrintOptions>(() => {
    const s = loadStored();
    const base: PrintOptions = { paper: PAPERS.find((p) => p.name === s.paper) ?? PAPERS[0]!, orientation: s.orientation, dimensions: s.dimensions, scale: 1 };
    return { ...base, scale: sessionScale ?? fitToSheet(resolved, base, info) };
  });
  const update = (o: Partial<PrintOptions>) => setOptions((prev) => {
    const next = { ...prev, ...o };
    saveStored(next);
    sessionScale = next.scale;
    return next;
  });

  const composed = useMemo(() => composePages(resolved, options, info), [resolved, options, info]);
  const close = () => dispatch({ type: "dialog", dialog: null });
  const print = () => { if (composed) printPages(composed.pages); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") { e.preventDefault(); print(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const download = {
    pdf: () => composed && downloadBlob(exportPdf(composed.pages, { title: info.title, author: info.author }), `${fileName}.pdf`, "application/pdf"),
    svg: () => { const s = exportSvg(resolved, { dimensions: options.dimensions }); if (s) downloadBlob(s, `${fileName}.svg`, "image/svg+xml"); },
    dxf: () => { const s = exportDxf(resolved); if (s) downloadBlob(s, `${fileName}.dxf`, "application/dxf"); },
  };

  const plan = composed?.plan;
  const sheets = plan ? plan.tiles.length : 0;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal output-dialog" role="dialog" aria-modal="true" aria-labelledby="output-title">
        <header>
          <h2 id="output-title">Print and export</h2>
          <button className="close" onClick={close} title="Close (Esc)" aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <div className="output-options">
            <section>
              <h3>Print / PDF</h3>
              <label className="row">
                <span className="label">Paper</span>
                <select value={options.paper.name} onChange={(e) => update({ paper: PAPERS.find((p) => p.name === e.target.value)! })}>
                  {PAPERS.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.width} × {p.height} mm)</option>)}
                </select>
              </label>
              <label className="row">
                <span className="label">Orientation</span>
                <select value={options.orientation} onChange={(e) => update({ orientation: e.target.value as Orientation | "auto" })}>
                  <option value="auto">Auto{plan && options.orientation === "auto" ? ` (${plan.orientation})` : ""}</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label className="row">
                <span className="label">Scale</span>
                <select value={options.scale} onChange={(e) => update({ scale: Number(e.target.value) })}>
                  {SCALES.map((s) => <option key={s} value={s}>{formatScale(s)}{s === 1 ? " (full size)" : ""}</option>)}
                </select>
                <button className="small" onClick={() => update({ scale: fitToSheet(resolved, options, info) })} title="Largest scale that fits one sheet">Fit</button>
              </label>
              <label className="row check">
                <input type="checkbox" checked={options.dimensions} onChange={(e) => update({ dimensions: e.target.checked })} />
                Dimensions and radius labels
              </label>
              <p className="hint">
                {plan
                  ? sheets === 1 ? "One sheet." : `${sheets} sheets (${plan.rows} × ${plan.cols}), overlapping 10 mm for taping. Labels A1, A2… in each title block.`
                  : "Nothing to print yet."}
              </p>
              <p className="hint">Print at 100% / “Actual size”, then check the ruler measures 100 mm.</p>
              <div className="buttons">
                <button className="primary" disabled={!composed} onClick={print} title="Print (⌘P)">Print…</button>
                <button disabled={!composed} onClick={download.pdf}>Download PDF</button>
              </div>
            </section>
            <section>
              <h3>Export full size</h3>
              <p className="hint">In mm at 1:1. SVG follows the dimensions setting; DXF has shapes only, for CNC and laser.</p>
              <div className="buttons">
                <button disabled={!composed} onClick={download.svg}>Download SVG</button>
                <button disabled={!composed} onClick={download.dxf}>Download DXF</button>
              </div>
            </section>
          </div>
          <div className="output-preview">
            {composed && plan ? (
              <>
                <div
                  className={plan.rows === 1 && plan.cols <= 3 ? "sheets one-row" : "sheets"}
                  style={{ gridTemplateColumns: `repeat(${Math.min(plan.cols, 4)}, minmax(0, 1fr))` }}
                >
                  {composed.pages.slice(0, PREVIEW_LIMIT).map((page, i) => (
                    <div key={i} className="sheet" title={plan.tiles[i]!.label} dangerouslySetInnerHTML={{ __html: pageToSvg(page) }} />
                  ))}
                </div>
                {sheets > PREVIEW_LIMIT && <p className="hint">Showing {PREVIEW_LIMIT} of {sheets} sheets.</p>}
              </>
            ) : (
              <p className="hint">Draw something first.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
