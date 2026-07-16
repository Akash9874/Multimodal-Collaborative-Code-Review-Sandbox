# Phase 4a — Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room's whole `Y.Doc` (code, files, drawings) is persisted to Postgres and restored on the next visit, so closing every tab and reopening the link tomorrow shows the same code and strokes.

**Architecture:** A `RoomStore` interface (`PostgresRoomStore` + `MemoryRoomStore`) mirrors the existing `RunStore` seam. The sync room lifecycle loads the doc on first connection, debounce-saves on edit, flushes on last-leave, and evicts after the existing 30s grace. The `/sync` relay stays pure — the server stores an opaque `Y.encodeStateAsUpdate` blob it never parses. **No web-app changes; the doc is the doc.**

**Tech Stack:** Everything from Phases 1–3, plus `pg` (node-postgres) in `apps/ws-server`. Database is **Supabase Postgres** in every environment, reached with a standard `DATABASE_URL` — no `supabase-js`, no PostgREST.

Spec: `Docs/superpowers/specs/2026-07-16-phase-4a-persistence-design.md`.
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.4, §6, §11 row 4).

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` server stays a **pure relay**. It persists `Y.encodeStateAsUpdate(doc)` as one opaque `BYTEA` blob and restores it with `Y.applyUpdate`; it never reads `files`, `strokes`, or file text.
- **Database is Supabase Postgres in every environment** (production and tests), reached through a `DATABASE_URL`. Only vanilla Postgres features are used: `BYTEA`, upsert, one index.
- **Tables live in a private `sandbox` schema**, never granted to `anon`/`authenticated`, so Supabase's REST Data API cannot reach them. RLS is enabled as defense in depth. The database URL lives only on the server, never in the client bundle.
- **Graceful degradation:** with no `DATABASE_URL`, the server runs on `MemoryRoomStore` and logs a one-line warning — editing and drawing work, only persistence is absent.
- **Run-history persistence and multi-file tabs are OUT of scope** (a later slice and Phase 4b). Only the `rooms` table ships now; `RunStore` stays `MemoryRunStore`.
- **Persistence tests that need Postgres are gated on `DATABASE_URL`** and skip when it is absent, so a contributor without the secret is never blocked. They isolate via unique `test-…` room ids and clean up after themselves.
- The migration (`sql/001_persistence.sql`) must be applied to the Supabase database once (dashboard SQL editor or `pnpm db:migrate`) before the gated tests or the persistence e2e can pass — this session cannot reach Supabase to do it.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

```text
apps/ws-server/
  package.json                       MOD  + pg, @types/pg, db:migrate script
  sql/001_persistence.sql            NEW  the sandbox schema + rooms table
  src/env.ts                         MOD  + databaseUrl, roomGraceMs, roomTtlDays
  src/persistence/store.ts           NEW  RoomStore interface + MemoryRoomStore
  src/persistence/store.test.ts      NEW  memory store + Y.Doc round-trip (offline)
  src/persistence/postgres.ts        NEW  PostgresRoomStore (pg.Pool)
  src/persistence/postgres.test.ts   NEW  round-trip / upsert / deleteStale (gated on DATABASE_URL)
  src/sync/rooms.ts                  MOD  configureRooms, async load-or-seed, debounced save, flush
  src/sync/rooms.test.ts             NEW  lifecycle: seed→save→edit→flush→evict→reload (offline)
  src/server.ts                      MOD  roomStore option, configureRooms, async upgrade handler
  src/index.ts                       MOD  pick store from env, deleteStale on boot
  test/persistence.test.ts           NEW  server-level reload-after-evict via a Yjs client (offline)

e2e/
  persistence.spec.ts                NEW  reopen-tomorrow (gated on DATABASE_URL)
playwright.config.ts                 MOD  short ROOM_GRACE_MS in the ws-server webServer env
README.md                            MOD
```

---

### Task 1: The `RoomStore` interface and the in-memory store

The interface every persistence consumer talks to, plus the in-memory implementation used by tests and no-DB dev. Pure and offline — the same shape as the existing `RunStore`/`MemoryRunStore`.

**Files:**
- Create: `apps/ws-server/src/persistence/store.ts`
- Test: `apps/ws-server/src/persistence/store.test.ts`

**Interfaces:**
- Consumes: `Y` from `yjs`; `seedDoc`, `getFileText`, `getStrokes`, `DEFAULT_FILE`, `appendStroke` from `@sandbox/shared`.
- Produces: `interface RoomStore { load(roomId: string): Promise<Uint8Array | null>; save(roomId: string, state: Uint8Array): Promise<void>; deleteStale(olderThanMs: number): Promise<number>; close(): Promise<void>; }`; `class MemoryRoomStore implements RoomStore` with constructor `(now?: () => number)`.

- [ ] **Step 1: Write the failing test**

`apps/ws-server/src/persistence/store.test.ts`:

```ts
import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE, appendStroke, getFileText, getStrokes, seedDoc } from '@sandbox/shared';
import { MemoryRoomStore } from './store';

test('save then load returns the same bytes; a missing room is null', async () => {
  const store = new MemoryRoomStore();
  expect(await store.load('nope')).toBeNull();

  const bytes = new Uint8Array([1, 2, 3, 4]);
  await store.save('r1', bytes);
  expect(await store.load('r1')).toEqual(bytes);
});

test('a Y.Doc survives an encode → save → load → apply round-trip, strokes and all', async () => {
  const store = new MemoryRoomStore();

  const source = new Y.Doc();
  seedDoc(source);
  getFileText(source, DEFAULT_FILE.id).insert(0, 'PERSIST ME\n');
  appendStroke(source, {
    id: 's1',
    fileId: DEFAULT_FILE.id,
    authorId: 'ada',
    color: '#f97316',
    width: 3,
    shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    createdAt: 0,
  });

  await store.save('r1', Y.encodeStateAsUpdate(source));

  const restored = new Y.Doc();
  Y.applyUpdate(restored, (await store.load('r1'))!);

  expect(getFileText(restored, DEFAULT_FILE.id).toString()).toContain('PERSIST ME');
  expect(getStrokes(restored).toArray().map((s) => s.id)).toEqual(['s1']);
});

test('deleteStale removes only rooms older than the cutoff', async () => {
  let clock = 10_000;
  const store = new MemoryRoomStore(() => clock);

  await store.save('old', new Uint8Array([1])); // saved at t=10_000
  clock = 20_000;
  await store.save('new', new Uint8Array([2])); // saved at t=20_000

  clock = 25_000;
  const removed = await store.deleteStale(10_000); // cutoff = 15_000; 'old' is stale
  expect(removed).toBe(1);
  expect(await store.load('old')).toBeNull();
  expect(await store.load('new')).not.toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test store
```

Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write `store.ts`**

`apps/ws-server/src/persistence/store.ts`:

```ts
/**
 * Every persistence consumer talks to this interface — the sync room lifecycle loads a room's doc
 * on first connection and saves it on edit/leave. Storing the doc is not the same as understanding
 * it: the value is an opaque `Y.encodeStateAsUpdate` blob the relay never parses.
 */
export interface RoomStore {
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, state: Uint8Array): Promise<void>;
  /** Delete rooms untouched for longer than `olderThanMs`. Returns the number removed. */
  deleteStale(olderThanMs: number): Promise<number>;
  close(): Promise<void>;
}

/** Tests and no-DB local dev. Holds the last-saved blob per room, with a save timestamp. */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, { state: Uint8Array; updatedAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.rooms.get(roomId)?.state ?? null;
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    this.rooms.set(roomId, { state, updatedAt: this.now() });
  }

  async deleteStale(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.updatedAt < cutoff) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async close(): Promise<void> {}
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test store
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ws-server/src/persistence/store.ts apps/ws-server/src/persistence/store.test.ts
git commit -m "feat(ws-server): RoomStore interface and the in-memory store" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The Postgres store, the schema, and the `pg` dependency

`PostgresRoomStore` implements `RoomStore` against Supabase. The SQL migration creates the private `sandbox` schema. The test is gated on `DATABASE_URL`, so it runs in the Supabase-configured environment and skips elsewhere.

**Files:**
- Modify: `apps/ws-server/package.json`
- Create: `apps/ws-server/sql/001_persistence.sql`, `apps/ws-server/src/persistence/postgres.ts`
- Test: `apps/ws-server/src/persistence/postgres.test.ts`

**Interfaces:**
- Consumes: `Pool` from `pg`; `RoomStore` from `./store`.
- Produces: `class PostgresRoomStore implements RoomStore` with constructor `(connectionString: string)`.

- [ ] **Step 1: Add `pg` and the migrate script**

`apps/ws-server/package.json` — add to `dependencies`:

```json
"pg": "^8.13.1"
```

add to `devDependencies`:

```json
"@types/pg": "^8.11.10"
```

add to `scripts`:

```json
"db:migrate": "psql \"$DATABASE_URL\" -f sql/001_persistence.sql"
```

```bash
pnpm install
```

- [ ] **Step 2: Write the migration**

`apps/ws-server/sql/001_persistence.sql`:

```sql
-- Phase 4a persistence. A PRIVATE schema, never granted to anon/authenticated, so Supabase's
-- REST Data API cannot reach it. The ws-server reaches it via its direct Postgres connection.
create schema if not exists sandbox;

create table if not exists sandbox.rooms (
  id          text        primary key,
  ydoc_state  bytea       not null,        -- Y.encodeStateAsUpdate(doc)
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Defense in depth: even if the schema were ever exposed, no policy means the Data API sees nothing.
alter table sandbox.rooms enable row level security;
```

- [ ] **Step 3: Write the failing test**

`apps/ws-server/src/persistence/postgres.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PostgresRoomStore } from './postgres';

const url = process.env.DATABASE_URL;

// Gated: without a database this suite is skipped, so contributors without the secret are not blocked.
describe.skipIf(!url)('PostgresRoomStore', () => {
  const store = new PostgresRoomStore(url!);
  const ids: string[] = [];
  const roomId = () => {
    const id = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    ids.push(id);
    return id;
  };

  afterAll(async () => {
    for (const id of ids) await store.save(id, new Uint8Array()).catch(() => {});
    await store.deleteStale(-1); // cutoff in the future: removes every test row just touched
    await store.close();
  });

  test('load is null for an unknown room', async () => {
    expect(await store.load(roomId())).toBeNull();
  });

  test('save then load round-trips the exact bytes', async () => {
    const id = roomId();
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    await store.save(id, bytes);
    expect(await store.load(id)).toEqual(bytes);
  });

  test('save upserts — the second write overwrites the first', async () => {
    const id = roomId();
    await store.save(id, new Uint8Array([1, 1, 1]));
    await store.save(id, new Uint8Array([2, 2]));
    expect(await store.load(id)).toEqual(new Uint8Array([2, 2]));
  });

  test('deleteStale removes rooms older than the cutoff and returns the count', async () => {
    const id = roomId();
    await store.save(id, new Uint8Array([1]));
    // Everything just written is younger than 1 hour, so nothing is stale.
    expect(await store.deleteStale(3_600_000)).toBe(0);
    // A negative cutoff is "older than the future" — the row is removed.
    expect(await store.deleteStale(-1)).toBeGreaterThanOrEqual(1);
    expect(await store.load(id)).toBeNull();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test postgres
```

Expected: FAIL — cannot resolve `./postgres`. (If `DATABASE_URL` is unset the suite is skipped; write the implementation anyway — the gated run is what proves it, and it runs in the Supabase environment.)

- [ ] **Step 5: Write `postgres.ts`**

`apps/ws-server/src/persistence/postgres.ts`:

```ts
import { Pool } from 'pg';
import type { RoomStore } from './store';

/**
 * The room store against Supabase Postgres. A long-lived pool (the ws-server is a persistent
 * process). `pg` maps `bytea` to a Node Buffer both ways. Tables live in the private `sandbox`
 * schema, unreachable through Supabase's Data API.
 */
export class PostgresRoomStore implements RoomStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async load(roomId: string): Promise<Uint8Array | null> {
    const { rows } = await this.pool.query<{ ydoc_state: Buffer }>(
      'select ydoc_state from sandbox.rooms where id = $1',
      [roomId],
    );
    return rows.length > 0 ? new Uint8Array(rows[0]!.ydoc_state) : null;
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    await this.pool.query(
      `insert into sandbox.rooms (id, ydoc_state) values ($1, $2)
       on conflict (id) do update set ydoc_state = excluded.ydoc_state, updated_at = now()`,
      [roomId, Buffer.from(state)],
    );
  }

  async deleteStale(olderThanMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `delete from sandbox.rooms where updated_at < now() - (interval '1 millisecond' * $1)`,
      [olderThanMs],
    );
    return rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

- [ ] **Step 6: Typecheck; run the gated test if `DATABASE_URL` is set**

```bash
pnpm --filter @sandbox/ws-server typecheck
pnpm --filter @sandbox/ws-server test postgres
```

Expected: typecheck clean. With `DATABASE_URL` set (and the migration applied): PASS — 4 tests. Without it: the suite is skipped (0 tests) — that is a pass, not a failure.

- [ ] **Step 7: Commit**

```bash
git add apps/ws-server/package.json apps/ws-server/sql/001_persistence.sql apps/ws-server/src/persistence/postgres.ts apps/ws-server/src/persistence/postgres.test.ts pnpm-lock.yaml
git commit -m "feat(ws-server): PostgresRoomStore, the sandbox schema, and pg" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(If the `git add` path to the lockfile errors, add it from the repo root: `git add pnpm-lock.yaml`.)

---

### Task 3: Persistence in the room lifecycle

`sync/rooms.ts` becomes persistence-aware while `Room` stays a pure relay. First connection loads or seeds; edits debounce-save; last-leave flushes; the existing 30s grace evicts. Tested offline with `MemoryRoomStore` and short timers — no server, no socket.

**Files:**
- Modify: `apps/ws-server/src/sync/rooms.ts`
- Test: `apps/ws-server/src/sync/rooms.test.ts`

**Interfaces:**
- Consumes: `Room` from `./room`; `RoomStore`, `MemoryRoomStore` from `../persistence/store`; `Y` from `yjs`.
- Produces: `configureRooms(opts: { store: RoomStore; graceMs?: number; saveDebounceMs?: number }): void`; `getOrCreateRoom(id: string): Promise<Room>` (now async); unchanged names `releaseRoom(room: Room, ms?: number): void`, `roomCount(): number`, `resetRooms(): void`.

- [ ] **Step 1: Write the failing test**

`apps/ws-server/src/sync/rooms.test.ts`:

```ts
import { afterEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE, getFileText } from '@sandbox/shared';
import { MemoryRoomStore } from '../persistence/store';
import { configureRooms, getOrCreateRoom, releaseRoom, resetRooms, roomCount } from './rooms';

afterEach(() => resetRooms());

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a brand-new room is seeded and the seed is persisted immediately', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store });

  const room = await getOrCreateRoom('r-seed');

  expect(getFileText(room.doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
  // The seed was saved on create, so a row exists before any edit.
  expect(await store.load('r-seed')).not.toBeNull();
});

test('an edit is debounce-saved to the store', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store, saveDebounceMs: 20 });

  const room = await getOrCreateRoom('r-edit');
  getFileText(room.doc, DEFAULT_FILE.id).insert(0, 'HELLO\n');

  await settle(60);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, (await store.load('r-edit'))!);
  expect(getFileText(restored, DEFAULT_FILE.id).toString()).toContain('HELLO');
});

test('concurrent first-connections share one load-and-seed', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store });

  const [a, b] = await Promise.all([getOrCreateRoom('r-race'), getOrCreateRoom('r-race')]);

  expect(a).toBe(b); // the same Room instance, not two
  expect(roomCount()).toBe(1);
});

test('an edit survives eviction and is reloaded from the store', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store, saveDebounceMs: 20, graceMs: 20 });

  const first = await getOrCreateRoom('r-reload');
  getFileText(first.doc, DEFAULT_FILE.id).insert(0, 'REMEMBER\n');
  await settle(60); // let the debounced save land

  releaseRoom(first); // no connections → flush + schedule eviction
  await settle(60); // let the grace eviction run
  expect(roomCount()).toBe(0);

  const second = await getOrCreateRoom('r-reload'); // cold: must reload from the store
  expect(getFileText(second.doc, DEFAULT_FILE.id).toString()).toContain('REMEMBER');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test rooms
```

Expected: FAIL — `configureRooms` is not exported and `getOrCreateRoom` is not awaitable in the way the test uses it.

- [ ] **Step 3: Rewrite `rooms.ts`**

Replace the entire contents of `apps/ws-server/src/sync/rooms.ts`:

```ts
import * as Y from 'yjs';
import { MemoryRoomStore, type RoomStore } from '../persistence/store';
import { Room } from './room';

/** A room outlives its last connection briefly, so a page refresh does not wipe the document. */
export const ROOM_GRACE_MS = 30_000;
/** Edits are batched: the doc is written at most this often while someone is actively typing. */
export const SAVE_DEBOUNCE_MS = 2_000;

const rooms = new Map<string, Room>();
const loading = new Map<string, Promise<Room>>(); // in-flight creations, so a race shares one load
const evictions = new Map<string, NodeJS.Timeout>();
const saveTimers = new Map<string, NodeJS.Timeout>();

let store: RoomStore = new MemoryRoomStore();
let graceMs = ROOM_GRACE_MS;
let saveDebounceMs = SAVE_DEBOUNCE_MS;

/** Called once at server creation to inject the store and (in tests) shorten the timers. */
export const configureRooms = (opts: {
  store: RoomStore;
  graceMs?: number;
  saveDebounceMs?: number;
}): void => {
  store = opts.store;
  graceMs = opts.graceMs ?? ROOM_GRACE_MS;
  saveDebounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
};

const cancelEviction = (id: string): void => {
  const pending = evictions.get(id);
  if (!pending) return;
  clearTimeout(pending);
  evictions.delete(id);
};

const persist = async (id: string, room: Room): Promise<void> => {
  // Encode synchronously at call time, so a later eviction cannot change what we are about to write.
  const state = Y.encodeStateAsUpdate(room.doc);
  await store.save(id, state).catch((error) => console.error(`[persist] save failed for ${id}:`, error));
};

const scheduleSave = (id: string, room: Room): void => {
  const pending = saveTimers.get(id);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    saveTimers.delete(id);
    void persist(id, room);
  }, saveDebounceMs);
  timer.unref();
  saveTimers.set(id, timer);
};

const flush = async (id: string, room: Room): Promise<void> => {
  const pending = saveTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    saveTimers.delete(id);
  }
  await persist(id, room);
};

export const getOrCreateRoom = async (id: string): Promise<Room> => {
  cancelEviction(id);

  const existing = rooms.get(id);
  if (existing) return existing;

  const inFlight = loading.get(id);
  if (inFlight) return inFlight;

  const creation = (async () => {
    const room = new Room(id);

    let state: Uint8Array | null = null;
    try {
      state = await store.load(id);
    } catch (error) {
      // A reachable room with an empty doc beats a dead socket. Seed and move on, loudly.
      console.error(`[persist] load failed for ${id}, seeding fresh:`, error);
    }

    if (state) {
      Y.applyUpdate(room.doc, state);
    } else {
      room.seed();
      await persist(id, room); // a row exists from the start, even before any edit
    }

    // Registered after load/seed so restoring the doc does not itself schedule a redundant save.
    room.doc.on('update', () => scheduleSave(id, room));

    rooms.set(id, room);
    loading.delete(id);
    return room;
  })();

  loading.set(id, creation);
  return creation;
};

export const releaseRoom = (room: Room, ms: number = graceMs): void => {
  if (room.size > 0 || evictions.has(room.id)) return;

  // Flush immediately on last-leave, so a crash during the grace window does not lose the edit.
  void flush(room.id, room);

  const timer = setTimeout(() => {
    evictions.delete(room.id);
    const current = rooms.get(room.id);
    if (current && current.size === 0) {
      rooms.delete(room.id);
      current.destroy();
    }
  }, ms);
  timer.unref();

  evictions.set(room.id, timer);
};

export const roomCount = (): number => rooms.size;

export const resetRooms = (): void => {
  evictions.forEach(clearTimeout);
  evictions.clear();
  saveTimers.forEach(clearTimeout);
  saveTimers.clear();
  loading.clear();
  rooms.forEach((room) => room.destroy());
  rooms.clear();
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test rooms
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ws-server/src/sync/rooms.ts apps/ws-server/src/sync/rooms.test.ts
git commit -m "feat(ws-server): load, debounce-save, and flush the room doc" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the store into the server and the boot path

`createSandboxServer` gains a `roomStore` option (default `MemoryRoomStore`) and calls `configureRooms`; its upgrade handler `await`s the now-async `getOrCreateRoom`. `env.ts` learns the database URL and the tunable timers. `index.ts` picks Postgres when `DATABASE_URL` is set and runs the TTL cleanup on boot. A server-level test proves a real Yjs client's edit survives disconnect + eviction + reconnect.

**Files:**
- Modify: `apps/ws-server/src/env.ts`, `apps/ws-server/src/server.ts`, `apps/ws-server/src/index.ts`
- Test: `apps/ws-server/test/persistence.test.ts`

**Interfaces:**
- Consumes: `RoomStore`, `MemoryRoomStore` from `./persistence/store`; `PostgresRoomStore` from `./persistence/postgres`; `configureRooms` from `./sync/rooms`.
- Produces: `SandboxServerOptions` gains `roomStore?: RoomStore`, `graceMs?: number`, `saveDebounceMs?: number`.

- [ ] **Step 1: Extend `env.ts`**

Replace `apps/ws-server/src/env.ts`:

```ts
export const env = {
  port: Number(process.env.PORT ?? 1234),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * A self-hosted Piston — `pnpm piston:up`. The public instance became whitelist-only on
   * 2026-02-15 (GET /runtimes answers; POST /execute is a 401), so it is not a usable default.
   */
  pistonUrl: process.env.PISTON_URL ?? 'http://localhost:2000/api/v2',
  /** Supabase Postgres. Unset → the server runs in-memory and rooms do not survive a restart. */
  databaseUrl: process.env.DATABASE_URL,
  /** How long a room lingers in memory after its last client leaves. Short in e2e for a fast reload. */
  roomGraceMs: Number(process.env.ROOM_GRACE_MS ?? 30_000),
  /** Rooms untouched for this many days are deleted on boot. A sandbox is disposable. */
  roomTtlDays: Number(process.env.ROOM_TTL_DAYS ?? 30),
};
```

- [ ] **Step 2: Wire `server.ts`**

In `apps/ws-server/src/server.ts`, add to the imports:

```ts
import { MemoryRoomStore, type RoomStore } from './persistence/store';
import { configureRooms } from './sync/rooms';
```

Extend `SandboxServerOptions`:

```ts
export type SandboxServerOptions = {
  executor?: CodeExecutor;
  store?: RunStore;
  roomStore?: RoomStore;
  graceMs?: number;
  saveDebounceMs?: number;
  now?: () => number;
};
```

Inside `createSandboxServer`, immediately after `const now = options.now ?? Date.now;`, configure the room store (default in-memory, exactly like `MemoryRunStore`):

```ts
  configureRooms({
    store: options.roomStore ?? new MemoryRoomStore(),
    graceMs: options.graceMs,
    saveDebounceMs: options.saveDebounceMs,
  });
```

Replace the `wss.handleUpgrade(...)` call so the callback is async and awaits the room:

```ts
    wss.handleUpgrade(req, socket, head, async (conn) => {
      // Two sockets, on purpose. /sync is a pure relay that never parses document semantics;
      // /exec is the single execution authority.
      if (prefix === 'sync') setupSyncConnection(conn, await getOrCreateRoom(roomId));
      else setupExecConnection(conn, getOrCreateExecRoom(roomId), ip, deps);
    });
```

- [ ] **Step 3: Wire `index.ts`**

Replace `apps/ws-server/src/index.ts`:

```ts
import { env } from './env';
import { PostgresRoomStore } from './persistence/postgres';
import { MemoryRoomStore, type RoomStore } from './persistence/store';
import { createSandboxServer } from './server';

let roomStore: RoomStore;
if (env.databaseUrl) {
  const pg = new PostgresRoomStore(env.databaseUrl);
  const removed = await pg.deleteStale(env.roomTtlDays * 24 * 60 * 60 * 1000);
  console.log(`[persist] connected; removed ${removed} stale room(s)`);
  roomStore = pg;
} else {
  console.warn('[persist] no DATABASE_URL — running in-memory; rooms will not survive a restart');
  roomStore = new MemoryRoomStore();
}

createSandboxServer({ roomStore, graceMs: env.roomGraceMs }).listen(env.port, env.host, () => {
  console.log(`[ws-server] listening on ${env.host}:${env.port}`);
});
```

- [ ] **Step 4: Write the failing server-level test**

`apps/ws-server/test/persistence.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, getFileText, listFiles } from '@sandbox/shared';
import { MemoryRoomStore } from '../src/persistence/store';
import { createSandboxServer } from '../src/server';
import { resetRooms, roomCount } from '../src/sync/rooms';

let server: ReturnType<typeof createSandboxServer>;
let syncUrl: string;
const store = new MemoryRoomStore(); // one store across both connections, so eviction can reload from it
const open: WebsocketProvider[] = [];

beforeEach(async () => {
  // A short grace + debounce so the room flushes and evicts within the test.
  server = createSandboxServer({ roomStore: store, graceMs: 40, saveDebounceMs: 20 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  syncUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sync`;
});

afterEach(async () => {
  open.splice(0).forEach((provider) => provider.destroy());
  resetRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connect = (room: string) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(syncUrl, room, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  open.push(provider);
  return { doc, provider };
};

const poll = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** True once the store holds a doc whose default file contains `needle`. */
const storedHas = async (roomId: string, needle: string): Promise<boolean> => {
  const bytes = await store.load(roomId);
  if (!bytes) return false;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return getFileText(doc, DEFAULT_FILE.id).toString().includes(needle);
};

test('an edit made by one client is restored for a later client after the room evicts', async () => {
  const roomId = `test-reload-${Date.now().toString(36)}`;

  const alice = connect(roomId);
  await poll(() => listFiles(alice.doc).length === 1);
  getFileText(alice.doc, DEFAULT_FILE.id).insert(0, 'SURVIVES\n');

  // Wait until the debounced save has reached the store, then drop the connection.
  await poll(() => storedHas(roomId, 'SURVIVES'));

  alice.provider.destroy();
  open.splice(open.indexOf(alice.provider), 1);
  await poll(() => roomCount() === 0); // flushed and evicted from memory

  const bob = connect(roomId); // cold room: the server must reload from the store
  await poll(() => getFileText(bob.doc, DEFAULT_FILE.id).toString().includes('SURVIVES'));
  expect(getFileText(bob.doc, DEFAULT_FILE.id).toString()).toContain('SURVIVES');
});
```

- [ ] **Step 5: Run it and watch it fail, then pass**

```bash
pnpm --filter @sandbox/ws-server test persistence
```

Expected: FAIL first if `server.ts`/`rooms.ts` are not yet wired (Steps 1–3 supply the wiring; if they are already in, it passes). Then PASS — 1 test.

- [ ] **Step 6: Run the whole ws-server suite and typecheck — nothing regressed**

```bash
pnpm --filter @sandbox/ws-server test
pnpm --filter @sandbox/ws-server typecheck
```

Expected: all green. The existing `test/sync.test.ts` and `test/exec.test.ts` still pass — `createSandboxServer()` with no `roomStore` defaults to `MemoryRoomStore`, so they stay offline and behave as before, and the async upgrade handler is transparent to them.

- [ ] **Step 7: Commit**

```bash
git add apps/ws-server/src/env.ts apps/ws-server/src/server.ts apps/ws-server/src/index.ts apps/ws-server/test/persistence.test.ts
git commit -m "feat(ws-server): select the store from env and reload rooms across eviction" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: The reopen-tomorrow e2e, and the README

The acceptance criterion for the phase, in two real browsers: draw and type, let the room evict, reopen the link, and everything is still there. Gated on `DATABASE_URL`, because a true reload needs Postgres.

**Files:**
- Modify: `playwright.config.ts`, `README.md`
- Create: `e2e/persistence.spec.ts`

- [ ] **Step 1: Give the e2e ws-server a short grace**

In `playwright.config.ts`, the ws-server `webServer` entry runs `pnpm --filter @sandbox/ws-server start`. Add an `env` so a room evicts seconds after the last tab closes (otherwise the test would wait the full 30s). Replace that entry:

```ts
    {
      command: 'pnpm --filter @sandbox/ws-server start',
      url: 'http://localhost:1234/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ROOM_GRACE_MS: '2000' },
    },
```

(`DATABASE_URL` is inherited from the shell the tests run in; when it is set, `index.ts` uses Postgres and the persistence e2e runs.)

- [ ] **Step 2: Write the e2e**

`e2e/persistence.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

// A real reload needs Postgres; without it the room only ever lived in memory and this cannot pass.
test.skip(!process.env.DATABASE_URL, 'persistence e2e requires DATABASE_URL (Supabase)');

test('code and a drawing survive closing every tab and reopening the link', async ({ browser }) => {
  const roomId = `test-e2e-${Date.now().toString(36)}`;

  // Alice types into the editor and draws one stroke over it.
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await join(alice, roomId, 'Alice');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# persisted note');
  await expect(alice.locator('.monaco-editor')).toContainText('persisted note');

  await alice.getByTestId('mode-toggle').click(); // Draw mode
  const canvas = alice.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await alice.mouse.move(box.x + 80, box.y + 60);
  await alice.mouse.down();
  await alice.mouse.move(box.x + 200, box.y + 90, { steps: 8 });
  await alice.mouse.up();
  await expect(alice.getByTestId('stroke')).toHaveCount(1);

  // Everyone leaves. Wait past the 2s grace so the room flushes to Postgres and evicts from memory.
  await aliceCtx.close();
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // A fresh person opens the same link — the server reloads the room from Postgres.
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await join(bob, roomId, 'Bob');

  await expect(bob.locator('.monaco-editor')).toContainText('persisted note');
  await expect(bob.getByTestId('stroke')).toHaveCount(1);

  await bobCtx.close();
});
```

- [ ] **Step 3: Run the e2e (with `DATABASE_URL` set and the migration applied)**

```bash
pnpm test:e2e e2e/persistence.spec.ts
```

Expected: with `DATABASE_URL` set and `sql/001_persistence.sql` applied to Supabase — PASS, 1 test. Without `DATABASE_URL` — skipped (a pass).

If it fails because Bob sees an empty editor, the room did not reload: check that `index.ts` chose `PostgresRoomStore` (the boot log), that the migration was applied, and that the grace elapsed before Bob joined.

- [ ] **Step 4: Update the README**

`README.md` — update the Status, "What works today", Architecture, Running-it, Tests, and "Not built yet" sections.

Status line:

```markdown
**Status:** Phase 4a of 5 — collaborative editing, shared execution, a drawing overlay, and durable rooms.
```

Add to "What works today":

```markdown
- Close every tab and reopen the link later — the code and the drawings are still there. Each room's
  whole document is persisted to Postgres and reloaded on the next visit.
```

Add to "Architecture":

```markdown
- **Rooms are durable.** The server stores each room's whole `Y.Doc` as one opaque `BYTEA` blob in
  Postgres — encoded with `Y.encodeStateAsUpdate`, never parsed — loading it on the first connection,
  debounce-saving on edit, flushing when the last client leaves, and evicting from memory after a grace
  period. The `/sync` relay stays pure; persistence is a store behind the room lifecycle, swappable by
  connection string. Tables live in a private `sandbox` schema, off Supabase's REST Data API.
```

Update "Running it" — note the database:

```markdown
Persistence uses **Supabase Postgres**. Set `DATABASE_URL` to your Supabase session-pooler connection
string and apply `apps/ws-server/sql/001_persistence.sql` once (Supabase SQL editor or
`pnpm --filter @sandbox/ws-server db:migrate`). Without `DATABASE_URL` the app still runs — editing and
drawing work — but rooms are in-memory and do not survive a restart.
```

Update "Tests" (use the real totals printed by `pnpm test` and `pnpm test:e2e`):

```markdown
pnpm test         # <N> unit + integration tests (Vitest); persistence tests need DATABASE_URL, else skipped
pnpm test:e2e     # <M> browser tests (Playwright); the reopen-tomorrow test needs DATABASE_URL, else skipped
```

Update "Not built yet":

```markdown
Multi-file tabs (Phase 4b), line-anchored annotations and deployment (Phase 5).
```

- [ ] **Step 5: Run the full suite for real totals, then commit**

```bash
pnpm test
pnpm typecheck
```

Expected: all green (persistence Postgres tests run if `DATABASE_URL` is set, else skip). Put the real `pnpm test` total into the README line before committing — a README must not state a count the suite does not produce.

```bash
git add e2e/persistence.spec.ts playwright.config.ts README.md
git commit -m "test(e2e): reopen-tomorrow persistence, and the README" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the Phase 4a spec maps to a task. `RoomStore` interface + `MemoryRoomStore` (§3.1, §5.1) → Task 1. `PostgresRoomStore`, the `sandbox` schema, and the security posture (§4, §5.1, §8) → Task 2. Load-or-seed, in-flight guard, debounced save, flush-on-leave, grace eviction (§5.2, §6) → Task 3. Store selection from env, graceful degradation, async upgrade, boot TTL cleanup (§5.3–§5.5, §7) → Task 4. The reopen-tomorrow e2e and the README (§9) → Task 5. Testing (§9) is spread across every task: offline units in 1/3, gated Postgres integration in 2, offline server integration in 4, gated e2e in 5.

**Placeholder scan.** Every step shows complete code and names its expected result. The two README test-count lines are the only intentional `<N>`/`<M>` — the plan states, twice, that the real totals from `pnpm test` / `pnpm test:e2e` must replace them before the commit.

**Type consistency.** `RoomStore` (`load`/`save`/`deleteStale`/`close`) keeps one signature across `store.ts`, `postgres.ts`, and every consumer. `configureRooms({ store, graceMs?, saveDebounceMs? })` and the now-async `getOrCreateRoom(id): Promise<Room>` match between `rooms.ts`, its test, and `server.ts`. `SandboxServerOptions` gains `roomStore`/`graceMs`/`saveDebounceMs`, used consistently by `index.ts` and the tests. `MemoryRoomStore(now?)` is constructed with no argument everywhere except the `deleteStale` unit test, which passes a controllable clock.

**Two judgement calls worth flagging for review.** (1) The room registry stays module-level (with `configureRooms` injection) rather than becoming a `RoomRegistry` class — the smaller, lower-risk diff that matches the existing `rooms.ts` style, at the cost of a module-level store that serial tests reset. (2) Run-history persistence is deliberately excluded (spec §2/§10); `MemoryRunStore` is untouched, so the exec suite is unaffected.

**Test-count lines in the README.** Written as `<N>`/`<M>` placeholders on purpose, with an explicit instruction to substitute the real totals from the suite before committing. The suite gains: Task 1 (3) + Task 3 (4) offline units, Task 4 (1) offline server integration, plus the gated Postgres (4) and gated e2e (1) that run only with `DATABASE_URL`.
