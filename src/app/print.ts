// Print composed pages through the browser.
//
// The pages go into a print-only element as true-size SVGs, one per sheet,
// with an @page rule for the paper size and no browser margins (the pages
// carry their own). Everything else is hidden while printing. Scale is only
// exact when the print dialog is at 100% / "Actual size"; the check ruler on
// each page shows whether it was.

import { pageToSvg, type PageDrawing } from "../output";

export function printPages(pages: PageDrawing[]): void {
  const first = pages[0];
  if (!first) return;

  const style = document.createElement("style");
  style.textContent = `@page { size: ${first.width}mm ${first.height}mm; margin: 0; }`;
  const root = document.createElement("div");
  root.className = "print-pages";
  root.innerHTML = pages.map(pageToSvg).join("");
  document.head.append(style);
  document.body.append(root);
  document.body.classList.add("printing");

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    document.body.classList.remove("printing");
    root.remove();
    style.remove();
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
