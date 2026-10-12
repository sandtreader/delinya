# Collaboration Layer — Shared Entity Document Sync

## Summary

SynFlo's collaboration layer (relay server, client, session UI) is mostly
model-agnostic already. The graph-shaped parts are thin: five topology
messages, two layout messages and one parameter message that all reduce to
*add entity*, *remove entity*, *change properties*. Rather than force the
drawing into a graph, extract a shared package built around a generic
**entity document** that both SynFlo and Delinya map onto.

This document specifies the shared protocol, the client adapter boundary, the
server behaviour, and how Delinya's model maps onto it. A companion note in
SynFlo (`plans/collab-shared.md`) covers migrating SynFlo to the same package.

## Why not a graph

- Equal spacing is an n-ary relation (two anchors, a set of items), not an
  edge.
- A shared variable is an entity with no position.
- A dimension label is an entity that references another entity.

SynFlo's protocol doesn't actually use graphness either: an edge on the wire
is an entity with two references and a `disabled` flag. The topology/layout
split matters inside SynFlo (topology reaches the audio engine) but is
app-side routing, not protocol.

## The entity document

A document is a flat map of entities by ID. Each entity has a `kind` and a bag
of JSON-serialisable properties. Some property values are references to other
entity IDs. That's it.

```ts
type PropValue = number | string | boolean | null | PropValue[] | { [k: string]: PropValue };
type Props = Record<string, PropValue>;

interface Entity { kind: string; props: Props }

interface DocState {
  entities: Record<string, Entity>;
  users?: Record<string, string>;   // userId → displayName, carried in snapshots
}
```

Both apps fit:

| | SynFlo | Delinya |
|---|---|---|
| Entity kinds | `node`, `edge` | `line`, `rect`, `circle`, `variable`, `link.equal`, `link.spacing`, `dimension`, `radius-label` |
| References | edge `src`/`dst` → node IDs | link anchors/items → shape IDs; `{ ref }` → variable IDs; dimension target → shape ID |
| Derived (never synced) | audio engine state | computed positions of spaced items, resolved linked values |

## Protocol

### Envelope

```ts
interface Message {
  seq?: number;        // server-assigned; absent on the wire from the client
  cid?: string;        // client-generated change ID, for echo matching (see Ordering)
  ts: number;
  userId: string;
  sessionId: string;
  payload: Payload;
}
```

### Document changes

```ts
type Change =
  | { type: "entity_added";   id: string; kind: string; props: Props }
  | { type: "entity_removed"; id: string }
  | { type: "props_changed";  id: string; props: Partial<Props>;
      gestureStart?: boolean;   // first of a drag/slide — undo group boundary
      gestureEnd?: boolean;     // last of a drag/slide
      transient?: boolean }     // apply but don't persist (SynFlo input pokes)
  | { type: "batch";          changes: Change[] }
  | { type: "state_replaced"; state: DocState };
```

Application rules, so every client converges regardless of arrival order:

- `entity_added` on an existing ID replaces the entity.
- `props_changed` on an unknown ID is ignored (it may arrive after a removal).
- `entity_removed` on an unknown ID is ignored.
- `props_changed` is a shallow merge. A property set to `null` is removed.
- `batch` is applied in order and treated as one unit for undo.
- `state_replaced` clears the document and loads the state. Used for
  "open file" while connected.

`props_changed` takes a partial map, not a single key, so a rectangle drag
(x and y) or an "open" that touches several fields is one message.

### Session

```ts
type SessionMessage =
  | { type: "join";  userId: string; displayName: string }
  | { type: "leave"; userId: string }
  | { type: "session_info"; members: Record<string, string>; seq: number }  // server → joiner
  | { type: "snapshot_request" }
  | { type: "snapshot_response"; state: DocState };
```

### Presence

```ts
interface Presence {
  type: "presence";
  userId: string;
  cursor?: [number, number];   // model coordinates (mm for Delinya, flow units for SynFlo)
  selection?: string[];        // entity IDs this user has selected
}
```

Presence is always transient. Cursor coordinates are in model space so the
receiver maps them through its own viewport.

### Payload union

```ts
type Payload = Change | SessionMessage | Presence;
```

## Server

### Phase 1: sequenced relay

SynFlo's relay moves across unchanged in spirit, with three additions:

1. **Sequence numbers.** The server stamps `seq` (monotonic per session) on
   every document change and **echoes it to the sender too**. This gives one
   total order per session.
2. **Session info on join.** On the first message (`join`) the server replies
   to the joiner alone with `session_info` listing current members and the
   current `seq`. If there are no other members the joiner is first and is
   immediately connected. Otherwise the client sends `snapshot_request`, the
   server forwards it to one member and routes the `snapshot_response` back
   **only to the requester**. This replaces SynFlo's two-second "am I first?"
   timer and its broadcast-to-everyone snapshot response.
3. **App namespacing.** Sessions are keyed by `app:sessionId`, with `app`
   taken from the WebSocket path (`/delinya`, `/synflo`). One deployment can
   serve both apps without a SynFlo link being able to join a drawing.

The server still holds no document state. The relay stays stateless and
app-blind.

### Phase 2: authoritative server (persistence)

Because the entity model is generic, the server can apply changes itself with
no app knowledge: maintain `DocState` per session by applying the same rules
listed above. Then:

- `snapshot_request` is answered by the server, so the peer handshake goes
  away entirely.
- Persistence is just serialising the per-session `DocState` (plus the
  recent change log) to disk or SQLite. A drawing survives everyone closing
  the tab.
- Late joiners and reconnects become trivial: send the current state and
  resume from `seq`.

Phase 2 is the right endpoint for a drawing tool (people will spend hours on
a plan and expect it to still be there). Phase 1 is enough to get going and
is what SynFlo needs.

## Client

### Ordering and optimistic local edits

With server sequencing, the client applies changes in `seq` order and the
server-ordered state is authoritative. Local edits are applied optimistically
and tracked as pending until echoed:

```
on local change c:
  assign c.cid; apply locally; pending.set(c.cid, c); send(c)

on incoming message m (in seq order):
  if m.userId === me and pending.has(m.cid):   pending.delete(m.cid)   // echo
  else:
    apply m, except for (id, prop) pairs that a pending local change also
    sets — local wins until the echo arrives
```

Convergence check: A sets `w=10`, B sets `w=20`, server orders A then B.
A: echo A (drop pending) → B's `w=20` → `w=20`. B: A's `w=10` arrives but `w`
is pending → ignored → echo B → `w=20`. Both end at `w=20`.

### Adapter boundary

The shared client knows nothing about Zustand, React or the app's model. It
takes an adapter:

```ts
interface CollabDocument {
  getSnapshot(): DocState;
  applySnapshot(state: DocState): void;
  applyChange(change: Change): void;     // called with suppression already active
}

class CollabClient {
  constructor(opts: {
    app: string;
    userId: string;
    displayName: string;
    document: CollabDocument;
  });
  connect(sessionId: string, serverUrl: string): void;
  disconnect(): void;
  send(change: Change): void;            // no-op when disconnected
  sendPresence(p: Omit<Presence, "type" | "userId">): void;
  suppress<T>(fn: () => T): T;           // re-entrancy guard for remote applies
  readonly suppressed: boolean;

  readonly status: "disconnected" | "connecting" | "joining" | "connected";
  readonly sessionId: string | null;
  readonly users: Map<string, string>;
  onStatus(fn): Unsubscribe;
  onUsers(fn): Unsubscribe;
  onPresence(fn: (p: RemotePresence[]) => void): Unsubscribe;
}
```

What stays in each app, and it is about 40 lines:

- The **single point of mutation** invariant. Every mutation, local or
  remote, goes through the same store action. Each action does
  `if (!client.suppressed) client.send(change)`. The adapter's `applyChange`
  calls the same actions inside `client.suppress()`.
- **Throttling** of continuous changes: ~50 ms for drags, ~100 ms for
  presence, always flushing the final value with `gestureEnd`.
- **Undo integration**: a `batch` is one undo group; remote changes are not
  pushed onto the local undo stack.

### React layer

Shared React components, carrying the MUI dependency, parameterised by a
small config object rather than hard-coded strings:

- `SessionPanel` — display name, session ID entry with profanity-filtered
  generation, join/leave, user list, copy URL, QR dialog. Config:
  `storageKeyPrefix`, `sessionUrlPrefix`, `serverUrl`, `showQr`.
- `autoJoinFromUrl(config)` — joins from `/s/xxx-xxxx-xxx`.
- `RemotePresence` — cursor dots and labels, given a `toScreen(model) →
  screen` function. Delinya passes its viewport transform; SynFlo passes
  ReactFlow's `flowToScreenPosition`. Optionally highlights entities in
  other users' `selection`.

## Package layout

New repo, published as a package (name TBD, e.g. `@sandtreader/collab`),
with four entry points so consumers only pull what they need:

| Entry | Contents | Dependencies |
|---|---|---|
| `protocol` | the types above, apply rules as pure functions (`applyChange(state, change)`) | none |
| `server` | sequenced relay (phase 1), authoritative store + persistence (phase 2) | `ws` |
| `client` | `CollabClient`, pending/echo logic, reconnect with backoff | none |
| `react` | `SessionPanel`, `RemotePresence`, `autoJoinFromUrl` | React, MUI, `qrcode.react`, `bad-words` |

Putting `applyChange` in `protocol` as a pure function means the server
(phase 2), the client and tests all share one implementation of the merge
rules.

## Delinya mapping

Only the model is synced. Each client recomputes links and derived positions
locally; because the calculations are deterministic and pure over the
document, every client shows the same drawing.

### Entity kinds and props

```
line           { x1, y1, x2, y2 }                               // or { x, y, length, angle }
rect           { x, y, width, height, r: [tl, tr, br, bl] }
circle         { cx, cy, diameter }
variable       { name?, value }
link.equal     { items: [{ id, prop }...], variable: id }        // or model as refs, see below
link.spacing   { anchorA: id, anchorB: id, items: [id...], axis: "x"|"y", mode: "gaps"|"centres" }
dimension      { target: id, prop: "width"|"height"|"diameter"|..., offset }
radius-label   { target: id, corner: 0..3 }
```

Lengths in mm throughout. Scale is view/print state and never synced.

### Equal-value links: two options

**A. Reference values.** Any length prop may be a number *or* a reference:
`width: { ref: variableId }`. Editing a linked width edits the variable's
`value`. No separate link entity; the "link" is the reference itself.

**B. Link entity.** Values stay numeric on the shapes; a `link.equal` entity
lists the members and the recompute overwrites them from the variable.

Recommend **A**. It's smaller, the document is self-describing, and "unlink"
is just replacing the ref with the resolved number. It also sets up the
later named-variables/expressions feature (`{ expr: "carcass_w - 2*t" }`)
without a protocol change.

### Equal-spacing links

Items in a `link.spacing` have their along-axis position **derived** while
linked; their stored `x` (or `y`) is ignored and not updated by the
recompute. Cross-axis position stays authored. Unlinking writes the current
derived position back into the shape as a normal `props_changed`.

### What each local action sends

| Action | Message |
|---|---|
| Draw rectangle | `batch[ entity_added rect, entity_added dimension ×2 ]` |
| Drag shape | `props_changed { x, y }` throttled, `gestureStart` on first, `gestureEnd` on last |
| Type width on linked rect | `props_changed` on the **variable** `{ value }` |
| Link two widths | `props_changed` on each shape setting `width: { ref }` (+ `entity_added variable` if new) → one `batch` |
| Delete shape | `batch[ entity_removed shape, entity_removed each dependent dimension/label, props_changed on links dropping it ]` |
| Open file while connected | `state_replaced` |

### Remote change application

`applyChange` → document store (inside `suppress`) → recompute links →
render. The recompute must tolerate dangling references briefly (a link
whose target hasn't arrived yet, or was removed): treat the link as
inactive, never throw.

## Open questions

- **Persistence timing.** Phase 2 server, or save-to-file only, for v1? A
  drawing tool argues for phase 2 earlier than SynFlo ever needed it.
- **Who may edit.** SynFlo sessions are open to anyone with the link. Fine for
  a jam; probably fine for a shared drawing too, but note it.
- **Undo across users.** Local-only undo is the standard choice and what
  SynFlo plans. Confirm.
- **Package hosting.** npm publish vs git dependency vs pnpm workspace
  linking across the two repos during development.

## Migration from SynFlo

See SynFlo `plans/collab-shared.md`. In short: server moves unchanged plus
sequencing; `CollabClient` splits along its existing generic/graph seam; the
`handleMessage` switch becomes a `kind → store action` mapping; `node_moved`,
`node_resized`, `param_changed`, `edge_disabled` collapse into
`props_changed`; `patch_loaded` becomes `state_replaced`.
