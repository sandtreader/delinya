// Delinya's binding to @sandtreader/collab: the part of it the app's core
// uses, kept free of the package's React entry (and so of MUI), which loads
// with the session panel (session.tsx) only when it is wanted.
//
// The store is already the single point of mutation, so the adapter is
// thin: snapshots and remote changes go into the store without touching
// undo history, and everything the store emits goes to the client. The
// client's suppress() stops remote applications echoing back out.
//
// The relay is at /collab on the page's own host (Apache on st1 proxies it,
// Vite's dev server likewise), and share links are /s/<id> on the same site.

import { useSyncExternalStore } from "react";
import type { CollabClient, CollabDocument, CollabStatus } from "@sandtreader/collab/client";
import type { DrawingStore } from "../model/store";

export const COLLAB_APP = "delinya";
/** localStorage prefix for this browser's collab identity (delinya-userId, delinya-displayName). */
export const STORAGE_PREFIX = "delinya";
/** Share links: `/s/abc-defg-hij`. */
export const JOIN_PATH = "/s/";

export interface CollabConfig {
  serverUrl: string;
  sessionUrlPrefix: string;
  storageKeyPrefix: string;
}

/** Where the relay and share links are, from the page's own location. */
export function collabConfig(loc: Pick<Location, "protocol" | "host" | "origin">): CollabConfig {
  const ws = loc.protocol === "https:" ? "wss:" : "ws:";
  return {
    serverUrl: `${ws}//${loc.host}/collab`,
    sessionUrlPrefix: `${loc.origin}${JOIN_PATH}`,
    storageKeyPrefix: STORAGE_PREFIX,
  };
}

/** The page was opened from a share link, so should join its session. */
export function isJoinPath(pathname: string): boolean {
  return pathname.startsWith(JOIN_PATH) && pathname.length > JOIN_PATH.length;
}

/** How a session replaced the whole drawing: a snapshot on joining (or rejoining), or a peer opening a file. */
export type Replaced = "snapshot" | "state_replaced";

export interface CollabHooks {
  replaced?: (how: Replaced) => void;
}

export function collabDocument(store: DrawingStore, hooks: CollabHooks = {}): CollabDocument {
  return {
    getSnapshot: () => store.state,
    applySnapshot: (state) => {
      store.replace(state);
      hooks.replaced?.("snapshot");
    },
    applyChange: (change) => {
      // A whole new drawing clears undo history, as opening one does here:
      // its inverses would undo into a document that's gone.
      if (change.type === "state_replaced") {
        store.replace(change.state);
        hooks.replaced?.("state_replaced");
      } else store.applyRemote(change);
    },
  };
}

/** Wire a store to a client. Returns an unsubscribe. */
export function bindCollab(store: DrawingStore, client: CollabClient): () => void {
  return store.onEmit((change) => client.send(change));
}

/**
 * The session panel's `beforeJoin`: starting a session of our own (the
 * code the panel made up; nobody can be in it yet, so our drawing becomes
 * its state) goes straight ahead; joining one typed or pasted in, which may
 * already have a drawing to replace ours, waits for `confirm()` (unsaved
 * changes saved or let go).
 */
export function joinCheck(confirm: () => Promise<boolean>): (sessionId: string, isNew: boolean) => boolean | Promise<boolean> {
  return (_sessionId, isNew) => (isNew ? true : confirm());
}

// ---- Presence ----

type Point = readonly [number, number];

interface PresenceTarget {
  sendPresence(p: { cursor?: [number, number]; selection?: string[] }): void;
}

export interface PresenceSender {
  /** Where the pointer is on the drawing (model mm), or null off it. */
  cursor(p: Point | null): void;
  /** The shapes selected; sent when it changes. */
  selection(ids: readonly string[]): void;
  /** Send what there is now (on joining). */
  flush(): void;
}

/**
 * Cursor and selection to the others. Each message replaces what they hold
 * for you, so it carries both. The cursor goes at most every `ms` (the
 * first at once, the latest at the end of the wait); the selection at once,
 * when it changes.
 */
export function presenceSender(client: PresenceTarget, ms = 100): PresenceSender {
  let cursor: [number, number] | undefined;
  let selection: string[] | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const send = () => client.sendPresence({ ...(cursor ? { cursor } : {}), ...(selection ? { selection } : {}) });
  const wait = () => {
    timer = setTimeout(() => {
      timer = null;
      if (pending) { pending = false; send(); wait(); }
    }, ms);
  };
  return {
    cursor(p) {
      cursor = p ? [p[0], p[1]] : undefined;
      if (timer) { pending = true; return; }
      send();
      wait();
    },
    selection(ids) {
      if (selection && selection.length === ids.length && selection.every((id, i) => id === ids[i])) return;
      selection = [...ids];
      send();
    },
    flush: send,
  };
}

// ---- The app's session ----
// The client itself is made by session.tsx (its identity helpers live in
// the package's React entry); it registers here, so the core can send
// presence, show the session's state and ask about peers without loading it.

export interface SessionView {
  status: CollabStatus;
  /** Other members of the session. */
  peers: number;
}

const DISCONNECTED: SessionView = { status: "disconnected", peers: 0 };

let active: { client: CollabClient; sender: PresenceSender } | null = null;
let view: SessionView = DISCONNECTED;
/** From a connect the user asked for until it is connected: a snapshot then is joining, not rejoining. */
let joining = false;
const viewListeners = new Set<() => void>();
let replacedHandler: ((how: Replaced, joining: boolean) => void) | null = null;

function setView(v: SessionView): void {
  if (v.status === view.status && v.peers === view.peers) return;
  view = v;
  for (const fn of viewListeners) fn();
}

/** Called once by session.tsx with the app's client. Returns an unregister. */
export function registerClient(client: CollabClient): () => void {
  const sender = presenceSender(client);
  active = { client, sender };
  let last = client.status;
  const update = () => {
    const others = [...client.users.keys()].filter((id) => id !== client.userId).length;
    setView({ status: client.status, peers: client.status === "disconnected" ? 0 : others });
  };
  const offStatus = client.onStatus((s) => {
    // A reconnect goes connected → connecting → joining → connected; only
    // a fresh connect starts from disconnected.
    if (last === "disconnected" && s !== "disconnected") joining = true;
    if (s === "connected" || s === "disconnected") joining = false;
    if (s === "connected") sender.flush();
    last = s;
    update();
  });
  const offUsers = client.onUsers(update);
  update();
  return () => {
    offStatus();
    offUsers();
    if (active?.client === client) active = null;
    setView(DISCONNECTED);
  };
}

/** The pointer on the drawing (model mm), or null as it leaves; nothing outside a session. */
export function sendCursor(p: Point | null): void {
  if (active?.client.connected) active.sender.cursor(p);
}

/** The selection, sent on change (and on joining). */
export function sendSelection(ids: readonly string[]): void {
  active?.sender.selection(ids);
}

/** Other members of the session, 0 outside one. */
export function sessionPeers(): number {
  return view.peers;
}

/** The session's status and size, for the toolbar. */
export function useSessionView(): SessionView {
  return useSyncExternalStore(
    (fn) => { viewListeners.add(fn); return () => { viewListeners.delete(fn); }; },
    () => view,
  );
}

/** The app's response to a session replacing the drawing. Returns an unregister. */
export function onSessionReplaced(fn: (how: Replaced, joining: boolean) => void): () => void {
  replacedHandler = fn;
  return () => { if (replacedHandler === fn) replacedHandler = null; };
}

/** For the app's collabDocument: tell it the drawing was replaced, and whether by joining. */
export function sessionReplaced(how: Replaced): void {
  replacedHandler?.(how, joining);
}
