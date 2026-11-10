// Props for an element's tooltip: data-tip for the shared bubble
// (Tooltip.tsx), and the same text as its accessible description, since
// the bubble only shows after a rest and a screen reader needs it at once.
// Left out when the tooltip is just the element's name (pass the name).

export function tip(text: string, name?: string): { "data-tip": string; "aria-description"?: string } {
  return text === name ? { "data-tip": text } : { "data-tip": text, "aria-description": text };
}
