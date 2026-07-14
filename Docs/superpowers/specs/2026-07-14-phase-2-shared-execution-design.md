# Phase 2 — Shared Execution — Design

Date: 2026-07-14
Status: Approved
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§3, §5.4, §5.5, §11)
Builds on: Phase 1 (complete) — `Docs/superpowers/plans/2026-07-13-phase-0-1-collaborative-editor.md`

## 1. Purpose

Anyone in the room presses Run; **everyone** sees the same stdout and stderr appear in the same
terminal at the same moment. That is success criterion §2.2 of the master spec, and it is the whole
of Phase 2.

User code never executes on our host. The server makes an HTTPS call to the public Piston API, which
runs the code in an isolated, network-less container with hard CPU, memory and wall-clock limits.
This is the master spec's highest-priority NFR, met by an executor we do not have to operate.

**Acceptance:** Alice presses Run in one browser context; Bob, in another, sees the output. Proven by
an end-to-end test, not by inspection.

## 2. Deviations from the master spec, and why

Phase 1 is now built, and three things the master spec asserted are better decided against the code
that exists than the code it imagined. Each is a knowing deviation, recorded here rather than by
rewriting the master spec.

| Master spec says | We build | Why |
|---|---|---|
| §3: the socket is `/exec?room=<id>` | `/exec/<roomId>` | Phase 1 shipped **path**-based routing (`/sync/<roomId>`, `server.ts`). The query-param form was never built. Match the code, not the prose. |
| §5.4: "Run history from before you joined is fetched over REST on mount" | History is **replayed over the `/exec` socket** on connect | Same data, same Phase-4 store seam, one fewer transport. REST would add CORS to the ws-server (web is `:3000`, server is `:1234`), a fetch client, and its own loading/error/retry states — to deliver bytes down a socket the client is opening anyway. |
| §5.4: "an stdin box" (locality unstated) | stdin is **local** to each user, echoed to the room in `run:started` | The requirement is that output be *intelligible* to everyone, and echoing the input satisfies it. A co-edited stdin box would also mean two people wanting different inputs must fight over one field. |

One addition beyond the master spec's Phase 2 row: a **language picker** (§6). It is throwaway work —
Phase 4 derives language from the file extension — and it is worth it, because it takes the Phase 2
demo from one runtime to three.

## 3. Architecture

### 3.1 The transport

A **second WebSocket per room, at `/exec/<roomId>`.** Two sockets, on purpose: the `/sync` socket is a
pure relay that never parses document semantics, and `/exec` is the single execution authority.

Two alternatives were considered and rejected:

**Multiplex onto the existing y-websocket socket** by adding message types to the sync protocol. One
connection instead of two, but `y-websocket`'s client owns that socket's framing: we would be reaching
into its `messageHandlers` internals, entangling exec's lifecycle with sync's reconnect and backoff,
and destroying the one property the architecture rests on — that the sync socket understands nothing
but Yjs.

**HTTP `POST /run` plus SSE for output.** You still need a push channel to tell the *other* clients
that a run started, so a socket reappears anyway — now alongside a second transport and CORS.

### 3.2 Server

Phase 2 adds `apps/ws-server/src/exec/` and modifies the existing sync code **not at all** — the only
change outside `exec/` is a new route and an options bag in `server.ts`.

```text
apps/ws-server/src/
  exec/
    executor.ts     CodeExecutor interface + StubExecutor (tests)
    piston.ts       PistonExecutor → POST ${PISTON_URL}/execute
    limiter.ts      token bucket; injected clock; pure
    runs.ts         RunStore interface + MemoryRunStore (ring buffer)
    rooms.ts        ExecRoom registry: connections + run log, grace-period eviction
    protocol.ts     zod schemas inbound; encoders outbound
    connection.ts   setupExecConnection(conn, execRoom, deps)
  server.ts         + /exec/<roomId> upgrade route; createSandboxServer({ executor, store, now })
  env.ts            + PISTON_URL
```

**`ExecRoom` is a separate registry from `Room`, not a second connection set bolted onto it.** `Room`
is defined as "one Y.Doc + one Awareness + the connections syncing them"; an execution channel is a
different concern with a different lifetime. They share nothing but the roomId string. Keeping them
apart is what lets Phase 2 leave the pure relay untouched.

`createSandboxServer()` grows an options bag so tests can inject a `StubExecutor`, a fake clock, and
an empty store. That injection seam is required by the integration tests in §9.

### 3.3 Web

```text
apps/web/
  lib/exec/
    client.ts       ExecClient: one socket per room, cached module-side (StrictMode guard)
    useExec.ts      hook → { runs, status, run(), isRunning }
    ExecContext.tsx shares one handle with the tree
  components/
    Terminal.tsx    xterm.js, dynamic import ssr:false
    RunBar.tsx      Run button, language picker, stdin field, cooldown
```

**The exec socket needs the same module-level cache and refcount as `lib/yjs/room.ts`.** React
StrictMode double-invokes effects in development; without the guard, every room opens two exec sockets
and every run renders twice. It is the identical trap, and it gets the identical guard.

## 4. Data Model

### 4.1 Wire protocol

These types live in `@sandbox/shared` — they cross the wire.

```ts
// client → server
type RunRequest = {
  type: 'run';
  byUser: User;
  fileName: string;        // 'main.py' — Piston keys off the extension for TS/JS
  language: LanguageId;    // 'python' | 'javascript' | 'typescript'
  code: string;            // ≤ MAX_CODE_BYTES  (64 KiB)
  stdin: string;           // ≤ MAX_STDIN_BYTES ( 4 KiB)
};

// server → client
type ExecMessage =
  | { type: 'run:history'; runs: RunRecord[] }                                    // on connect; may be []
  | { type: 'run:started'; runId: string; byUser: User; fileName: string;
      language: LanguageId; stdin: string; at: number }
  | { type: 'run:output';  runId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'run:done';    runId: string; exitCode: number; durationMs: number }
  | { type: 'run:error';   runId: string; message: string };
```

The client that pressed Run sends **the code snapshot it currently sees**. The server therefore never
reads the CRDT, and the relay stays pure.

**Who receives what, and it is not uniform.** `run:history` is sent to the one connection that just
opened. `run:started`, `run:output` and `run:done` are broadcast to the whole room — that broadcast
*is* the feature. `run:error` splits, and the split matters:

| Failure | Sent to | Stored? |
|---|---|---|
| **Rate limited** — the run never started | The requesting connection **only** | No |
| **Executor failed** — after `run:started` was broadcast | The whole room | Yes, as a `RunRecord` with `error` set |

A rate-limit rejection is the rejected user's problem and nobody else's; broadcasting it would litter
four other terminals with news of a run that never happened, and fill the ring buffer with non-runs.
An executor failure is the opposite: the room has already been told a run started, so the room must be
told it failed — otherwise every terminal is left showing a run that never completes.

`byUser` is client-supplied and unauthenticated — consistent with the existing threat model, where
identity is cosmetic and the room id is the only access control (master spec §9). It is still passed
through `sanitizeName` at the zod boundary before it is stored or broadcast.

**On `run:output` being chunked.** Piston is request/response: it returns complete stdout and stderr
when the process exits, so the server emits **exactly one** `run:output` per non-empty stream. The
protocol is chunked anyway, so that a streaming executor (a self-hosted Docker runner with a pty) can
drop in behind `CodeExecutor` without changing the wire format or the terminal. **Do not build a
"streaming" Piston adapter — it cannot exist.**

### 4.2 RunRecord

Deliberately column-for-column with the Phase 4 `runs` table (master spec §4.4), so `MemoryRunStore`
→ `PostgresRunStore` is a swap behind one interface and nothing above it changes.

```ts
type RunRecord = {
  id: string;
  roomId: string;
  byUser: User;
  fileName: string;
  language: LanguageId;
  stdin: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;      // null if the run errored before the process ran
  durationMs: number | null;
  error?: string;               // rate limited, timed out, executor down
  createdAt: number;
};
```

Run history is **server-authored, not collaborative state**. It does not belong in the Y.Doc: putting
it there would force the relay to understand document semantics, and every server instance would
observe the same pending run and execute it twice.

### 4.3 Limits

| Constant | Value | Why |
|---|---|---|
| `MAX_CODE_BYTES` | 64 KiB | A code file, not a payload. Rejected at the zod boundary. |
| `MAX_STDIN_BYTES` | 4 KiB | Same. |
| `MAX_OUTPUT_BYTES` | 64 KiB per stream | A runaway print loop must not blow up every client's memory or the ring buffer. Truncated with an explicit `… output truncated` marker — never silently. |
| `RUN_HISTORY_LIMIT` | 50 runs per room | Ring buffer. Enough to scroll back through a session. |
| `EXECUTOR_TIMEOUT_MS` | 15 000 | `AbortController` ceiling on the Piston call, so a hung executor cannot hang the room. |
| Rate limit, per room | 1 run / 2 s | Piston's public instance allows roughly 5 req/s **across all its users**. |
| Rate limit, per IP | 20 runs / min | Hammering it is both rude and the fastest way to get the demo blocked. |

## 5. Components

### 5.1 `CodeExecutor`

```ts
interface CodeExecutor {
  run(req: {
    language: LanguageId;
    fileName: string;
    code: string;
    stdin: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
}
```

`PistonExecutor` implements it against the public Piston API. A `DockerExecutor` is a later, optional
adapter and **must not require touching anything above this interface**.

(Master spec §5.5 gave this interface an optional `version?: string`. Nothing would ever have set it —
the runtime version is a property of the executor, not of the caller — so it is resolved from
`language` inside `PistonExecutor` and does not appear in the interface.)

### 5.2 `PistonExecutor`

`POST ${PISTON_URL}/execute` with `{ language, version, files: [{ name, content }], stdin }`.
Runtime versions are pinned in one place in `@sandbox/shared` and verified against Piston's
`GET /runtimes` at implementation time; if Piston bumps a runtime, the pin is one constant to change.
`PISTON_URL` is an env var defaulting to the public instance, which is also the seam for self-hosting
Piston later.

`durationMs` is measured by us around the call — Piston does not return it. A process killed by
Piston's own timeout comes back with a signal rather than an exit code; that is surfaced as a
`run:error`, not as a silent exit 0.

Failure mapping, all of them loud:

| Condition | Result |
|---|---|
| HTTP 429 | `run:error` — "Piston is rate limiting us. Try again in a moment." |
| Timeout (`AbortController`) | `run:error` — "The executor did not respond in 15s." |
| Non-2xx, malformed body, network error | `run:error` — "The executor is unavailable." |
| Unsupported language | Rejected at the zod boundary before we ever call Piston. |

### 5.3 Token-bucket limiter

Pure, with an injected clock, so it is exhaustively unit-testable without waiting in real time. Two
buckets per run request: the room's and the caller's IP. A rejected run returns `run:error` and the
client shows a cooldown on the Run button.

The client also disables Run while a run is in flight — every client knows, because they all received
`run:started`. That is a courtesy, not a control: **the limiter is server-side and the client is never
trusted with it.**

### 5.4 `RunStore` and `ExecRoom`

`RunStore` is `append(record)` / `list(roomId)`. `MemoryRunStore` is a per-room ring buffer of
`RUN_HISTORY_LIMIT`. `ExecRoom` holds the room's exec connections and broadcasts to all of them,
mirroring the shape of the sync `Room` (create, release, grace-period eviction, `reset()` for tests)
without sharing its code — they have nothing in common but a name.

On connect, a client is immediately sent `{ type: 'run:history', runs }` — possibly empty, always
sent, so the terminal can distinguish "loaded, nothing here" from "still loading".

### 5.5 Terminal

`xterm.js` docked at the bottom of the workspace, dynamically imported with `ssr: false` (it touches
`window` at module scope, exactly like Monaco). It is a **shared output console, not a pty**: a Run
button, an stdin field supplied to the process up front, and a scrollback every client receives
identically. This is the master spec's stated, deliberate narrowing of the PRD's "interact with the
terminal prompt" — an interactive shell needs a pty on a machine we control.

One run renders as:

```text
▸ Alice ran main.py  ◂ stdin: 5
1
2
Fizz
✓ exited 0 in 412ms
```

stderr and error lines are red. The `◂ stdin:` clause is omitted when stdin is empty.

### 5.6 RunBar

Run button, language picker (§6), stdin field. `Ctrl`/`Cmd`+`Enter` is registered through Monaco's
`editor.addCommand` — Monaco swallows keydown, so a document-level listener would never fire while the
editor has focus. Run is disabled, with a reason, when a run is in flight, when the cooldown is
active, and when the exec socket is down.

## 6. The language picker

Choosing a language writes `language` into the file's entry in the `files` Y.Map **and swaps the
filename's extension** (`main.py` → `main.js`), then retargets the Monaco model. Name and language
must not drift apart: Piston keys off the filename for TypeScript and JavaScript, so a file called
`main.py` containing TypeScript would not compile.

This adds one accessor to `@sandbox/shared`:

```ts
setFileLanguage(doc: Y.Doc, fileId: string, language: LanguageId): void
```

It maintains the same invariant Phase 4 will maintain from the other direction — there, renaming the
file drives the language; here, the language drives the rename. Phase 4 replaces this picker, and the
invariant survives it.

## 7. Error Handling

Every failure is visible, in the terminal, in words:

- **Executor failures** (429, timeout, unavailable, killed by signal) → a red `run:error` line with a
  human explanation. Never silent, never a swallowed promise.
- **Rate limited** → a red line naming the limit, and a Run button that shows its cooldown.
- **Exec socket down** → Run is disabled and says "Offline". The socket reconnects with backoff, and
  on reconnect the client is sent `run:history` again. The client therefore keeps runs in a map
  **keyed by `runId`**, not an append-only list: a reconnect must re-render the same scrollback, not a
  second copy of it.
- **Malformed inbound message** → zod rejects it and the socket is **closed**, not coerced (master
  spec §7).
- **Output too large** → truncated at `MAX_OUTPUT_BYTES` with an explicit marker.

## 8. Security

The threat model does not change, and Phase 2 does not weaken it.

- User code **never** executes on our server or the host. We shell out to nothing. The server makes
  one HTTPS call to Piston; the code is a string we forward, never something we evaluate, interpolate
  into a shell, or write to disk.
- Server-side rate limiting protects both Piston and us from an abusive client.
- All `/exec` input is schema-validated at the boundary, including a hard cap on code and stdin size.
- Room ids on the `/exec` route are validated with the same `isValidRoomId` as `/sync`; unvalidated
  ids let anyone allocate unbounded server rooms.
- **Unchanged and still accepted:** the room id is the only access control. Anyone with the URL can
  read, edit, and now *run*. Running is not a new exposure — it executes in Piston's sandbox, not
  ours — but it is worth stating plainly that the link is the whole of the security model.
- No secrets in the client bundle. `PISTON_URL` lives only on the server.

## 9. Testing

Written test-first, as in Phase 1.

**Unit (Vitest).**
- Token bucket against a fake clock: refill, exhaustion, independent room and IP buckets.
- `PistonExecutor` against a mocked `fetch`: success, 429, timeout, 500, malformed body, killed-by-signal.
- The zod boundary: oversized code, oversized stdin, unknown language, missing fields, hostile `byUser.name`.
- `MemoryRunStore`: append, list, ring-buffer eviction past `RUN_HISTORY_LIMIT`.
- `setFileLanguage`: language and filename extension stay in step.

**Integration (Node).** Boot the server with a `StubExecutor`. Connect two `/exec` clients to one
room; one sends `run`; assert **both** receive `run:started`, `run:output`, `run:done`, in that order.
A third client connecting afterwards receives `run:history` containing that run. A second run inside
the 2s window receives `run:error`. A malformed message closes the socket.

**E2E (Playwright, two browser contexts).** Alice presses Run; **Bob** sees the output. This mirrors
success criterion §2.2 of the master spec and is the acceptance test for the phase. Contexts, not
tabs — as in Phase 1, tabs could sync behind the server's back and pass falsely.

## 10. Out of Scope for Phase 2

- **Cancellation.** Piston is request/response; there is nothing to cancel.
- **An interactive terminal prompt.** Requires a pty on a machine we control. The `CodeExecutor`
  interface is the seam; a `DockerExecutor` plus `node-pty` streaming would touch nothing above it.
- **Persistence.** Run history dies with the room's grace period. Phase 4 brings Postgres, and
  `RunStore` is the interface it drops in behind.
- **Multi-file.** Phase 4. Phase 2 runs the one seeded file.
- **Redis backplane / multiple server instances.** Phase 2's single execution authority is precisely
  the design that makes this possible later; building it now buys nothing.
