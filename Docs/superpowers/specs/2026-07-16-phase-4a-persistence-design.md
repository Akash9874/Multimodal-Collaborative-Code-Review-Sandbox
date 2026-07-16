# Phase 4a — Persistence — Design

Date: 2026-07-16
Status: Approved
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.4, §6, §11 row 4)
Builds on: Phases 1–3 (collaborative editor, shared execution, overlay canvas), all complete.

## 1. Purpose

Close every tab; reopen the link tomorrow; the code and the drawings are still there. That is the master
spec's success criterion #4, and this phase exists to make it true:

> Everyone closes the tab. A week later the link still opens the same code, files, and drawings.

Today a room is purely in-memory. `sync/rooms.ts` seeds a fresh `Y.Doc` on first connection and evicts it
30 seconds after the last client leaves — nothing is written down, so the room dies with that grace period.
This phase gives the room a durable home: the whole `Y.Doc` is persisted to Postgres as one binary blob,
loaded back on the next first-connection, and cleaned up after a long idle.

Phase 4 in the master spec bundles persistence with multi-file tabs. We have **split** it: this is **Phase
4a — persistence**, which makes the single seeded file (its code and its strokes) survive a restart.
Multi-file tabs are **Phase 4b**, a later cycle with its own spec. Persistence-first gives a real
"reopen tomorrow" demo immediately and keeps each plan's blast radius small.

## 2. What ships, and what does not

**Ships in Phase 4a:**

- A **Postgres room store**: the entire `Y.Doc` (files, per-file text, strokes) encoded with
  `Y.encodeStateAsUpdate` and stored as one `BYTEA` blob, one row per room.
- **Load on first connection, debounced flush on edit, flush on last-leave, evict after the existing 30s
  grace**, and a **30-day TTL cleanup** on boot.
- A provider-agnostic `RoomStore` interface with a `PostgresRoomStore` (real) and a `MemoryRoomStore`
  (tests and no-DB local dev), injected exactly like the existing `RunStore`.
- **Graceful degradation:** with no `DATABASE_URL`, the server runs in-memory as it does today — editing and
  drawing work; only persistence is absent.

**Database:** **Supabase Postgres** in every environment — production and tests. The persistence layer is
plain Postgres behind a `DATABASE_URL`, so the same code points at Supabase everywhere. No local Docker
Postgres, no second provider. We use only vanilla Postgres features (`BYTEA`, upsert, one index).

**Explicitly out of scope for 4a:**

- **Run-history persistence.** The `RunStore` interface is synchronous (`list(): RunRecord[]`); a
  Postgres-backed store needs an async `list()`, which ripples into the join-time history fetch. That
  refactor buys nothing for this phase's proof — "reopen tomorrow" is about code and drawings, not the last
  run's stdout. Run history stays in `MemoryRunStore` (dies with the room, as today). The `runs` table and a
  `PostgresRunStore` land in a later slice.
- **Multi-file tabs** — Phase 4b. The schema is already multi-file (`files` map, `file:<id>` text); 4a
  persists whatever files the doc holds, which today is the one seeded `main.py`.
- **Redis backplane / multi-instance scaling, accounts / auth / private rooms** — later or never (master
  spec §10).

## 3. Architecture

### 3.1 The store, behind the room lifecycle

The exec side already proves the pattern: a `RunStore` interface with a `MemoryRunStore`, injected through
`createSandboxServer(options)`. Persistence mirrors it. A `RoomStore` interface owns all Postgres access;
the sync room lifecycle calls it and never writes SQL inline.

```ts
interface RoomStore {
  load(roomId: string): Promise<Uint8Array | null>;      // null → brand-new room, seed it
  save(roomId: string, state: Uint8Array): Promise<void>; // upsert the whole doc blob
  deleteStale(olderThanMs: number): Promise<number>;      // 30-day TTL cleanup on boot; returns rows removed
  close(): Promise<void>;                                  // pool teardown for tests and shutdown
}
```

- **`PostgresRoomStore`** — a `pg.Pool` over `DATABASE_URL`. `save` is a single upsert; `load` reads one
  row; `deleteStale` is one `DELETE`.
- **`MemoryRoomStore`** — a `Map<string, Uint8Array>`, for unit tests and no-DB local dev.

The `/sync` relay stays pure: the server persists an **opaque blob** it never parses. Storing the doc is not
the same as understanding it.

### 3.2 The one and only place semantics live

The server stores `Y.encodeStateAsUpdate(doc)` and restores it with `Y.applyUpdate(doc, bytes)`. It does not
read `files`, `strokes`, or any file text. This keeps the relay property intact and means Phase 4b (more
files) and any future schema change need **zero** persistence changes — the blob is the blob.

## 4. Data Model

### 4.1 Schema — a private schema, not `public`

```sql
create schema if not exists sandbox;

create table sandbox.rooms (
  id          text        primary key,
  ydoc_state  bytea       not null,        -- Y.encodeStateAsUpdate(doc)
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table sandbox.rooms enable row level security;  -- defense in depth; no anon/authenticated policies
```

The whole `Y.Doc` is one opaque `BYTEA`. Run history is deliberately absent from this migration — it arrives
with `PostgresRunStore` in a later slice, as `sandbox.runs` (master spec §4.4), FK to `sandbox.rooms`.

### 4.2 Why `sandbox` and not `public` — the security crux

Supabase auto-exposes the `public` schema through a REST **Data API** reachable with the project's public
`anon` key. A `rooms` table in `public`, with the Data API on, would let anyone **enumerate and dump every
room's blob** over REST — the full code and drawings of every room ever created. That is strictly worse than
the app's documented posture, where the room id is the only access control and is at least unguessable.

So the tables live in a `sandbox` schema that is **never granted** to `anon` or `authenticated`, keeping them
entirely off the REST surface. The ws-server reaches them through its **direct Postgres connection**, which
is unaffected by schema exposure. RLS is enabled as belt-and-suspenders: even if the schema were ever
exposed, there are no policies, so the Data API returns nothing. We use no `supabase-js`, no PostgREST, no
Supabase Auth — just `pg` and a connection string.

### 4.3 Connection

The ws-server is a long-lived process (Render), so it holds a small persistent `pg.Pool` against Supabase's
**session-mode pooler** connection string (IPv4-compatible, supports session features) — not the
transaction-mode pooler (port 6543), which is for serverless and forbids session state. `BYTEA` maps to a
Node `Buffer` in `pg`: `save` passes a `Buffer`, `load` receives one and returns a `Uint8Array`.

> Implementation note: per the Supabase skill's first principle, the exact pooler host/port and connection
> string format are verified against the current Supabase docs/changelog at implementation time rather than
> from memory — these details move.

## 5. Components

### 5.1 `apps/ws-server/src/persistence/` (new)

- `store.ts` — the `RoomStore` interface and `MemoryRoomStore`.
- `postgres.ts` — `PostgresRoomStore` (a `pg.Pool`, the three queries, `close`).
- `store.test.ts` — `MemoryRoomStore` behaviour and the doc encode/decode round-trip (offline).
- `postgres.test.ts` — `PostgresRoomStore` round-trip, gated on `DATABASE_URL` (Supabase).

### 5.2 `apps/ws-server/src/sync/rooms.ts` (modified)

The lifecycle becomes persistence-aware while `Room` (`sync/room.ts`) stays a pure relay primitive:

- `getOrCreateRoom(id)` → **async**. Cache miss: `await store.load(id)`; if bytes, `Y.applyUpdate`; if
  `null`, `seedDoc` and immediately `save` the seed so a row exists from the start.
- An **in-flight dedupe guard**: `Map<string, Promise<Room>>`, so two sockets racing into a cold room share
  one load-and-seed. This is the async analogue of today's `Map<string, Room>` and the same spirit as the
  StrictMode double-connect guard in `useRoom`.
- A **debounced save**: subscribe to the room's doc `update`; debounce ~2s; then `save(id,
  encodeStateAsUpdate(doc))`. Persistence lives here, not inside `Room`.
- `releaseRoom` **flushes immediately** on last-leave, then the existing 30s grace eviction runs.

### 5.3 `apps/ws-server/src/server.ts` (modified)

`createSandboxServer(options)` gains an optional `roomStore` (default: chosen from env — Postgres if
`DATABASE_URL` is set, else Memory + a startup warning). The `http.on('upgrade', …)` handler becomes `async`
so it can `await getOrCreateRoom` before wiring the sync connection. On boot, `store.deleteStale(30 days)`
runs once. The exec path is untouched.

### 5.4 `apps/ws-server/src/env.ts` (modified)

Adds `databaseUrl` (`DATABASE_URL`), and makes the grace period and TTL configurable
(`ROOM_GRACE_MS`, `ROOM_TTL_DAYS`) so the e2e suite can force fast eviction.

### 5.5 Migration

One SQL file, `apps/ws-server/sql/001_persistence.sql` (§4.1), plus a `pnpm db:migrate` that applies it with
`psql "$DATABASE_URL"`. Because this session cannot authenticate to Supabase, the human applies it once — via
the Supabase dashboard SQL editor or the script. `pg` and `@types/pg` are added to `apps/ws-server`.

## 6. Room Lifecycle and Data Flow

1. **First connection to a cold room** → `getOrCreateRoom` awaits `load`. Hit: `applyUpdate`. Miss:
   `seedDoc` + immediate `save`. The in-flight guard collapses concurrent first-connections into one.
2. **Edit** → doc `update` fires → debounced ~2s → `save(id, encodeStateAsUpdate(doc))` (an upsert).
3. **Last client leaves** → flush any pending state immediately → 30s grace eviction destroys the in-memory
   room. Rejoin within grace: still in memory, no round-trip. Rejoin after eviction: reload from Postgres.
4. **Boot** → `deleteStale(30 days)` removes rooms untouched for a month. A sandbox is disposable by design.

## 7. Error Handling and Edge Cases

- **Database down / `save` rejects.** A failed flush is logged and swallowed, never crashing the relay;
  editing continues in memory and the next debounced flush retries. Sync (the live collaboration) does not
  depend on the database at all.
- **`load` rejects on first connection.** Surface it and fall back to a seeded in-memory room rather than
  refusing the connection — a reachable room with an empty doc beats a dead socket. Logged loudly.
- **No `DATABASE_URL`.** `MemoryRoomStore` + a one-line warning. Editing and drawing work; persistence does
  not. This is the local-dev and CI-without-secret path.
- **Concurrent first-connections.** The in-flight promise guard prevents double load-and-seed and the
  duplicate-content risk it would carry.
- **Flush vs eviction race.** Flush-on-release is awaited before the room is destroyed; a late debounced
  timer after destruction is a no-op (guarded by checking the room is still current).
- **Large documents.** The blob grows with history; `BYTEA` handles megabytes comfortably, and a room is
  disposable. Compaction (`Y.encodeStateAsUpdate` already garbage-collects deleted content) is sufficient;
  no snapshot-pruning scheme is in scope.

## 8. Security Posture

- Tables in a private `sandbox` schema, never granted to `anon`/`authenticated`, so the Supabase Data API
  cannot reach them (§4.2). RLS enabled as defense in depth.
- The database URL and any Supabase credentials live **only** on the server (`env.ts`), never in the client
  bundle. No `NEXT_PUBLIC_` database anything.
- The server stores and forwards an opaque blob; it never evaluates, parses, or interpolates document
  content. The relay stays pure.
- Unchanged and accepted: the room id remains the only access control. Persistence does not add auth — it
  makes a disposable room durable, not private.

## 9. Testing

Written test-first, per the repo's convention.

- **Unit (Vitest, offline, always run).** `MemoryRoomStore` behaviour; a **Y.Doc encode→decode round-trip**
  proving files, text, and strokes all survive `encodeStateAsUpdate`/`applyUpdate`; the debounce (fake
  timers); `deleteStale` selection logic against the in-memory store.
- **Integration (Postgres, gated on `DATABASE_URL`).** `PostgresRoomStore` round-trip and upsert-overwrite;
  then the real proof — boot the server on the Supabase test database, connect a Yjs client, edit, force
  flush + eviction, reconnect a **fresh** client, and assert the edit survived (the in-memory room is gone,
  the doc was reloaded from Postgres). Isolation via unique `test-…` room ids and `afterAll` cleanup
  (`delete from sandbox.rooms where id like 'test-%'`).
- **E2E (Playwright — the headline "reopen tomorrow").** A edits and draws; both contexts close; with a short
  `ROOM_GRACE_MS` in the e2e server env the room flushes and evicts; a fresh context reopens the same id and
  sees the code **and** the strokes, served from Postgres.
- **Gating.** With no `DATABASE_URL`, the Postgres integration and e2e persistence tests **skip** — a
  contributor without the secret is never blocked; in the Supabase-configured environment they run.

## 10. Out of Scope for Phase 4a

- **Run-history persistence** (the `runs` table and `PostgresRunStore`) — a later slice; the sync `RunStore`
  interface would need to go async first (§2).
- **Multi-file tabs** — Phase 4b.
- **Redis pub/sub backplane, multi-instance scaling, accounts / auth / private rooms** — master spec §10.

## 11. Self-Review

**Spec coverage.** Every shipped item in §2 has a home: the room store → §3.1, §5.1; schema and its security
→ §4; lifecycle (load / debounce / flush / evict / TTL) → §5.2, §6; config and degradation → §5.3–§5.5, §7;
testing → §9. Nothing in §2 is unassigned, and nothing out of scope (§10) is designed in.

**Deviation from the master spec.** The master spec's Phase 4 bundles persistence with multi-file; this
splits out 4a (persistence) as its own cycle, and swaps the named provider from Neon to Supabase. Both are
recorded in §1–§2. The data model is unchanged from §4.4 except that only the `rooms` table ships now (runs
deferred), and it lives in a `sandbox` schema rather than `public` — a security tightening forced by
Supabase's Data API that Neon did not require.

**The one property everything rests on.** The persisted blob is opaque and the relay never parses it. If the
"reopen tomorrow" test ever fails, look first at the encode/decode round-trip and the flush/eviction ordering
— both unit-tested in isolation before the lifecycle is wired.

**Ambiguity check.** "Flush on last-leave" means: await the pending `save` before the 30s eviction timer
destroys the room; a debounced timer that fires after destruction is a guarded no-op (§7). "Persist the seed
on create" means one `save` immediately after `seedDoc`, so a room row exists before any edit.
