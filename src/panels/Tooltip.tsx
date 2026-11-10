// The one tooltip, mounted once. Any element with data-tip gets it after
// the pointer rests on it for a second (or it has keyboard focus), like
// the browser's title tooltip but in our style, over everything and never
// clipped by a scrolling panel. data-tip-side picks the side: "below" by
// default, "right" in a palette, "above" in the status bar; placeTip flips
// it when there is no room. A click, key, wheel or window switch hides it,
// and nothing shows while a button is held, so drags don't pop tips.
// Timing and placement are in view/tooltip.ts.
//
// The element under the pointer comes from pointerover's target and from
// pointerout's relatedTarget, so a browser that sends nothing to a
// disabled button still finds its tip.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TipTimer, placeTip, type TipSide } from "../view/tooltip";

const ID = "tooltip";
const SIDES: readonly string[] = ["below", "above", "right", "left"] satisfies TipSide[];

interface Shown { anchor: HTMLElement; text: string }

/** The nearest element with a tip, from an event target. */
function anchorOf(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null;
}

/** An element's tip now: none once it's gone from the page or lost its data-tip. */
function tipOf(el: HTMLElement): string | null {
  return el.isConnected ? el.getAttribute("data-tip") || null : null;
}

/** Put the bubble on its anchor's side, inside the window. */
function place(bubble: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect(), b = bubble.getBoundingClientRect();
  const asked = anchor.getAttribute("data-tip-side") ?? "";
  const side = (SIDES.includes(asked) ? asked : "below") as TipSide;
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const p = placeTip({ x: a.left, y: a.top, w: a.width, h: a.height }, { w: b.width, h: b.height }, { w, h }, side);
  bubble.style.left = `${Math.round(p.x)}px`;
  bubble.style.top = `${Math.round(p.y)}px`;
}

/**
 * Shrink a bubble whose text wraps to its longest line. CSS leaves a
 * wrapped max-content box at its max-width, with space at the right.
 */
function fit(bubble: HTMLElement): void {
  bubble.style.width = "";
  const range = document.createRange();
  range.selectNodeContents(bubble);
  const lines = [...range.getClientRects()];
  if (lines.length < 2) return;
  const text = Math.max(...lines.map((r) => r.right)) - Math.min(...lines.map((r) => r.left));
  const cs = getComputedStyle(bubble);
  const edges = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
  bubble.style.width = `${Math.ceil(text + edges.reduce((sum, k) => sum + parseFloat(cs[k]), 0))}px`;
}

function describe(anchor: HTMLElement, on: boolean): void {
  const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== ID);
  if (on) ids.push(ID);
  if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
  else anchor.removeAttribute("aria-describedby");
}

export function Tooltip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let hovered: HTMLElement | null = null;   // the tipped element under the pointer
    let focused: HTMLElement | null = null;   // the tipped element with keyboard focus
    let active: HTMLElement | null = null;    // the one entered last: showing or on its way
    let showing: Shown | null = null;
    let frame = 0;

    const timer = new TipTimer<HTMLElement>((el) => {
      cancelAnimationFrame(frame);
      const text = el && tipOf(el);
      showing = el && text ? { anchor: el, text } : null;
      setShown(showing);
      if (showing) frame = requestAnimationFrame(track);
    });

    // While it shows: follow the anchor if it moves or its tip changes, and
    // hide when the anchor goes (a peer deleted the layer, say).
    const track = () => {
      if (!showing) return;
      const { anchor } = showing;
      const text = tipOf(anchor);
      if (!text) {
        if (hovered === anchor) hovered = null;
        if (focused === anchor) focused = null;
        active = null;
        timer.leave();
        return;
      }
      if (text !== showing.text) { showing = { anchor, text }; setShown(showing); }
      else if (bubble.current) place(bubble.current, anchor);
      frame = requestAnimationFrame(track);
    };

    const enter = (el: HTMLElement) => { active = el; timer.enter(el); };
    /** `el` has lost the pointer or focus: hide its tip if that's the one up. */
    const leave = (el: HTMLElement | null) => {
      if (el && el === active) { active = null; timer.leave(); }
    };

    const hover = (target: EventTarget | null, e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const anchor = anchorOf(target);
      if (anchor === hovered) return;
      leave(hovered);
      hovered = anchor;
      // Not while a button is held: a drag passing over.
      if (anchor && !e.buttons) enter(anchor);
    };
    const onOver = (e: PointerEvent) => hover(e.target, e);
    // Where the pointer went; null when it left the window.
    const onOut = (e: PointerEvent) => hover(e.relatedTarget, e);

    const onFocusIn = (e: FocusEvent) => {
      // Keyboard focus only: a click focuses a button too.
      const anchor = e.target instanceof Element && e.target.matches(":focus-visible") ? anchorOf(e.target) : null;
      focused = anchor;
      if (anchor) enter(anchor);
    };
    const onFocusOut = () => { leave(focused); focused = null; };

    const press = () => timer.press();
    // Focus moving into a scrolled panel scrolls it: that mustn't cancel a tip on its way.
    const onScroll = () => { if (showing) timer.press(); };

    const listeners: Array<[string, EventListener, AddEventListenerOptions]> = [
      ["pointerover", onOver as EventListener, { capture: true }],
      ["pointerout", onOut as EventListener, { capture: true }],
      ["pointerdown", press, { capture: true }],
      ["keydown", press, { capture: true }],
      ["wheel", press, { capture: true, passive: true }],
      ["scroll", onScroll, { capture: true, passive: true }],
      ["focusin", onFocusIn as EventListener, { capture: true }],
      ["focusout", onFocusOut, { capture: true }],
    ];
    for (const [type, fn, options] of listeners) document.addEventListener(type, fn, options);
    window.addEventListener("blur", press);
    return () => {
      for (const [type, fn, options] of listeners) document.removeEventListener(type, fn, options);
      window.removeEventListener("blur", press);
      timer.press();
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shown) return;
    if (bubble.current) { fit(bubble.current); place(bubble.current, shown.anchor); }
    // The tip describes its anchor while it shows, unless it's just the anchor's name.
    if (shown.text === shown.anchor.getAttribute("aria-label")) return;
    describe(shown.anchor, true);
    return () => describe(shown.anchor, false);
  }, [shown]);

  if (!shown) return null;
  return <div ref={bubble} id={ID} role="tooltip" className="tooltip">{shown.text}</div>;
}
