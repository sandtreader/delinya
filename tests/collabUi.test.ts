import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyState, type DocState } from "@sandtreader/collab/protocol";
import { addRect, DrawingStore } from "../src/model";
import { answer, currentQuestion } from "../src/app/ask";
import { confirmBeforeJoin, currentFileName, detachFile } from "../src/app/file";
import { store } from "../src/app/store";
import { collabConfig, collabDocument, joinCheck, presenceSender } from "../src/collab";
import pkg from "../package.json";
import viteConfig from "../vite.config.ts?raw";
import htaccess from "../public/.htaccess?raw";
import toolbarSource from "../src/panels/Toolbar.tsx?raw";
import appSource from "../src/App.tsx?raw";
import canvasSource from "../src/canvas/Canvas.tsx?raw";
import collabSource from "../src/collab/index.ts?raw";
import sessionSource from "../src/collab/session.tsx?raw";
import { waitFor } from "./helpers";

// Collaboration, as SynFlo does it: the shared SessionPanel (display name,
// join by ID, share link and QR code, members, leave) in a card from a
// toolbar button between Properties and Print, and other people's cursors
// on the drawing. The relay is reached at /collab on the page's own host
// (Apache on st1, Vite's proxy in development), and share links are
// /s/abc-defg-hij on the same site. Joining someone else's session (not
// starting one of our own) with unsaved changes asks to
// save them first, since a session that already has a drawing replaces
// yours. A drawing that arrives from a session is no longer your file, so
// Save can't overwrite it with someone else's drawing.

describe("where the relay and share links are", () => {
  it("is the page's own host, wss under https", () => {
    expect(collabConfig({ protocol: "https:", host: "delinya.net", origin: "https://delinya.net" })).toEqual({
      serverUrl: "wss://delinya.net/collab",
      sessionUrlPrefix: "https://delinya.net/s/",
      storageKeyPrefix: "delinya",
    });
    expect(collabConfig({ protocol: "http:", host: "192.168.0.42:5174", origin: "http://192.168.0.42:5174" })).toMatchObject({
      serverUrl: "ws://192.168.0.42:5174/collab",
      sessionUrlPrefix: "http://192.168.0.42:5174/s/",
    });
  });

  it("is proxied to a local relay in development, which pnpm relay runs", () => {
    expect(viteConfig).toMatch(/["']\/collab["']/);
    expect(viteConfig).toMatch(/ws:\s*true/);
    expect(viteConfig).toMatch(/2901/);
    expect((pkg.scripts as Record<string, string>).relay).toMatch(/collab-relay/);
    expect((pkg.scripts as Record<string, string>).relay).toMatch(/2901/);
  });

  it("serves the app for share links on the live site", () => {
    expect(htaccess).toMatch(/RewriteEngine\s+On/);
    expect(htaccess).toMatch(/RewriteRule\s+\^s\/\s+\/?index\.html/);
  });
});

describe("the toolbar", () => {
  it("has a Collaborate button between Properties and Print", () => {
    const at = (s: string) => toolbarSource.indexOf(s);
    expect(at("<CollabButton")).toBeGreaterThan(at('label="Properties…"'));
    expect(at("<CollabButton")).toBeLessThan(at('label="Print / Export…"'));
  });
});

describe("MUI only when collaborating", () => {
  it("isn't imported by the app's core, so it loads with the session panel", () => {
    const mui = /from\s+["'](@mui\/|@emotion\/|@sandtreader\/collab\/react)/;
    for (const src of [appSource, toolbarSource, canvasSource, collabSource]) expect(src).not.toMatch(mui);
  });
});

describe("joinCheck: only joining someone's session asks about unsaved changes", () => {
  it("starts a session of our own straight away", async () => {
    const confirm = vi.fn(async () => false);
    expect(await joinCheck(confirm)("abc-defg-hij", true)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before joining one that may already have a drawing", async () => {
    const no = vi.fn(async () => false);
    expect(await joinCheck(no)("abc-defg-hij", false)).toBe(false);
    expect(no).toHaveBeenCalledTimes(1);
    expect(await joinCheck(async () => true)("abc-defg-hij", false)).toBe(true);
  });

  it("is what the session panel asks before connecting", () => {
    expect(sessionSource).toMatch(/beforeJoin=\{/);
    expect(sessionSource).toMatch(/joinCheck\(confirmBeforeJoin\)/);
    expect(sessionSource).not.toMatch(/guardConnect/);
  });
});

describe("confirmBeforeJoin: unsaved changes block joining until saved or let go", () => {
  beforeEach(() => {
    while (currentQuestion()) answer(false);
    store.replace(emptyState());
    store.markSaved();
  });

  it("goes straight ahead with nothing unsaved", async () => {
    expect(await confirmBeforeJoin()).toBe(true);
    expect(currentQuestion()).toBeNull();
  });

  it("asks first with unsaved changes: cancel stays out, Join anyway goes in", async () => {
    store.commit(addRect("r", { x: 0, y: 0, width: 10, height: 10 }));
    const p = confirmBeforeJoin();
    await waitFor(() => currentQuestion() !== null, "asked");
    expect(currentQuestion()).toMatchObject({ title: "Unsaved changes", alternative: "Join anyway" });
    expect(currentQuestion()!.message).toMatch(/replace/);
    answer(false);
    expect(await p).toBe(false);

    const q = confirmBeforeJoin();
    await waitFor(() => currentQuestion() !== null, "asked again");
    answer("alternative");
    expect(await q).toBe(true);
  });
});

describe("a drawing from the session", () => {
  const theirs: DocState = { entities: { t: { kind: "rect", props: { x: 1, y: 2, width: 3, height: 4 } } } };

  it("tells the app when it replaces the whole drawing: a joining snapshot or someone opening a file", () => {
    const s = new DrawingStore();
    const replaced = vi.fn();
    const d = collabDocument(s, { replaced });
    d.applySnapshot(theirs);
    expect(s.state).toEqual(theirs);
    expect(replaced).toHaveBeenCalledTimes(1);
    d.applyChange({ type: "state_replaced", state: emptyState() });
    expect(replaced).toHaveBeenCalledTimes(2);
    d.applyChange({ type: "props_changed", id: "t", props: { x: 5 } });
    expect(replaced).toHaveBeenCalledTimes(2);
  });

  it("is no longer your file", () => {
    detachFile();
    expect(currentFileName()).toBe("Untitled");
  });
});

describe("presenceSender: cursor and selection to the others", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("sends the cursor at most every 100 ms, the latest last", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const p = presenceSender({ sendPresence: (x) => { sent.push(x); } });
    p.cursor([1, 1]);
    p.cursor([2, 2]);
    p.cursor([3, 3]);
    expect(sent).toEqual([{ cursor: [1, 1] }]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([{ cursor: [1, 1] }, { cursor: [3, 3] }]);
    vi.advanceTimersByTime(500);
    expect(sent.length).toBe(2);
  });

  it("sends the selection when it changes", () => {
    const sent: unknown[] = [];
    const p = presenceSender({ sendPresence: (x) => { sent.push(x); } });
    p.selection(["a", "b"]);
    p.selection(["a", "b"]);
    p.selection(["b"]);
    expect(sent).toEqual([{ selection: ["a", "b"] }, { selection: ["b"] }]);
  });

  it("always sends both, since each message replaces what the others hold for you", () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const p = presenceSender({ sendPresence: (x) => { sent.push(x); } });
    p.selection(["a"]);
    p.cursor([1, 2]);
    p.selection(["a", "c"]);
    expect(sent).toEqual([{ selection: ["a"] }, { cursor: [1, 2], selection: ["a"] }, { cursor: [1, 2], selection: ["a", "c"] }]);
  });
});
