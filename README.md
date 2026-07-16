# Multimodal Collaborative Code Review Sandbox

A zero-install web workspace where several people edit code together, draw architecture
directly over that code, and run it — seeing the same output at the same moment.

**Status:** Phase 4a of 5 — collaborative editing, shared execution, a drawing overlay, and durable rooms.
Design: [`Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md`](Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md)

## What works today

- A room is a URL. Open `/`, click **Create a sandbox**, share the link.
- Everyone in the room edits one document, synced by a Yjs CRDT over WebSockets.
- Remote cursors and selections, coloured per user, with name tags.
- A presence bar showing who is here, and a live connection status.
- Edits made while offline merge on reconnect — that is the CRDT, not a retry queue.
- Toggle **Draw** and mark up the code — freehand, arrows, boxes, and short text labels, in your own
  colour. Everyone sees your drawing pinned to the same code, even when they are scrolled elsewhere,
  and watches your pen move live as you draw.
- The eraser removes any stroke by hit-test; undo removes your own last stroke.
- Anyone presses **Run** (or `Ctrl`/`Cmd`+`Enter`) and *everyone* sees the same stdout and stderr
  appear in the same terminal at the same moment — with stdin echoed, so the output makes sense to
  the people who did not type it.
- Python, JavaScript and TypeScript. The language picker renames the file to match.
- Your code runs in Piston's isolated, network-less container — never on our server.
- Someone who joins late is replayed the runs they missed.
- Close every tab and reopen the link later — the code and the drawings are still there. Each room's
  whole document is persisted to Postgres and reloaded on the next visit.

## Architecture

- **`apps/web`** — Next.js 15 (App Router). Monaco is bound to a `Y.Text` by `y-monaco`.
  One `WebsocketProvider` per room, cached outside React so StrictMode's double-mount cannot
  open two sockets.
- **`apps/ws-server`** — Node + `ws`, speaking the Yjs sync protocol directly via `y-protocols`.
  It holds and merges each room's document; it never inspects the contents. Rooms outlive their
  last connection by 30 seconds, so a refresh does not wipe your work.
- **`packages/shared`** — the Y.Doc schema and every type that crosses the wire.
- **Two sockets, on purpose.** `/sync/<roomId>` is a pure Yjs relay that never parses document
  semantics. `/exec/<roomId>` is the single execution authority: it validates at the boundary,
  rate-limits, calls Piston, and broadcasts the result to the room. Run requests deliberately do
  *not* go through the CRDT — that would force the relay to understand the document, and every
  server instance would execute the same pending run.
- **The canvas is an SVG layer over Monaco**, and drawings are stored in *content* space, not screen
  space — so a stroke over line 12 is on line 12 for everyone, whatever their scroll. A hard Code/Draw
  `pointer-events` switch keeps the canvas and editor from fighting over the pointer. Strokes are
  ordinary Y.Doc state and sync through the same pure relay; the live in-progress pen rides on awareness.
- **Rooms are durable.** The server stores each room's whole `Y.Doc` as one opaque `BYTEA` blob in
  Postgres — encoded with `Y.encodeStateAsUpdate`, never parsed — loading it on the first connection,
  debounce-saving on edit, flushing when the last client leaves, and evicting from memory after a grace
  period. The `/sync` relay stays pure; persistence is a store behind the room lifecycle, swappable by
  connection string. Tables live in a private `sandbox` schema, off Supabase's REST Data API.

## Running it

```bash
pnpm install
pnpm piston:up    # a self-hosted Piston in Docker (see below), for the Run button
pnpm dev          # web on :3000, sync + exec server on :1234
```

Open the same `/s/<roomId>` URL in two browser windows.

**On Piston.** The public instance (`emkc.org`) became whitelist-only on 2026-02-15 — `POST /execute`
now returns 401 — so `PISTON_URL` defaults to a self-hosted Piston at `http://localhost:2000/api/v2`.
`pnpm piston:up` boots it in Docker and installs the three pinned runtimes; `pnpm piston:down` stops
it. Editing and presence work without it; only the Run button needs it. Point `PISTON_URL` at any
other Piston instance to swap it out — that env var is the only thing that moves.

**On the database.** Without `DATABASE_URL` the app still runs — editing and drawing work — but rooms
are in-memory and do not survive a restart. Everything reads one `DATABASE_URL`, so local Postgres
and Supabase are the same switch.

For development and for the tests, use the local one:

```bash
pnpm db:up        # boots Postgres in Docker and applies the migration; prints the DATABASE_URL
pnpm db:down      # stop it        (pnpm db:reset also deletes the data)
```

For a deployed instance, use **Supabase Postgres**: take the **Session pooler** connection string
(port 5432 — the server is a long-lived process holding a pool, which is what session mode is for),
set `DATABASE_URL` to it, and apply the migration once with `pnpm db:migrate`, or by pasting
[`apps/ws-server/sql/001_persistence.sql`](apps/ws-server/sql/001_persistence.sql) into the Supabase
SQL editor. The schema is vanilla Postgres — `BYTEA`, upsert, one index — so the two are the same
database as far as this code is concerned.

Point the tests at a **development** database, never a real one: the TTL sweep the Postgres suite
exercises is global by nature, so it deletes any room older than its cutoff, not only the suite's
own rows.

## Tests

```bash
pnpm db:up        # a local Postgres in Docker, migrated — needed by the persistence tests
pnpm test         # 117 unit + integration tests (Vitest), + 4 Postgres tests that need DATABASE_URL
pnpm test:e2e     # 14 browser tests (Playwright), incl. two browsers drawing over one document
pnpm typecheck
```

The integration tests connect two genuine Yjs clients to the server and assert convergence
under concurrent edits, and boot the exec server with a stub executor to prove one client's run
reaches the other. The end-to-end tests drive two isolated browser contexts — not two tabs, which
could sync through `BroadcastChannel` behind the server's back and pass falsely. The execution e2e
tests call a real Piston, so `pnpm piston:up` must be running first. The persistence tests that need
a real database — the Postgres store suite and the reopen-tomorrow e2e — are gated on `DATABASE_URL`
and skip without it, so a contributor without the secret is never blocked.

## Not built yet

Multi-file tabs (Phase 4b), line-anchored annotations and deployment (Phase 5).

## A note on access

The room id is the only access control: anyone with the link can read and edit. That is correct
for a disposable sandbox and wrong for anything private.
