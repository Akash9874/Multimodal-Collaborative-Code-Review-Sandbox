# Multimodal Collaborative Code Review Sandbox

A zero-install web workspace where several people edit code together, draw architecture
directly over that code, and run it — seeing the same output at the same moment.

**Status:** Phase 1 of 5 complete — real-time collaborative editing.
Design: [`Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md`](Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md)

## What works today

- A room is a URL. Open `/`, click **Create a sandbox**, share the link.
- Everyone in the room edits one document, synced by a Yjs CRDT over WebSockets.
- Remote cursors and selections, coloured per user, with name tags.
- A presence bar showing who is here, and a live connection status.
- Edits made while offline merge on reconnect — that is the CRDT, not a retry queue.

## Architecture

- **`apps/web`** — Next.js 15 (App Router). Monaco is bound to a `Y.Text` by `y-monaco`.
  One `WebsocketProvider` per room, cached outside React so StrictMode's double-mount cannot
  open two sockets.
- **`apps/ws-server`** — Node + `ws`, speaking the Yjs sync protocol directly via `y-protocols`.
  It holds and merges each room's document; it never inspects the contents. Rooms outlive their
  last connection by 30 seconds, so a refresh does not wipe your work.
- **`packages/shared`** — the Y.Doc schema and every type that crosses the wire.

## Running it

```bash
pnpm install
pnpm dev          # web on :3000, sync server on :1234
```

Open the same `/s/<roomId>` URL in two browser windows.

## Tests

```bash
pnpm test         # 21 unit + integration tests (Vitest)
pnpm test:e2e     # 5 browser tests (Playwright), incl. two real browsers editing one document
pnpm typecheck
```

The integration tests connect two genuine Yjs clients to the server and assert convergence
under concurrent edits. The end-to-end tests drive two isolated browser contexts — not two
tabs, which could sync through `BroadcastChannel` behind the server's back and pass falsely.

## Not built yet

Shared code execution (Phase 2), the overlay drawing canvas (Phase 3), Postgres persistence
and multi-file support (Phase 4), line-anchored annotations and deployment (Phase 5).

## A note on access

The room id is the only access control: anyone with the link can read and edit. That is correct
for a disposable sandbox and wrong for anything private.
