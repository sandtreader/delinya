// Collaborate: a toolbar button between Properties and Print opening a card
// with SynFlo's session panel (display name, join by ID, share link and QR
// code, members, leave). The panel loads with the card (collab/session.tsx
// brings MUI), so the app starts without it. A dot on the button says a
// session is on: green connected, amber connecting or joining.

import { Suspense, lazy } from "react";
import { useEditor } from "../app/editor";
import { useSessionView } from "../collab";
import { PopCard } from "./ActionCards";
import { CollabIcon } from "./icons";

const SessionCard = lazy(() => import("../collab/session").then((m) => ({ default: m.SessionCard })));

export function CollabButton() {
  const { editor, dispatch } = useEditor();
  const { status, peers } = useSessionView();
  const on = status !== "disconnected";
  const state = status === "connected" ? `in a session${peers ? ` with ${peers} other${peers === 1 ? "" : "s"}` : ", on your own so far"}`
    : status === "disconnected" ? "" : "joining…";
  return (
    <PopCard
      open={editor.collab} onOpen={() => dispatch({ type: "collab", open: true })} onClose={() => dispatch({ type: "collab", open: false })}
      label="Collaborate…" tip={`Collaborate: share this drawing live with others${state ? ` (${state})` : ""}`}
      icon={<CollabIcon />} className="collab-card"
      badge={on && <span className={`session-dot ${status === "connected" ? "connected" : "joining"}`} aria-hidden="true" />}
    >
      <Suspense fallback={<div className="collab-loading">Loading…</div>}>
        <SessionCard />
      </Suspense>
    </PopCard>
  );
}
