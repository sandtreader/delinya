// Two DrawingStores converging through the real relay: proves the store's
// single point of mutation feeds the collab client without echo, that
// remote changes land outside undo history, and that a late joiner gets
// the snapshot and resolves the same geometry.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRelay, type Relay } from "@sandtreader/collab/server";
import { CollabClient } from "@sandtreader/collab/client";
import { COLLAB_APP, bindCollab, collabDocument } from "../src/collab";
import { DrawingStore, addRect, addSpacing, linkLengths, moveBy, setLength } from "../src/model";
import type { ResolvedRect } from "../src/model";
import { waitFor } from "./helpers";

let relay: Relay;
let url: string;
const clients: CollabClient[] = [];

function peer(userId: string) {
  const store = new DrawingStore();
  const client = new CollabClient({ app: COLLAB_APP, userId, displayName: userId, document: collabDocument(store) });
  bindCollab(store, client);
  clients.push(client);
  return { store, client };
}

beforeAll(async () => {
  relay = createRelay({ port: 0 });
  await waitFor(() => relay.port() !== undefined, "relay listening");
  url = `ws://127.0.0.1:${relay.port()}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await relay.close();
});

describe("two stores through the relay", () => {
  it("converge on the same resolved geometry", async () => {
    const a = peer("a");
    a.store.commit(addRect("L", { x: 0, y: 0, width: 18, height: 300 }));
    a.store.commit(addRect("R", { x: 518, y: 0, width: 18, height: 300 }));
    a.client.connect("del-inya-tst", url);
    await waitFor(() => a.client.status === "connected", "a connected");

    // b joins late and receives a snapshot.
    const b = peer("b");
    b.client.connect("del-inya-tst", url);
    await waitFor(() => b.client.status === "connected", "b connected");
    expect(Object.keys(b.store.state.entities).sort()).toEqual(["L", "R"]);
    expect(b.store.canUndo).toBe(false);

    // a adds a shelf and spaces it; b sees derived position without it being sent.
    a.store.commit(addRect("s", { x: 999, y: 100, width: 100, height: 18 }));
    a.store.commit(addSpacing("sp", { anchorA: "L", anchorB: "R", items: ["s"], axis: "x", mode: "gaps" }));
    await waitFor(() => b.store.state.entities.sp !== undefined, "b has spacing");
    expect((b.store.state.entities.s!.props.x)).toBe(999);          // authored value, untouched
    expect((b.store.resolved.shapes.s as ResolvedRect).x).toBe(218);  // derived locally
    expect((a.store.resolved.shapes.s as ResolvedRect).x).toBe(218);

    // b links widths and edits through the variable; a follows.
    b.store.commit(linkLengths(b.store.state, [{ id: "L", prop: "width" }, { id: "R", prop: "width" }], "t", "thickness")!);
    b.store.commit(setLength(b.store.state, "R", "width", 25)!);
    await waitFor(() => a.store.resolved.variables.t === 25, "a sees thickness");
    expect((a.store.resolved.shapes.L as ResolvedRect).width).toBe(25);
    expect(a.store.canUndo).toBe(true);                              // a's own edits only
    expect(b.store.canUndo).toBe(true);

    // A drag gesture from a arrives on b as individual moves; b never gains undo entries.
    a.store.commit(moveBy(a.store.state, "s", 0, 10, { start: true })!);
    a.store.commit(moveBy(a.store.state, "s", 0, 10, { end: true })!);
    await waitFor(() => b.store.state.entities.s!.props.y === 120, "b sees drag");

    // Undo on a is itself a change that b receives.
    a.store.undo();
    await waitFor(() => b.store.state.entities.s!.props.y === 100, "b sees undo");

    expect(a.store.state).toEqual(b.store.state);
    expect(a.store.resolved).toEqual(b.store.resolved);
  });
});
