# Phase 2 — Shared Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone in the room presses Run; **everyone** sees the same stdout and stderr appear in the same terminal at the same moment.

**Architecture:** A second WebSocket per room at `/exec/<roomId>`, alongside the Phase 1 `/sync/<roomId>` relay. The `/sync` socket stays a pure Yjs relay and is not touched. `/exec` is the single execution authority: it validates a run request at the boundary with zod, rate-limits it with a token bucket, forwards the code to the public Piston API (which runs it in an isolated, network-less container — user code never touches our host), and broadcasts the result to every client in the room. Run history lives in a `RunStore` behind an interface, so Phase 4 can drop Postgres in without touching anything above it.

**Tech Stack:** Everything from Phase 1, plus `zod` 4 (boundary validation, ws-server) and `@xterm/xterm` 6 + `@xterm/addon-fit` (the terminal, web). Run ids come from `node:crypto`'s `randomUUID` — no new dependency.

Spec: `Docs/superpowers/specs/2026-07-14-phase-2-shared-execution-design.md`.
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§5.4, §5.5, §11).

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` server remains a **pure relay**. Phase 2 must not add a single read of application-level keys out of the Y.Doc on the server. **The client that presses Run sends the code snapshot it currently sees** — that is what keeps the relay pure.
- **Exactly one Yjs instance in the dependency graph** (`@sandbox/shared` declares `yjs` as a peerDependency). Unchanged from Phase 1; do not add `yjs` to `apps/ws-server`'s dependencies a second time.
- **Piston is request/response.** It returns complete stdout and stderr when the process exits. The server therefore emits **exactly one `run:output` per non-empty stream**. The protocol is chunked anyway so a streaming executor can replace it later. **Do not build a "streaming" Piston adapter — it cannot exist.**
- **Every inbound `/exec` message is zod-validated.** Anything that fails validation **closes the socket** (code 1003). Never coerce a malformed message into a valid one.
- **The rate limiter is server-side and the client is never trusted with it.** The client disabling its Run button is a courtesy, not a control.
- **Piston needs an explicit `version`.** It lists two TypeScript runtimes (Node `5.0.3`, Deno `1.32.3`) and two JavaScript runtimes. Sending `language` alone is ambiguous.
- **xterm needs CRLF.** A bare `\n` moves down a line without returning to column 0, producing a staircase. Every string written to the terminal converts `\n` → `\r\n`.
- **xterm and Monaco both touch `window` at module scope.** Every module that imports them is reachable only through `next/dynamic` with `ssr: false`.
- **The exec socket needs the same StrictMode guard as `lib/yjs/room.ts`** — a module-level cache keyed by roomId with a refcount. Without it every room opens two exec sockets in development and every run renders twice.
- Room ids: `^[A-Za-z0-9_-]{6,32}$`, validated on the `/exec` route with the same `isValidRoomId` as `/sync`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No persistence until Phase 4. Run history dies with the server. That is expected, not a bug.

## File Structure

```text
packages/shared/
  src/exec.ts                  NEW  wire types, limits, pinned Piston runtimes, byteLength, truncateOutput
  src/exec.test.ts             NEW
  src/model.ts                 MOD  + renameExtension
  src/model.test.ts            MOD  + renameExtension tests
  src/doc.ts                   MOD  + setFileLanguage
  src/doc.test.ts              MOD  + setFileLanguage tests
  src/index.ts                 MOD  + export * from './exec.js'

apps/ws-server/
  package.json                 MOD  + zod
  src/env.ts                   MOD  + pistonUrl
  src/exec/limiter.ts          NEW  TokenBuckets — pure, injected clock
  src/exec/limiter.test.ts     NEW
  src/exec/executor.ts         NEW  CodeExecutor interface, ExecutorError, StubExecutor
  src/exec/piston.ts           NEW  PistonExecutor
  src/exec/piston.test.ts      NEW  against a mocked fetch
  src/exec/runs.ts             NEW  RunStore interface + MemoryRunStore
  src/exec/runs.test.ts        NEW
  src/exec/rooms.ts            NEW  ExecRoom + registry (connections only)
  src/exec/protocol.ts         NEW  zod schemas in, JSON encoders out
  src/exec/protocol.test.ts    NEW
  src/exec/connection.ts       NEW  setupExecConnection — the execution authority
  src/server.ts                MOD  options bag + /exec route
  test/exec.test.ts            NEW  integration: two clients, one run, both see it

apps/web/
  package.json                 MOD  + @xterm/xterm, @xterm/addon-fit
  lib/env.ts                   MOD  + EXEC_URL
  lib/exec/state.ts            NEW  applyExecMessage — pure reducer, keyed by runId
  lib/exec/state.test.ts       NEW
  lib/exec/render.ts           NEW  renderRuns — pure, ANSI, CRLF
  lib/exec/render.test.ts      NEW
  lib/exec/socket.ts           NEW  ExecSocket + module cache (StrictMode guard)
  lib/exec/ExecContext.tsx     NEW  provider + useExecContext
  lib/yjs/useFile.ts           NEW  subscribe to one file's FileMeta in the files Y.Map
  components/Terminal.tsx      NEW  xterm, ssr:false
  components/RunBar.tsx        NEW  Run button, language picker, stdin field
  components/CodeEditor.tsx    MOD  Ctrl/Cmd+Enter, react to language change
  components/Workspace.tsx     MOD  ExecProvider, RunBar, Terminal

e2e/
  execution.spec.ts            NEW  single-user run, then the two-person acceptance test
.env.example                   MOD  + NEXT_PUBLIC_EXEC_URL, PISTON_URL
README.md                      MOD
```

---

### Task 1: The shared exec model

Everything that crosses the wire lives in `@sandbox/shared`, as it did in Phase 1. This task also adds the one Y.Doc accessor the language picker needs.

**Files:**
- Create: `packages/shared/src/exec.ts`, `packages/shared/src/exec.test.ts`
- Modify: `packages/shared/src/model.ts`, `packages/shared/src/doc.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/model.test.ts`, `packages/shared/src/doc.test.ts`

**Interfaces:**
- Consumes: `LanguageId`, `User`, `LANGUAGES`, `FileMeta` from `./model.js`; `getFilesMap` from `./doc.js`.
- Produces: types `RunRequest`, `RunRecord`, `ExecMessage`, `ExecStream`; constants `MAX_CODE_BYTES`, `MAX_STDIN_BYTES`, `MAX_OUTPUT_BYTES`, `RUN_HISTORY_LIMIT`, `RUN_STORE_MAX_ROOMS`, `RUN_TIMEOUT_MS`, `EXECUTOR_TIMEOUT_MS`, `ROOM_RATE`, `IP_RATE`, `PISTON_RUNTIMES`, `TRUNCATION_NOTICE`; functions `byteLength(s: string): number`, `truncateOutput(s: string, limit?: number): string`, `renameExtension(name: string, extension: string): string`, `setFileLanguage(doc: Y.Doc, fileId: string, language: LanguageId): void`.

- [ ] **Step 1: Write the failing tests for the exec model**

`packages/shared/src/exec.test.ts`:

```ts
import { expect, test } from 'vitest';
import { LANGUAGES, type LanguageId } from './model.js';
import {
  MAX_OUTPUT_BYTES,
  PISTON_RUNTIMES,
  TRUNCATION_NOTICE,
  byteLength,
  truncateOutput,
} from './exec.js';

test('byteLength counts bytes, not UTF-16 code units', () => {
  expect(byteLength('abc')).toBe(3);
  // The size caps are a security boundary; a 4-byte emoji must not count as 2.
  expect(byteLength('😀')).toBe(4);
});

test('truncateOutput leaves output under the limit untouched', () => {
  expect(truncateOutput('hello', 10)).toBe('hello');
});

test('truncateOutput marks what it cut, rather than silently dropping it', () => {
  const truncated = truncateOutput('x'.repeat(20), 10);

  expect(truncated).toBe('x'.repeat(10) + TRUNCATION_NOTICE);
  expect(truncated).toContain('truncated');
});

test('truncateOutput defaults to MAX_OUTPUT_BYTES', () => {
  expect(truncateOutput('x'.repeat(MAX_OUTPUT_BYTES + 1))).toContain(TRUNCATION_NOTICE);
});

test('every language we offer has a pinned Piston runtime', () => {
  for (const id of Object.keys(LANGUAGES) as LanguageId[]) {
    // Piston lists two TypeScript runtimes (Node and Deno). An unpinned version is ambiguous.
    expect(PISTON_RUNTIMES[id].version).toMatch(/^\d+\.\d+\.\d+$/);
  }
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/shared test
```

Expected: FAIL — `Failed to resolve import "./exec.js"`.

- [ ] **Step 3: Write `exec.ts`**

`packages/shared/src/exec.ts`:

```ts
import type { LanguageId, User } from './model.js';

/** Size caps, enforced at the server's zod boundary. */
export const MAX_CODE_BYTES = 64 * 1024;
export const MAX_STDIN_BYTES = 4 * 1024;

/** A runaway print loop must not blow up every client's memory, or the ring buffer. */
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const TRUNCATION_NOTICE = '\n… output truncated\n';

export const RUN_HISTORY_LIMIT = 50;
export const RUN_STORE_MAX_ROOMS = 200;

/** Sent to Piston as `run_timeout`. The PRD's NFR names 5s as the maximum execution time. */
export const RUN_TIMEOUT_MS = 5_000;
/** Outer bound on the whole HTTP call, generous over RUN_TIMEOUT_MS to cover Piston's queue. */
export const EXECUTOR_TIMEOUT_MS = 15_000;

/** Token buckets: `capacity` tokens, one replaced every `refillMs`. */
export const ROOM_RATE = { capacity: 1, refillMs: 2_000 } as const;
export const IP_RATE = { capacity: 20, refillMs: 3_000 } as const;

/**
 * Piston lists two TypeScript runtimes (Node 5.0.3 and Deno 1.32.3) and two JavaScript runtimes,
 * so the version is never left for it to choose. Verified against GET /runtimes on 2026-07-14.
 */
export const PISTON_RUNTIMES: Record<LanguageId, { language: string; version: string }> = {
  python: { language: 'python', version: '3.10.0' },
  javascript: { language: 'javascript', version: '18.15.0' },
  typescript: { language: 'typescript', version: '5.0.3' },
};

const encoder = new TextEncoder();
export const byteLength = (value: string): number => encoder.encode(value).length;

export const truncateOutput = (raw: string, limit: number = MAX_OUTPUT_BYTES): string =>
  raw.length <= limit ? raw : raw.slice(0, limit) + TRUNCATION_NOTICE;

export type ExecStream = 'stdout' | 'stderr';

/** client → server. The only message the client is allowed to send. */
export type RunRequest = {
  type: 'run';
  byUser: User;
  fileName: string;
  language: LanguageId;
  code: string;
  stdin: string;
};

/** Column-for-column with the Phase 4 `runs` table, so PostgresRunStore is a drop-in. */
export type RunRecord = {
  id: string;
  roomId: string;
  byUser: User;
  fileName: string;
  language: LanguageId;
  stdin: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  error?: string;
  createdAt: number;
};

/** server → client. */
export type ExecMessage =
  | { type: 'run:history'; runs: RunRecord[] }
  | {
      type: 'run:started';
      runId: string;
      byUser: User;
      fileName: string;
      language: LanguageId;
      stdin: string;
      at: number;
    }
  | { type: 'run:output'; runId: string; stream: ExecStream; chunk: string }
  | { type: 'run:done'; runId: string; exitCode: number; durationMs: number }
  | { type: 'run:error'; runId: string; message: string };
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/shared test
```

Expected: PASS — 5 new tests, 13 total in the package.

- [ ] **Step 5: Write the failing tests for `renameExtension` and `setFileLanguage`**

Append to `packages/shared/src/model.test.ts`:

```ts
import { renameExtension } from './model.js';

describe('renameExtension', () => {
  test('swaps the extension', () => {
    expect(renameExtension('main.py', '.js')).toBe('main.js');
  });

  test('adds one to a name that has none', () => {
    expect(renameExtension('main', '.py')).toBe('main.py');
  });

  test('leaves a dotfile its leading dot', () => {
    expect(renameExtension('.env', '.py')).toBe('.env.py');
  });
});
```

Append to `packages/shared/src/doc.test.ts`:

```ts
import { getFilesMap, setFileLanguage } from './doc.js';

test('setFileLanguage moves the extension with the language', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  setFileLanguage(doc, DEFAULT_FILE.id, 'javascript');

  const file = getFilesMap(doc).get(DEFAULT_FILE.id);
  // Piston keys off the filename for JS/TS: a file called main.py holding JavaScript will not run.
  expect(file?.name).toBe('main.js');
  expect(file?.language).toBe('javascript');
});

test('setFileLanguage does not touch the file content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const before = getFileText(doc, DEFAULT_FILE.id).toString();

  setFileLanguage(doc, DEFAULT_FILE.id, 'typescript');

  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toBe(before);
});

test('setFileLanguage ignores an unknown file', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(() => setFileLanguage(doc, 'nope', 'javascript')).not.toThrow();
  expect(listFiles(doc)).toHaveLength(1);
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @sandbox/shared test
```

Expected: FAIL — `renameExtension` and `setFileLanguage` are not exported.

- [ ] **Step 7: Write `renameExtension` and `setFileLanguage`**

Append to `packages/shared/src/model.ts`:

```ts
/** `main.py` + `.js` → `main.js`. `dot > 0`, not `>= 0`, so `.env` keeps its leading dot as the stem. */
export const renameExtension = (name: string, extension: string): string => {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${extension}`;
};
```

Append to `packages/shared/src/doc.ts` (and add `LANGUAGES`, `renameExtension`, `type LanguageId` to the existing `./model.js` import):

```ts
/**
 * The language picker's one write. Name and language must not drift apart: Piston keys off the
 * filename's extension for JavaScript and TypeScript, so a `main.py` holding TypeScript will not
 * compile. Phase 4 maintains the same invariant from the other end — there, renaming drives the
 * language; here, the language drives the rename.
 */
export const setFileLanguage = (doc: Y.Doc, fileId: string, language: LanguageId): void => {
  const files = getFilesMap(doc);
  const file = files.get(fileId);
  if (!file || file.language === language) return;

  files.set(fileId, {
    ...file,
    language,
    name: renameExtension(file.name, LANGUAGES[language].extension),
  });
};
```

Add to `packages/shared/src/index.ts`:

```ts
export * from './exec.js';
```

- [ ] **Step 8: Run the tests and the build**

```bash
pnpm --filter @sandbox/shared test
pnpm --filter @sandbox/shared build
```

Expected: PASS — 19 tests in the package. `dist/exec.js` and `dist/exec.d.ts` exist.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): exec wire types, limits, and the language picker's doc accessor" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The token-bucket rate limiter

Pure, with an injected clock, so the tests never sleep. This is the control that protects Piston's public instance — which allows roughly 5 requests/second **across all of its users** — from an abusive client, and protects us from being blocked.

**Files:**
- Create: `apps/ws-server/src/exec/limiter.ts`
- Test: `apps/ws-server/src/exec/limiter.test.ts`

**Interfaces:**
- Consumes: `ROOM_RATE`, `IP_RATE` from `@sandbox/shared` (used by Task 5, not here).
- Produces: `type Rate = { capacity: number; refillMs: number }`; `class TokenBuckets { constructor(rate: Rate, now?: () => number); take(key: string): boolean; reset(): void }`.

- [ ] **Step 1: Write the failing test**

`apps/ws-server/src/exec/limiter.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { TokenBuckets } from './limiter';

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 0;
});

test('the first take succeeds and the next is refused', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);

  expect(buckets.take('room')).toBe(true);
  expect(buckets.take('room')).toBe(false);
});

test('a token comes back after refillMs', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);
  buckets.take('room');

  clock += 1_999;
  expect(buckets.take('room')).toBe(false);

  clock += 1;
  expect(buckets.take('room')).toBe(true);
});

test('tokens accumulate up to capacity and no further', () => {
  const buckets = new TokenBuckets({ capacity: 3, refillMs: 1_000 }, now);

  clock += 60_000; // idle for a minute: it must not bank 60 tokens

  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(false);
});

test('keys are independent — one room cannot exhaust another', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);

  expect(buckets.take('room-a')).toBe(true);
  expect(buckets.take('room-b')).toBe(true);
  expect(buckets.take('room-a')).toBe(false);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test limiter
```

Expected: FAIL — cannot resolve `./limiter`.

- [ ] **Step 3: Write `limiter.ts`**

`apps/ws-server/src/exec/limiter.ts`:

```ts
export type Rate = { capacity: number; refillMs: number };

/**
 * One token bucket per key. The clock is injected so the tests can exhaust and refill a bucket
 * without waiting in real time.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly rate: Rate,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consumes a token if one is available. Returns false if the caller must wait. */
  take(key: string): boolean {
    const at = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.rate.capacity, updatedAt: at };

    const refilled = Math.min(
      this.rate.capacity,
      bucket.tokens + (at - bucket.updatedAt) / this.rate.refillMs,
    );

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, updatedAt: at });
      return false;
    }

    this.buckets.set(key, { tokens: refilled - 1, updatedAt: at });
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test limiter
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/ws-server/src/exec
git commit -m "feat(ws-server): token-bucket rate limiter" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `CodeExecutor` and the Piston adapter

The riskiest integration in the phase, and the one that carries the highest-priority NFR: **user code never executes on our host.** The server shells out to nothing. It makes one HTTPS call to Piston, which runs the code in an isolated, network-less container with hard CPU, memory and wall-clock limits.

**Files:**
- Create: `apps/ws-server/src/exec/executor.ts`, `apps/ws-server/src/exec/piston.ts`
- Modify: `apps/ws-server/src/env.ts`, `apps/ws-server/package.json`, `.env.example`
- Test: `apps/ws-server/src/exec/piston.test.ts`

**Interfaces:**
- Consumes: `PISTON_RUNTIMES`, `RUN_TIMEOUT_MS`, `EXECUTOR_TIMEOUT_MS`, `LanguageId` from `@sandbox/shared`.
- Produces: `type ExecRequest = { language: LanguageId; fileName: string; code: string; stdin: string }`; `type ExecResult = { stdout: string; stderr: string; exitCode: number; durationMs: number }`; `interface CodeExecutor { run(req: ExecRequest): Promise<ExecResult> }`; `class ExecutorError extends Error`; `class StubExecutor implements CodeExecutor`; `class PistonExecutor implements CodeExecutor`; `env.pistonUrl`.

- [ ] **Step 1: Add zod and set the Piston URL**

`apps/ws-server/package.json` — add to `dependencies`:

```json
"zod": "^4.4.3"
```

(zod is used in Task 5; adding it now means one `pnpm install` for the whole server.)

`apps/ws-server/src/env.ts` — replace the file:

```ts
export const env = {
  port: Number(process.env.PORT ?? 1234),
  host: process.env.HOST ?? '0.0.0.0',
  /** The public instance. Also the seam for self-hosting Piston later. */
  pistonUrl: process.env.PISTON_URL ?? 'https://emkc.org/api/v2/piston',
};
```

`.env.example` — replace the file:

```bash
# apps/web (inlined at build time)
NEXT_PUBLIC_SYNC_URL=ws://localhost:1234/sync
NEXT_PUBLIC_EXEC_URL=ws://localhost:1234/exec

# apps/ws-server
PORT=1234
HOST=0.0.0.0
PISTON_URL=https://emkc.org/api/v2/piston
```

Then:

```bash
pnpm install
```

- [ ] **Step 2: Write `executor.ts`**

There is no test for this file: it is an interface, an error type, and a stub whose only consumer is the test suite. It is exercised by Task 5's integration test.

`apps/ws-server/src/exec/executor.ts`:

```ts
import type { LanguageId } from '@sandbox/shared';

export type ExecRequest = {
  language: LanguageId;
  fileName: string;
  code: string;
  stdin: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

/**
 * The seam. PistonExecutor implements it today; a self-hosted DockerExecutor with a pty is the
 * later, optional adapter — and it must not require touching anything above this interface.
 */
export interface CodeExecutor {
  run(request: ExecRequest): Promise<ExecResult>;
}

/** An executor failure the room is allowed to hear about, phrased for a human. */
export class ExecutorError extends Error {}

/** Injected by the tests. It never touches the network. */
export class StubExecutor implements CodeExecutor {
  public calls: ExecRequest[] = [];

  constructor(private readonly outcome: ExecResult | ExecutorError) {}

  async run(request: ExecRequest): Promise<ExecResult> {
    this.calls.push(request);
    if (this.outcome instanceof ExecutorError) throw this.outcome;
    return this.outcome;
  }
}
```

- [ ] **Step 3: Write the failing tests for the Piston adapter**

`apps/ws-server/src/exec/piston.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { ExecutorError } from './executor';
import { PistonExecutor } from './piston';

const BASE = 'https://piston.test/api/v2/piston';

const respondWith = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );

const stage = (over: Partial<{ stdout: string; stderr: string; code: number | null; signal: string | null }> = {}) => ({
  stdout: '',
  stderr: '',
  code: 0,
  signal: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a successful run returns stdout and the exit code', async () => {
  const fetchMock = respondWith({ run: stage({ stdout: 'FizzBuzz\n', code: 0 }) });
  vi.stubGlobal('fetch', fetchMock);

  const result = await new PistonExecutor(BASE).run({
    language: 'python',
    fileName: 'main.py',
    code: 'print("FizzBuzz")',
    stdin: '',
  });

  expect(result.stdout).toBe('FizzBuzz\n');
  expect(result.exitCode).toBe(0);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('the request pins the runtime version — `typescript` alone is ambiguous on Piston', async () => {
  const fetchMock = respondWith({ run: stage() });
  vi.stubGlobal('fetch', fetchMock);

  await new PistonExecutor(BASE).run({
    language: 'typescript',
    fileName: 'main.ts',
    code: 'console.log(1)',
    stdin: '',
  });

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(`${BASE}/execute`);

  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.language).toBe('typescript');
  expect(body.version).toBe('5.0.3'); // the Node runtime, not Deno's 1.32.3
  expect(body.files).toEqual([{ name: 'main.ts', content: 'console.log(1)' }]);
});

test('a compile failure surfaces the compiler error, not an empty success', async () => {
  vi.stubGlobal(
    'fetch',
    respondWith({
      compile: stage({ stderr: "main.ts(1,1): error TS2304: Cannot find name 'nope'.", code: 2 }),
      run: stage(),
    }),
  );

  const result = await new PistonExecutor(BASE).run({
    language: 'typescript',
    fileName: 'main.ts',
    code: 'nope()',
    stdin: '',
  });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('TS2304');
});

test('a process killed by the sandbox is an error, never a silent exit 0', async () => {
  vi.stubGlobal('fetch', respondWith({ run: stage({ code: null, signal: 'SIGKILL' }) }));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: 'while True: pass', stdin: '' }),
  ).rejects.toThrow(/SIGKILL|limit/i);
});

test('a 429 says so, so the terminal can explain itself', async () => {
  vi.stubGlobal('fetch', respondWith({}, 429));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/rate limit/i);
});

test('a 500 is reported as unavailable', async () => {
  vi.stubGlobal('fetch', respondWith({}, 500));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toBeInstanceOf(ExecutorError);
});

test('a body we cannot read is an error, not a crash', async () => {
  vi.stubGlobal('fetch', respondWith('<html>gateway</html>'));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/could not read/i);
});

test('a hung executor times out rather than hanging the room', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
  );

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/did not respond/i);
});

test('a network failure is reported, never swallowed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/unreachable/i);
});
```

- [ ] **Step 4: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test piston
```

Expected: FAIL — cannot resolve `./piston`.

- [ ] **Step 5: Write `piston.ts`**

`apps/ws-server/src/exec/piston.ts`:

```ts
import { EXECUTOR_TIMEOUT_MS, PISTON_RUNTIMES, RUN_TIMEOUT_MS } from '@sandbox/shared';
import { type CodeExecutor, type ExecRequest, type ExecResult, ExecutorError } from './executor';

type PistonStage = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
};

type PistonResponse = { run: PistonStage; compile?: PistonStage };

/**
 * The public Piston API. User code is a string we forward over HTTPS — never something we evaluate,
 * interpolate into a shell, or write to disk. Piston runs it in an isolated, network-less container.
 */
export class PistonExecutor implements CodeExecutor {
  constructor(private readonly baseUrl: string) {}

  async run({ language, fileName, code, stdin }: ExecRequest): Promise<ExecResult> {
    const runtime = PISTON_RUNTIMES[language];
    const startedAt = Date.now();

    const response = await this.post({
      language: runtime.language,
      version: runtime.version,
      files: [{ name: fileName, content: code }],
      stdin,
      run_timeout: RUN_TIMEOUT_MS,
    });

    const durationMs = Date.now() - startedAt;

    // TypeScript compiles first; a compile failure never reaches the run stage, and its stderr is
    // the only thing the user needs to see.
    if (response.compile && response.compile.code !== 0) {
      return {
        stdout: '',
        stderr: response.compile.stderr || 'Compilation failed.',
        exitCode: response.compile.code ?? 1,
        durationMs,
      };
    }

    const { stdout, stderr, code: exitCode, signal } = response.run;

    // Killed by Piston's own limits: `code` is null and a signal is set. Reporting this as exit 0
    // would be a lie — the program did not finish.
    if (exitCode === null) {
      throw new ExecutorError(
        `The sandbox killed the program (${signal ?? 'no exit code'}) — it likely exceeded the ${RUN_TIMEOUT_MS / 1000}s limit.`,
      );
    }

    return { stdout, stderr, exitCode, durationMs };
  }

  private async post(body: unknown): Promise<PistonResponse> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EXECUTOR_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ExecutorError(
          `The executor did not respond within ${EXECUTOR_TIMEOUT_MS / 1000}s.`,
        );
      }
      throw new ExecutorError('The executor is unreachable.');
    }

    if (response.status === 429) {
      throw new ExecutorError('Piston is rate limiting us. Give it a moment and try again.');
    }
    if (!response.ok) {
      throw new ExecutorError(`The executor is unavailable (HTTP ${response.status}).`);
    }

    const parsed = (await response.json().catch(() => null)) as PistonResponse | null;
    if (!parsed?.run) {
      throw new ExecutorError('The executor returned a response we could not read.');
    }
    return parsed;
  }
}
```

- [ ] **Step 6: Run and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test piston
pnpm --filter @sandbox/ws-server typecheck
```

Expected: PASS — 9 tests, no type errors.

- [ ] **Step 7: Prove it against the real Piston, once, by hand**

The mocked tests prove our *handling*. They cannot prove the request shape is one Piston accepts. Verify that separately, and never in the automated suite — a test that depends on a third-party network service is a test that fails at 3am for reasons that are not our fault.

```bash
curl -s https://emkc.org/api/v2/piston/execute \
  -H 'content-type: application/json' \
  -d '{"language":"python","version":"3.10.0","files":[{"name":"main.py","content":"print(6*7)"}],"stdin":"","run_timeout":5000}'
```

Expected: JSON containing `"stdout":"42\n"` and `"code":0`.

- [ ] **Step 8: Commit**

```bash
git add apps/ws-server .env.example
git commit -m "feat(ws-server): CodeExecutor interface and the Piston adapter" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: The run store and the exec room registry

Two small, separate things, because they are two separate concerns with two different lifetimes. `ExecRoom` holds connections and dies when the last one leaves. `RunStore` holds history and outlives it.

**Files:**
- Create: `apps/ws-server/src/exec/runs.ts`, `apps/ws-server/src/exec/rooms.ts`
- Test: `apps/ws-server/src/exec/runs.test.ts`

**Interfaces:**
- Consumes: `RUN_HISTORY_LIMIT`, `RUN_STORE_MAX_ROOMS`, `RunRecord` from `@sandbox/shared`.
- Produces: `interface RunStore { append(record: RunRecord): void; update(roomId: string, id: string, patch: Partial<RunRecord>): void; list(roomId: string): RunRecord[] }`; `class MemoryRunStore implements RunStore`; `class ExecRoom { id; size; add(conn); remove(conn); broadcast(message: string) }`; `send(conn: WebSocket, message: string): void`; `getOrCreateExecRoom(id: string): ExecRoom`; `releaseExecRoom(room: ExecRoom): void`; `execRoomCount(): number`; `resetExecRooms(): void`.

- [ ] **Step 1: Write the failing tests for the store**

`apps/ws-server/src/exec/runs.test.ts`:

```ts
import { expect, test } from 'vitest';
import { RUN_HISTORY_LIMIT, RUN_STORE_MAX_ROOMS, type RunRecord } from '@sandbox/shared';
import { MemoryRunStore } from './runs';

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room-a',
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  stdout: '',
  stderr: '',
  exitCode: null,
  durationMs: null,
  createdAt: 0,
  ...over,
});

test('a run round-trips through the store', () => {
  const store = new MemoryRunStore();
  store.append(record());

  expect(store.list('room-a')).toEqual([record()]);
});

test('rooms are isolated from each other', () => {
  const store = new MemoryRunStore();
  store.append(record({ id: 'r1', roomId: 'room-a' }));
  store.append(record({ id: 'r2', roomId: 'room-b' }));

  expect(store.list('room-a').map((run) => run.id)).toEqual(['r1']);
  expect(store.list('room-b').map((run) => run.id)).toEqual(['r2']);
});

test('an unknown room has no runs, rather than throwing', () => {
  expect(new MemoryRunStore().list('never-seen')).toEqual([]);
});

test('update patches a run in place', () => {
  const store = new MemoryRunStore();
  store.append(record({ id: 'r1' }));

  store.update('room-a', 'r1', { stdout: '42\n', exitCode: 0, durationMs: 120 });

  expect(store.list('room-a')[0]).toMatchObject({ stdout: '42\n', exitCode: 0, durationMs: 120 });
});

test('update ignores a run it does not have', () => {
  const store = new MemoryRunStore();

  expect(() => store.update('room-a', 'ghost', { exitCode: 0 })).not.toThrow();
});

test('the oldest runs fall out of the ring buffer', () => {
  const store = new MemoryRunStore();
  for (let i = 0; i < RUN_HISTORY_LIMIT + 5; i++) {
    store.append(record({ id: `r${i}`, createdAt: i }));
  }

  const runs = store.list('room-a');
  expect(runs).toHaveLength(RUN_HISTORY_LIMIT);
  expect(runs[0]?.id).toBe('r5'); // r0–r4 were evicted
});

test('the least recently used room falls out, so the store cannot grow forever', () => {
  const store = new MemoryRunStore();
  for (let i = 0; i < RUN_STORE_MAX_ROOMS + 1; i++) {
    store.append(record({ id: `r${i}`, roomId: `room-${i}` }));
  }

  expect(store.list('room-0')).toEqual([]); // evicted
  expect(store.list(`room-${RUN_STORE_MAX_ROOMS}`)).toHaveLength(1);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test runs
```

Expected: FAIL — cannot resolve `./runs`.

- [ ] **Step 3: Write `runs.ts`**

`apps/ws-server/src/exec/runs.ts`:

```ts
import { RUN_HISTORY_LIMIT, RUN_STORE_MAX_ROOMS, type RunRecord } from '@sandbox/shared';

/**
 * Run history is server-authored, not collaborative state — it does not belong in the Y.Doc.
 * Phase 4 drops a PostgresRunStore in behind this interface and nothing above it changes:
 * RunRecord is column-for-column with the `runs` table in the master spec §4.4.
 */
export interface RunStore {
  append(record: RunRecord): void;
  update(roomId: string, id: string, patch: Partial<RunRecord>): void;
  list(roomId: string): RunRecord[];
}

export class MemoryRunStore implements RunStore {
  /** Insertion-ordered, so the first key is always the least recently used room. */
  private readonly rooms = new Map<string, RunRecord[]>();

  append(record: RunRecord): void {
    const runs = this.rooms.get(record.roomId) ?? [];
    runs.push(record);
    if (runs.length > RUN_HISTORY_LIMIT) runs.splice(0, runs.length - RUN_HISTORY_LIMIT);

    // Delete and re-set to move this room to the back of the insertion order.
    this.rooms.delete(record.roomId);
    this.rooms.set(record.roomId, runs);

    while (this.rooms.size > RUN_STORE_MAX_ROOMS) {
      const leastRecent = this.rooms.keys().next().value;
      if (leastRecent === undefined) break;
      this.rooms.delete(leastRecent);
    }
  }

  update(roomId: string, id: string, patch: Partial<RunRecord>): void {
    const runs = this.rooms.get(roomId);
    if (!runs) return;

    const index = runs.findIndex((run) => run.id === id);
    if (index === -1) return;

    runs[index] = { ...runs[index]!, ...patch };
  }

  list(roomId: string): RunRecord[] {
    return [...(this.rooms.get(roomId) ?? [])];
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test runs
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Write `rooms.ts`**

No test of its own: it is a connection set, and Task 5's integration test drives every line of it through real sockets.

`apps/ws-server/src/exec/rooms.ts`:

```ts
import { WebSocket } from 'ws';

export const send = (conn: WebSocket, message: string): void => {
  if (conn.readyState !== WebSocket.OPEN) return;
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
};

/**
 * The exec channel's connections for one room — and nothing else. Run history lives in the
 * RunStore, which is why this needs no grace period: there is nothing here worth preserving
 * across a refresh. (The sync Room needs its 30s grace because it holds the Y.Doc itself.)
 */
export class ExecRoom {
  private readonly connections = new Set<WebSocket>();

  constructor(readonly id: string) {}

  get size(): number {
    return this.connections.size;
  }

  add(conn: WebSocket): void {
    this.connections.add(conn);
  }

  remove(conn: WebSocket): void {
    this.connections.delete(conn);
  }

  broadcast(message: string): void {
    for (const conn of this.connections) send(conn, message);
  }
}

const execRooms = new Map<string, ExecRoom>();

export const getOrCreateExecRoom = (id: string): ExecRoom => {
  let room = execRooms.get(id);
  if (!room) {
    room = new ExecRoom(id);
    execRooms.set(id, room);
  }
  return room;
};

export const releaseExecRoom = (room: ExecRoom): void => {
  if (room.size === 0) execRooms.delete(room.id);
};

export const execRoomCount = (): number => execRooms.size;

export const resetExecRooms = (): void => execRooms.clear();
```

- [ ] **Step 6: Commit**

```bash
git add apps/ws-server/src/exec
git commit -m "feat(ws-server): run store and the exec room registry" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: The exec channel — boundary, authority, route

This is the phase's spine: the zod boundary, the execution authority that turns one `run` into a broadcast the whole room hears, and the route that hangs it off the existing server.

**Files:**
- Create: `apps/ws-server/src/exec/protocol.ts`, `apps/ws-server/src/exec/connection.ts`
- Modify: `apps/ws-server/src/server.ts`
- Test: `apps/ws-server/src/exec/protocol.test.ts`, `apps/ws-server/test/exec.test.ts`

**Interfaces:**
- Consumes: `TokenBuckets` (Task 2); `CodeExecutor`, `ExecutorError`, `StubExecutor` (Task 3); `RunStore`, `MemoryRunStore`, `ExecRoom`, `getOrCreateExecRoom`, `releaseExecRoom`, `send` (Task 4); `ExecMessage`, `RunRecord`, `truncateOutput`, `byteLength`, `sanitizeName`, `LANGUAGES`, `MAX_CODE_BYTES`, `MAX_STDIN_BYTES`, `MAX_NAME_LENGTH`, `ROOM_RATE`, `IP_RATE`, `isValidRoomId` from `@sandbox/shared`.
- Produces: `runRequestSchema`; `type ParsedRunRequest`; `parseRunRequest(raw: string): ParsedRunRequest`; `encode(message: ExecMessage): string`; `type ExecDeps`; `setupExecConnection(conn, room, ip, deps): void`; `createSandboxServer(options?: SandboxServerOptions): Server`.

- [ ] **Step 1: Write the failing tests for the boundary**

`apps/ws-server/src/exec/protocol.test.ts`:

```ts
import { expect, test } from 'vitest';
import { MAX_CODE_BYTES, MAX_STDIN_BYTES } from '@sandbox/shared';
import { parseRunRequest } from './protocol';

const valid = {
  type: 'run',
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python',
  code: 'print(1)',
  stdin: '',
};

const parse = (over: Record<string, unknown> = {}) =>
  parseRunRequest(JSON.stringify({ ...valid, ...over }));

test('a well-formed run request parses', () => {
  expect(parse()).toMatchObject({ type: 'run', language: 'python', code: 'print(1)' });
});

test('a hostile display name is sanitized, not trusted', () => {
  // Names reach other clients. They are never rendered into CSS from here, but the boundary is
  // the only place that can vouch for a name at all — the server is the one thing every client trusts.
  const parsed = parse({ byUser: { id: 'u1', name: "Bob'; } body { display: none } /*", color: '#f97316' } });

  expect(parsed.byUser.name).not.toMatch(/['{}();*/\\]/);
});

test('a colour that is not a hex colour is refused', () => {
  expect(() => parse({ byUser: { id: 'u1', name: 'Ada', color: 'red; } body {}' } })).toThrow();
});

test('an unknown language is refused before we ever call Piston', () => {
  expect(() => parse({ language: 'brainfuck' })).toThrow();
});

test('oversized code is refused', () => {
  expect(() => parse({ code: 'x'.repeat(MAX_CODE_BYTES + 1) })).toThrow(/code/i);
});

test('oversized stdin is refused', () => {
  expect(() => parse({ stdin: 'x'.repeat(MAX_STDIN_BYTES + 1) })).toThrow(/stdin/i);
});

test('a missing field is refused rather than defaulted', () => {
  expect(() => parseRunRequest(JSON.stringify({ type: 'run' }))).toThrow();
});

test('a message that is not JSON is refused rather than coerced', () => {
  expect(() => parseRunRequest('not json')).toThrow();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test protocol
```

Expected: FAIL — cannot resolve `./protocol` (the `sync/protocol.test.ts` suite still passes).

- [ ] **Step 3: Write `protocol.ts`**

`apps/ws-server/src/exec/protocol.ts`:

```ts
import { z } from 'zod';
import {
  type ExecMessage,
  LANGUAGES,
  type LanguageId,
  MAX_CODE_BYTES,
  MAX_NAME_LENGTH,
  MAX_STDIN_BYTES,
  byteLength,
  sanitizeName,
} from '@sandbox/shared';

const LANGUAGE_IDS = Object.keys(LANGUAGES) as [LanguageId, ...LanguageId[]];

const withinBytes = (limit: number) => (value: string) => byteLength(value) <= limit;

const userSchema = z.object({
  id: z.string().min(1).max(64),
  name: z
    .string()
    .max(200)
    .transform(sanitizeName)
    .refine((name) => name.length > 0 && name.length <= MAX_NAME_LENGTH, 'name is empty'),
  // A colour reaches every other client. Only a hex colour, ever.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const runRequestSchema = z.object({
  type: z.literal('run'),
  byUser: userSchema,
  fileName: z.string().min(1).max(128),
  language: z.enum(LANGUAGE_IDS),
  code: z.string().refine(withinBytes(MAX_CODE_BYTES), `code exceeds ${MAX_CODE_BYTES} bytes`),
  stdin: z.string().refine(withinBytes(MAX_STDIN_BYTES), `stdin exceeds ${MAX_STDIN_BYTES} bytes`),
});

export type ParsedRunRequest = z.infer<typeof runRequestSchema>;

/** Throws on anything malformed. The caller closes the socket; it never coerces. */
export const parseRunRequest = (raw: string): ParsedRunRequest =>
  runRequestSchema.parse(JSON.parse(raw));

export const encode = (message: ExecMessage): string => JSON.stringify(message);
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test protocol
```

Expected: PASS — 8 new tests (plus the 5 existing `sync/protocol.test.ts` tests).

- [ ] **Step 5: Write the failing integration test**

This is the phase's real proof on the server side: **both** clients see the run.

`apps/ws-server/test/exec.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import type { ExecMessage } from '@sandbox/shared';
import { ExecutorError, StubExecutor } from '../src/exec/executor';
import { resetExecRooms } from '../src/exec/rooms';
import { MemoryRunStore } from '../src/exec/runs';
import { createSandboxServer } from '../src/server';

let server: ReturnType<typeof createSandboxServer>;
let execUrl: string;
let clock: number;
const sockets: WebSocket[] = [];

const OK = { stdout: '42\n', stderr: '', exitCode: 0, durationMs: 12 };

const RUN = {
  type: 'run' as const,
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python' as const,
  code: 'print(6*7)',
  stdin: '',
};

const boot = async (executor = new StubExecutor(OK)) => {
  clock = 0;
  server = createSandboxServer({ executor, store: new MemoryRunStore(), now: () => clock });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  execUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/exec`;
  return executor;
};

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  resetExecRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Connect, and collect every message the server sends us. */
const connect = async (roomId: string) => {
  const socket = new WebSocket(`${execUrl}/${roomId}`);
  sockets.push(socket);

  const received: ExecMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ExecMessage));

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  return { socket, received };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const typesOf = (messages: ExecMessage[]) => messages.map((message) => message.type);

beforeEach(async () => {
  await boot();
});

test('a fresh room is sent an empty history, so the terminal knows it has loaded', async () => {
  const ada = await connect('room-exec-a');
  await waitFor(() => ada.received.length > 0);

  expect(ada.received[0]).toEqual({ type: 'run:history', runs: [] });
});

test('one person runs, and BOTH people see the output', async () => {
  const ada = await connect('room-exec-b');
  const bob = await connect('room-exec-b');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));

  // This is the phase. Bob did not press anything, and Bob sees the output.
  await waitFor(() => typesOf(bob.received).includes('run:done'));

  expect(typesOf(ada.received)).toEqual([
    'run:history',
    'run:started',
    'run:output',
    'run:done',
  ]);
  expect(typesOf(bob.received)).toEqual([
    'run:history',
    'run:started',
    'run:output',
    'run:done',
  ]);

  const output = bob.received.find((message) => message.type === 'run:output');
  expect(output).toMatchObject({ stream: 'stdout', chunk: '42\n' });
});

test('the executor is given the code the client sent — the server never reads the CRDT', async () => {
  const executor = new StubExecutor(OK);
  await server.close();
  await boot(executor);

  const ada = await connect('room-exec-c');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  expect(executor.calls[0]).toEqual({
    language: 'python',
    fileName: 'main.py',
    code: 'print(6*7)',
    stdin: '',
  });
});

test('someone who joins late is replayed the runs they missed', async () => {
  const ada = await connect('room-exec-d');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  const carol = await connect('room-exec-d');
  await waitFor(() => carol.received.length > 0);

  const history = carol.received[0];
  expect(history?.type).toBe('run:history');
  expect(history).toMatchObject({
    runs: [{ fileName: 'main.py', stdout: '42\n', exitCode: 0 }],
  });
});

test('a second run inside the window is refused — and only the person refused hears about it', async () => {
  const ada = await connect('room-exec-e');
  const bob = await connect('room-exec-e');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  const bobBefore = bob.received.length;
  ada.socket.send(JSON.stringify(RUN)); // the clock has not moved: no token

  await waitFor(() => typesOf(ada.received).includes('run:error'));

  // Bob never heard of a run that never started. His terminal is not littered with it.
  expect(bob.received.length).toBe(bobBefore);
});

test('the token comes back once the clock moves on', async () => {
  const ada = await connect('room-exec-f');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  clock += 2_000;
  ada.socket.send(JSON.stringify(RUN));

  await waitFor(() => typesOf(ada.received).filter((type) => type === 'run:done').length === 2);
  expect(typesOf(ada.received)).not.toContain('run:error');
});

test('an executor failure is broadcast — nobody is left watching a run that never ends', async () => {
  await server.close();
  await boot(new StubExecutor(new ExecutorError('Piston is rate limiting us.')));

  const ada = await connect('room-exec-g');
  const bob = await connect('room-exec-g');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));

  // Bob was told the run started, so Bob must be told it failed.
  await waitFor(() => typesOf(bob.received).includes('run:error'));
  expect(bob.received.at(-1)).toMatchObject({ message: 'Piston is rate limiting us.' });
});

test('a malformed message closes the socket rather than being coerced', async () => {
  const ada = await connect('room-exec-h');
  await waitFor(() => ada.received.length > 0);

  const closed = new Promise<number>((resolve) => ada.socket.once('close', resolve));
  ada.socket.send('{"type":"run","code":42}');

  expect(await closed).toBe(1003);
});

test('an invalid room id never allocates a room', async () => {
  const socket = new WebSocket(`${execUrl}/no`);
  sockets.push(socket);

  await expect(
    new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
  ).rejects.toThrow();
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test exec
```

Expected: FAIL — `createSandboxServer` takes no options, and there is no `/exec` route.

- [ ] **Step 7: Write `connection.ts`**

`apps/ws-server/src/exec/connection.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { RawData, WebSocket } from 'ws';
import { type RunRecord, truncateOutput } from '@sandbox/shared';
import { type CodeExecutor, ExecutorError } from './executor';
import type { TokenBuckets } from './limiter';
import { type ParsedRunRequest, encode, parseRunRequest } from './protocol';
import { type ExecRoom, releaseExecRoom, send } from './rooms';
import type { RunStore } from './runs';

export type ExecDeps = {
  executor: CodeExecutor;
  store: RunStore;
  roomLimiter: TokenBuckets;
  ipLimiter: TokenBuckets;
  now: () => number;
};

export const setupExecConnection = (
  conn: WebSocket,
  room: ExecRoom,
  ip: string,
  deps: ExecDeps,
): void => {
  room.add(conn);

  // Always sent, even when empty: the terminal must be able to tell "nothing has run here" from
  // "still loading".
  send(conn, encode({ type: 'run:history', runs: deps.store.list(room.id) }));

  conn.on('message', (data: RawData) => {
    let request: ParsedRunRequest;
    try {
      request = parseRunRequest(data.toString());
    } catch (error) {
      console.error(`[exec] bad message in room ${room.id}:`, error);
      conn.close(1003, 'protocol error');
      return;
    }

    void execute(conn, room, ip, request, deps);
  });

  const teardown = (): void => {
    room.remove(conn);
    releaseExecRoom(room);
  };
  conn.on('close', teardown);
  conn.on('error', teardown);
};

const execute = async (
  conn: WebSocket,
  room: ExecRoom,
  ip: string,
  request: ParsedRunRequest,
  deps: ExecDeps,
): Promise<void> => {
  const runId = randomUUID();

  // A rate-limit rejection goes to the requester alone. No run:started was broadcast, so nobody
  // else knows a run was even attempted — telling them would litter their terminals with news of
  // something that never happened, and fill the ring buffer with non-runs.
  if (!deps.roomLimiter.take(room.id)) {
    send(
      conn,
      encode({
        type: 'run:error',
        runId,
        message: 'One run every 2 seconds per room. Give it a beat.',
      }),
    );
    return;
  }
  if (!deps.ipLimiter.take(ip)) {
    send(
      conn,
      encode({
        type: 'run:error',
        runId,
        message: 'Too many runs from this connection. Try again in a minute.',
      }),
    );
    return;
  }

  const record: RunRecord = {
    id: runId,
    roomId: room.id,
    byUser: request.byUser,
    fileName: request.fileName,
    language: request.language,
    stdin: request.stdin,
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: null,
    createdAt: deps.now(),
  };
  deps.store.append(record);

  room.broadcast(
    encode({
      type: 'run:started',
      runId,
      byUser: record.byUser,
      fileName: record.fileName,
      language: record.language,
      stdin: record.stdin,
      at: record.createdAt,
    }),
  );

  try {
    const result = await deps.executor.run({
      language: request.language,
      fileName: request.fileName,
      code: request.code,
      stdin: request.stdin,
    });

    const stdout = truncateOutput(result.stdout);
    const stderr = truncateOutput(result.stderr);

    deps.store.update(room.id, runId, {
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    // Piston is request/response: exactly one chunk per non-empty stream, never more. The message
    // is chunked so a streaming executor can replace this one without changing the wire format.
    if (stdout) room.broadcast(encode({ type: 'run:output', runId, stream: 'stdout', chunk: stdout }));
    if (stderr) room.broadcast(encode({ type: 'run:output', runId, stream: 'stderr', chunk: stderr }));

    room.broadcast(
      encode({ type: 'run:done', runId, exitCode: result.exitCode, durationMs: result.durationMs }),
    );
  } catch (error) {
    // The room has already been told this run started, so the room must be told it failed —
    // otherwise every terminal is left showing a run that never completes.
    const message =
      error instanceof ExecutorError ? error.message : 'The executor failed unexpectedly.';

    deps.store.update(room.id, runId, { error: message });
    room.broadcast(encode({ type: 'run:error', runId, message }));
  }
};
```

- [ ] **Step 8: Wire the route into `server.ts`**

`apps/ws-server/src/server.ts` — replace the file:

```ts
import { type Server, createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { IP_RATE, ROOM_RATE, isValidRoomId } from '@sandbox/shared';
import { env } from './env';
import { type ExecDeps, setupExecConnection } from './exec/connection';
import type { CodeExecutor } from './exec/executor';
import { TokenBuckets } from './exec/limiter';
import { PistonExecutor } from './exec/piston';
import { getOrCreateExecRoom } from './exec/rooms';
import { MemoryRunStore, type RunStore } from './exec/runs';
import { setupSyncConnection } from './sync/connection';
import { getOrCreateRoom, roomCount } from './sync/rooms';

/** The injection seam the integration tests need: a stub executor, a fake clock, a fresh store. */
export type SandboxServerOptions = {
  executor?: CodeExecutor;
  store?: RunStore;
  now?: () => number;
};

export const createSandboxServer = (options: SandboxServerOptions = {}): Server => {
  const now = options.now ?? Date.now;

  const deps: ExecDeps = {
    executor: options.executor ?? new PistonExecutor(env.pistonUrl),
    store: options.store ?? new MemoryRunStore(),
    roomLimiter: new TokenBuckets(ROOM_RATE, now),
    ipLimiter: new TokenBuckets(IP_RATE, now),
    now,
  };

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [prefix, roomId] = url.pathname.split('/').filter(Boolean);

    // An unvalidated room id lets anyone allocate unbounded server rooms.
    if ((prefix !== 'sync' && prefix !== 'exec') || !isValidRoomId(roomId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const ip = req.socket.remoteAddress ?? 'unknown';

    wss.handleUpgrade(req, socket, head, (conn) => {
      if (prefix === 'sync') setupSyncConnection(conn, getOrCreateRoom(roomId));
      else setupExecConnection(conn, getOrCreateExecRoom(roomId), ip, deps);
    });
  });

  return http;
};
```

- [ ] **Step 9: Run the whole server suite and watch it pass**

```bash
pnpm --filter @sandbox/ws-server test
pnpm --filter @sandbox/ws-server typecheck
```

Expected: PASS — 9 exec integration + 8 exec protocol + 7 runs + 9 piston + 4 limiter + the 9 Phase 1 sync tests = **46 tests**. No type errors. The Phase 1 sync tests must still be green: Phase 2 does not touch the relay.

- [ ] **Step 10: Commit**

```bash
git add apps/ws-server
git commit -m "feat(ws-server): the /exec channel — zod boundary, execution authority, route" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: The web exec client

Two pure functions and a socket. The pure functions are where the interesting bugs would otherwise live, so they are unit-tested without a browser.

**Files:**
- Create: `apps/web/lib/exec/state.ts`, `apps/web/lib/exec/render.ts`, `apps/web/lib/exec/socket.ts`, `apps/web/lib/exec/ExecContext.tsx`, `apps/web/lib/yjs/useFile.ts`
- Modify: `apps/web/lib/env.ts`
- Test: `apps/web/lib/exec/state.test.ts`, `apps/web/lib/exec/render.test.ts`

**Interfaces:**
- Consumes: `ExecMessage`, `RunRecord`, `RunRequest`, `LanguageId`, `User`, `RUN_HISTORY_LIMIT`, `DEFAULT_FILE`, `getFileText`, `getFilesMap`, `FileMeta` from `@sandbox/shared`; `useRoomContext` from `@/lib/yjs/RoomContext`.
- Produces: `type ExecState = { runs: RunRecord[]; notice: string | null }`; `EMPTY_EXEC_STATE`; `applyExecMessage(state, message): ExecState`; `renderRuns(runs, notice): string`; `type ExecStatus = 'connecting' | 'connected' | 'disconnected'`; `acquireExec(roomId): ExecSocket`; `releaseExec(roomId): void`; `<ExecProvider user>`, `useExecContext(): { runs; notice; status; isRunning; stdin; setStdin; runActiveFile() }`; `useFile(fileId): FileMeta | undefined`; `EXEC_URL`.

- [ ] **Step 1: Write the failing tests for the state reducer**

`apps/web/lib/exec/state.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { ExecMessage, RunRecord } from '@sandbox/shared';
import { EMPTY_EXEC_STATE, applyExecMessage } from './state';

const ADA = { id: 'u1', name: 'Ada', color: '#f97316' };

const started = (runId: string, at = 0): ExecMessage => ({
  type: 'run:started',
  runId,
  byUser: ADA,
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  at,
});

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room',
  byUser: ADA,
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  stdout: '42\n',
  stderr: '',
  exitCode: 0,
  durationMs: 12,
  createdAt: 0,
  ...over,
});

const reduce = (messages: ExecMessage[]) =>
  messages.reduce(applyExecMessage, EMPTY_EXEC_STATE);

test('a run accumulates from started, through output, to done', () => {
  const state = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: '42\n' },
    { type: 'run:done', runId: 'r1', exitCode: 0, durationMs: 12 },
  ]);

  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0, durationMs: 12 });
});

test('stdout and stderr accumulate independently', () => {
  const state = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: 'out' },
    { type: 'run:output', runId: 'r1', stream: 'stderr', chunk: 'err' },
  ]);

  expect(state.runs[0]).toMatchObject({ stdout: 'out', stderr: 'err' });
});

test('history replayed after a reconnect does not duplicate the scrollback', () => {
  // The server re-sends run:history on every connect. An append-only list would render twice.
  const live = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: '42\n' },
    { type: 'run:done', runId: 'r1', exitCode: 0, durationMs: 12 },
  ]);

  const reconnected = applyExecMessage(live, { type: 'run:history', runs: [record({ id: 'r1' })] });

  expect(reconnected.runs).toHaveLength(1);
  expect(reconnected.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0 });
});

test('a run we half-saw before dropping is completed by the replayed history', () => {
  // We saw the header, then the socket died mid-run. The server's copy is the authoritative one.
  const partial = reduce([started('r1')]);

  const reconnected = applyExecMessage(partial, {
    type: 'run:history',
    runs: [record({ id: 'r1', stdout: '42\n', exitCode: 0 })],
  });

  expect(reconnected.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0 });
});

test('an error on a known run attaches to that run', () => {
  const state = reduce([started('r1'), { type: 'run:error', runId: 'r1', message: 'Piston is down.' }]);

  expect(state.runs[0]?.error).toBe('Piston is down.');
  expect(state.notice).toBeNull();
});

test('an error on a run we never saw start is a notice, not a phantom run', () => {
  // A rate-limit rejection: no run:started was ever broadcast, because no run ever started.
  const state = reduce([{ type: 'run:error', runId: 'ghost', message: 'One run every 2 seconds.' }]);

  expect(state.runs).toEqual([]);
  expect(state.notice).toBe('One run every 2 seconds.');
});

test('starting a run clears the last notice', () => {
  const state = reduce([
    { type: 'run:error', runId: 'ghost', message: 'One run every 2 seconds.' },
    started('r1'),
  ]);

  expect(state.notice).toBeNull();
});

test('runs stay ordered by start time', () => {
  const state = reduce([started('r2', 200), started('r1', 100)]);

  expect(state.runs.map((run) => run.id)).toEqual(['r1', 'r2']);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test
```

Expected: FAIL — cannot resolve `./state`.

- [ ] **Step 3: Write `state.ts`**

`apps/web/lib/exec/state.ts`:

```ts
import { RUN_HISTORY_LIMIT, type ExecMessage, type RunRecord } from '@sandbox/shared';

export type ExecState = {
  runs: RunRecord[];
  /** A message meant for me alone — a rate-limit rejection for a run that never started. */
  notice: string | null;
};

export const EMPTY_EXEC_STATE: ExecState = { runs: [], notice: null };

const ordered = (runs: RunRecord[]): RunRecord[] =>
  [...runs].sort((a, b) => a.createdAt - b.createdAt).slice(-RUN_HISTORY_LIMIT);

const patch = (runs: RunRecord[], id: string, change: Partial<RunRecord>): RunRecord[] =>
  runs.map((run) => (run.id === id ? { ...run, ...change } : run));

/**
 * Runs are keyed by id, never appended blindly: the server re-sends run:history on every connect,
 * so a reconnect must re-render the same scrollback, not a second copy of it.
 */
export const applyExecMessage = (state: ExecState, message: ExecMessage): ExecState => {
  switch (message.type) {
    case 'run:history': {
      // The server's copy is authoritative — it has the complete output, and we may have dropped
      // the socket half way through a run.
      const merged = new Map(state.runs.map((run) => [run.id, run]));
      for (const run of message.runs) merged.set(run.id, run);

      return { ...state, runs: ordered([...merged.values()]) };
    }

    case 'run:started': {
      if (state.runs.some((run) => run.id === message.runId)) return state;

      const run: RunRecord = {
        id: message.runId,
        roomId: '',
        byUser: message.byUser,
        fileName: message.fileName,
        language: message.language,
        stdin: message.stdin,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: null,
        createdAt: message.at,
      };

      return { runs: ordered([...state.runs, run]), notice: null };
    }

    case 'run:output': {
      const current = state.runs.find((run) => run.id === message.runId);
      if (!current) return state;

      return {
        ...state,
        runs: patch(state.runs, message.runId, {
          [message.stream]: current[message.stream] + message.chunk,
        }),
      };
    }

    case 'run:done':
      return {
        ...state,
        runs: patch(state.runs, message.runId, {
          exitCode: message.exitCode,
          durationMs: message.durationMs,
        }),
      };

    case 'run:error': {
      // A rate-limit rejection carries a runId for a run that never started, and never will.
      // It is a notice to me, not a run in anyone's history.
      if (!state.runs.some((run) => run.id === message.runId)) {
        return { ...state, notice: message.message };
      }

      return { ...state, runs: patch(state.runs, message.runId, { error: message.message }) };
    }
  }
};
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/web test
```

Expected: PASS — 8 new tests.

- [ ] **Step 5: Write the failing tests for the renderer**

`apps/web/lib/exec/render.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { RunRecord } from '@sandbox/shared';
import { renderRuns } from './render';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room',
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  stdout: '',
  stderr: '',
  exitCode: null,
  durationMs: null,
  createdAt: 0,
  ...over,
});

/** Strip the ANSI colour codes: we assert on what the reader sees, not how it is painted. */
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

test('a run is attributed to the person who pressed Run', () => {
  expect(plain(renderRuns([run()], null))).toContain('Ada ran main.py');
});

test('stdin is echoed, so the output is intelligible to everyone else', () => {
  expect(plain(renderRuns([run({ stdin: '5' })], null))).toContain('stdin: 5');
});

test('the stdin clause is omitted when there is no stdin', () => {
  expect(plain(renderRuns([run()], null))).not.toContain('stdin:');
});

test('every newline is a CRLF — a bare LF staircases in xterm', () => {
  const rendered = renderRuns([run({ stdout: 'a\nb\n', exitCode: 0, durationMs: 5 })], null);

  expect(rendered).not.toMatch(/[^\r]\n/);
});

test('a clean exit is reported with its exit code and duration', () => {
  const rendered = plain(renderRuns([run({ stdout: '42\n', exitCode: 0, durationMs: 12 })], null));

  expect(rendered).toContain('42');
  expect(rendered).toContain('exited 0 in 12ms');
});

test('a failing exit is still reported, not hidden', () => {
  const rendered = plain(renderRuns([run({ stderr: 'boom', exitCode: 1, durationMs: 9 })], null));

  expect(rendered).toContain('boom');
  expect(rendered).toContain('exited 1 in 9ms');
});

test('an in-flight run says so, rather than looking finished', () => {
  expect(plain(renderRuns([run()], null))).toContain('running');
});

test('an executor error replaces the exit line', () => {
  const rendered = plain(renderRuns([run({ error: 'Piston is down.' })], null));

  expect(rendered).toContain('Piston is down.');
  expect(rendered).not.toContain('exited');
});

test('a notice is rendered even when nothing has run', () => {
  expect(plain(renderRuns([], 'One run every 2 seconds.'))).toContain('One run every 2 seconds.');
});

test('an empty terminal renders nothing at all', () => {
  expect(renderRuns([], null)).toBe('');
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test
```

Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 7: Write `render.ts`**

`apps/web/lib/exec/render.ts`:

```ts
import type { RunRecord } from '@sandbox/shared';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** xterm needs CRLF. A bare LF moves down a line without returning to column 0 — a staircase. */
const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

const trimTrailingNewline = (text: string): string => text.replace(/\r?\n$/, '');

const renderRun = (run: RunRecord): string => {
  const stdin = run.stdin ? `${DIM}  ◂ stdin: ${run.stdin.split('\n')[0]}${RESET}` : '';
  const lines = [`${DIM}▸${RESET} ${BOLD}${run.byUser.name}${RESET} ran ${run.fileName}${stdin}`];

  if (run.stdout) lines.push(crlf(trimTrailingNewline(run.stdout)));
  if (run.stderr) lines.push(`${RED}${crlf(trimTrailingNewline(run.stderr))}${RESET}`);

  if (run.error) {
    lines.push(`${RED}✗ ${run.error}${RESET}`);
  } else if (run.exitCode === null) {
    lines.push(`${DIM}… running${RESET}`);
  } else {
    const ok = run.exitCode === 0;
    const mark = ok ? `${GREEN}✓` : `${RED}✗`;
    lines.push(`${mark} exited ${run.exitCode} in ${run.durationMs}ms${RESET}`);
  }

  return lines.join('\r\n');
};

/** The whole scrollback, rendered from state. See Terminal.tsx for why it is rendered whole. */
export const renderRuns = (runs: RunRecord[], notice: string | null): string => {
  const blocks = runs.map(renderRun);
  if (notice) blocks.push(`${RED}✗ ${notice}${RESET}`);
  if (blocks.length === 0) return '';

  return `${blocks.join('\r\n\r\n')}\r\n`;
};
```

- [ ] **Step 8: Run and watch it pass**

```bash
pnpm --filter @sandbox/web test
```

Expected: PASS — 10 new tests, 22 in the package.

- [ ] **Step 9: Write the socket, with the StrictMode guard**

`apps/web/lib/env.ts` — replace the file:

```ts
export const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234/sync';
export const EXEC_URL = process.env.NEXT_PUBLIC_EXEC_URL ?? 'ws://localhost:1234/exec';
```

`apps/web/lib/exec/socket.ts`:

```ts
import type { ExecMessage, RunRequest } from '@sandbox/shared';
import { EXEC_URL } from '@/lib/env';

export type ExecStatus = 'connecting' | 'connected' | 'disconnected';

const MAX_BACKOFF_MS = 10_000;

export class ExecSocket {
  private socket: WebSocket | null = null;
  private readonly onMessage = new Set<(message: ExecMessage) => void>();
  private readonly onStatusChange = new Set<(status: ExecStatus) => void>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private destroyed = false;

  status: ExecStatus = 'connecting';

  constructor(private readonly roomId: string) {
    this.connect();
  }

  private setStatus(next: ExecStatus): void {
    this.status = next;
    for (const listener of this.onStatusChange) listener(next);
  }

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');

    const socket = new WebSocket(`${EXEC_URL}/${this.roomId}`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ExecMessage;
        for (const listener of this.onMessage) listener(message);
      } catch {
        // The server only ever sends JSON. A frame we cannot read is not worth taking the app down.
      }
    };

    socket.onerror = () => socket.close();

    socket.onclose = () => {
      this.setStatus('disconnected');
      if (this.destroyed) return;

      const delay = Math.min(1_000 * 2 ** this.attempt++, MAX_BACKOFF_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  send(request: RunRequest): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(request));
  }

  subscribe(listener: (message: ExecMessage) => void): () => void {
    this.onMessage.add(listener);
    return () => this.onMessage.delete(listener);
  }

  watchStatus(listener: (status: ExecStatus) => void): () => void {
    this.onStatusChange.add(listener);
    return () => this.onStatusChange.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

type Entry = { socket: ExecSocket; refs: number; teardown?: ReturnType<typeof setTimeout> };

/**
 * One socket per room id, cached outside React — the same guard as lib/yjs/room.ts, for the same
 * reason. StrictMode double-invokes every effect in development; without this cache each mount
 * opens its own exec socket and every run is rendered twice.
 */
const entries = new Map<string, Entry>();

/** Long enough to survive StrictMode's unmount/remount, short enough to free a real leave. */
const TEARDOWN_DELAY_MS = 1_000;

export const acquireExec = (roomId: string): ExecSocket => {
  const existing = entries.get(roomId);
  if (existing) {
    if (existing.teardown) {
      clearTimeout(existing.teardown);
      existing.teardown = undefined;
    }
    existing.refs += 1;
    return existing.socket;
  }

  const socket = new ExecSocket(roomId);
  entries.set(roomId, { socket, refs: 1 });
  return socket;
};

export const releaseExec = (roomId: string): void => {
  const entry = entries.get(roomId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.teardown = setTimeout(() => {
    const current = entries.get(roomId);
    if (!current || current.refs > 0) return;
    entries.delete(roomId);
    current.socket.destroy();
  }, TEARDOWN_DELAY_MS);
};
```

- [ ] **Step 10: Write `useFile` and `ExecContext`**

`apps/web/lib/yjs/useFile.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import type { FileMeta } from '@sandbox/shared';
import { getFilesMap } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** The file's metadata, re-read whenever anyone changes it — the language picker is a doc write. */
export const useFile = (fileId: string): FileMeta | undefined => {
  const { doc } = useRoomContext();
  const [file, setFile] = useState<FileMeta | undefined>(() => getFilesMap(doc).get(fileId));

  useEffect(() => {
    const files = getFilesMap(doc);
    const read = () => setFile(files.get(fileId));

    read();
    files.observe(read);
    return () => files.unobserve(read);
  }, [doc, fileId]);

  return file;
};
```

`apps/web/lib/exec/ExecContext.tsx`:

```tsx
'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DEFAULT_FILE, type User, getFileText, getFilesMap } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { type ExecSocket, type ExecStatus, acquireExec, releaseExec } from './socket';
import { EMPTY_EXEC_STATE, type ExecState, applyExecMessage } from './state';

type ExecContextValue = ExecState & {
  status: ExecStatus;
  isRunning: boolean;
  stdin: string;
  setStdin: (value: string) => void;
  runActiveFile: () => void;
};

const ExecContext = createContext<ExecContextValue | null>(null);

export const useExecContext = (): ExecContextValue => {
  const value = useContext(ExecContext);
  if (!value) throw new Error('useExecContext must be used inside <ExecProvider>');
  return value;
};

export function ExecProvider({ roomId, user, children }: { roomId: string; user: User; children: ReactNode }) {
  const { doc } = useRoomContext();
  const [state, setState] = useState<ExecState>(EMPTY_EXEC_STATE);
  const [status, setStatus] = useState<ExecStatus>('connecting');
  const [stdin, setStdin] = useState('');
  const socket = useRef<ExecSocket | null>(null);

  useEffect(() => {
    const acquired = acquireExec(roomId);
    socket.current = acquired;
    setStatus(acquired.status);

    const unsubscribe = acquired.subscribe((message) =>
      setState((current) => applyExecMessage(current, message)),
    );
    const unwatch = acquired.watchStatus(setStatus);

    return () => {
      unsubscribe();
      unwatch();
      releaseExec(roomId);
    };
  }, [roomId]);

  const runActiveFile = useCallback(() => {
    const file = getFilesMap(doc).get(DEFAULT_FILE.id);
    if (!file) return;

    // The snapshot the presser currently sees. The server never reads the CRDT.
    socket.current?.send({
      type: 'run',
      byUser: user,
      fileName: file.name,
      language: file.language,
      code: getFileText(doc, DEFAULT_FILE.id).toString(),
      stdin,
    });
  }, [doc, stdin, user]);

  const isRunning = state.runs.some((run) => run.exitCode === null && !run.error);

  return (
    <ExecContext.Provider
      value={{ ...state, status, isRunning, stdin, setStdin, runActiveFile }}
    >
      {children}
    </ExecContext.Provider>
  );
}
```

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm --filter @sandbox/web test
pnpm --filter @sandbox/web typecheck
```

Expected: 22 tests PASS, no type errors.

```bash
git add apps/web
git commit -m "feat(web): exec socket, run-state reducer, and terminal renderer" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: The terminal and the run bar

**Files:**
- Create: `apps/web/components/Terminal.tsx`, `apps/web/components/RunBar.tsx`
- Modify: `apps/web/components/CodeEditor.tsx`, `apps/web/components/Workspace.tsx`, `apps/web/package.json`
- Test: `e2e/execution.spec.ts`

**Interfaces:**
- Consumes: `useExecContext`, `useFile`, `useRoomContext`; `LANGUAGES`, `LanguageId`, `DEFAULT_FILE`, `setFileLanguage`, `MAX_STDIN_BYTES` from `@sandbox/shared`.
- Produces: `<Terminal />`, `<RunBar />`.

- [ ] **Step 1: Add xterm**

`apps/web/package.json` — add to `dependencies`:

```json
"@xterm/addon-fit": "^0.11.0",
"@xterm/xterm": "^6.0.0"
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

`e2e/execution.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('pressing Run shows the output in the terminal', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('terminal')).toBeVisible();
  await page.getByTestId('run').click();

  // The seeded file is FizzBuzz. Piston actually runs it.
  await expect(page.getByTestId('terminal')).toContainText('FizzBuzz', { timeout: 30_000 });
  await expect(page.getByTestId('terminal')).toContainText('exited 0');
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm test:e2e e2e/execution.spec.ts
```

Expected: FAIL — no element with test id `terminal`.

- [ ] **Step 4: Write `Terminal.tsx`**

`apps/web/components/Terminal.tsx`:

```tsx
'use client';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { useExecContext } from '@/lib/exec/ExecContext';
import { renderRuns } from '@/lib/exec/render';

export function Terminal() {
  const { runs, notice } = useExecContext();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!host.current) return;

    const xterm = new XTerm({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: false,
      disableStdin: true, // a shared output console, not a pty
      theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host.current);
    fit.fit();
    term.current = xterm;

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      xterm.dispose();
      term.current = null;
    };
  }, []);

  // The whole scrollback is re-rendered from state on every change. That is affordable, and it is
  // what makes reconnect correct for free: Piston is request/response, so one run produces about
  // three messages, not a stream of them.
  useEffect(() => {
    const xterm = term.current;
    if (!xterm) return;

    xterm.reset();
    xterm.write(renderRuns(runs, notice));
  }, [runs, notice]);

  return <div data-testid="terminal" ref={host} className="h-full w-full overflow-hidden" />;
}
```

- [ ] **Step 5: Write `RunBar.tsx`**

`apps/web/components/RunBar.tsx`:

```tsx
'use client';

import { DEFAULT_FILE, LANGUAGES, type LanguageId, MAX_STDIN_BYTES, setFileLanguage } from '@sandbox/shared';
import { useExecContext } from '@/lib/exec/ExecContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

export function RunBar() {
  const { doc } = useRoomContext();
  const { runActiveFile, isRunning, status, stdin, setStdin } = useExecContext();
  const file = useFile(DEFAULT_FILE.id);

  const offline = status !== 'connected';
  const disabled = offline || isRunning || !file;

  const label = offline ? 'Offline' : isRunning ? 'Running…' : 'Run';

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
      <code className="text-sm text-neutral-400">{file?.name ?? '—'}</code>

      <select
        aria-label="Language"
        value={file?.language ?? 'python'}
        disabled={!file}
        onChange={(event) => setFileLanguage(doc, DEFAULT_FILE.id, event.target.value as LanguageId)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        {Object.entries(LANGUAGES).map(([id, language]) => (
          <option key={id} value={id}>
            {language.label}
          </option>
        ))}
      </select>

      <input
        aria-label="Standard input"
        value={stdin}
        onChange={(event) => setStdin(event.target.value.slice(0, MAX_STDIN_BYTES))}
        placeholder="stdin"
        className="w-48 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
      />

      <button
        type="button"
        data-testid="run"
        onClick={runActiveFile}
        disabled={disabled}
        title="Ctrl/Cmd + Enter"
        className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        ▶ {label}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Teach the editor about the language and the shortcut**

`apps/web/components/CodeEditor.tsx` — replace the file:

```tsx
'use client';

import Editor, { useMonaco } from '@monaco-editor/react';
import { DEFAULT_FILE, LANGUAGES, getFileText } from '@sandbox/shared';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { useExecContext } from '@/lib/exec/ExecContext';
import { setupMonaco } from '@/lib/monaco/setup';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

setupMonaco();

export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const { runActiveFile } = useExecContext();
  const monaco = useMonaco();
  const file = useFile(DEFAULT_FILE.id);
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

  // addCommand's handler is registered once and would otherwise close over a stale runActiveFile.
  const run = useRef(runActiveFile);
  run.current = runActiveFile;

  useEffect(() => {
    const model = instance?.getModel();
    if (!instance || !model) return;

    // MonacoBinding seeds the model from the Y.Text. Never pass `value`/`defaultValue` to
    // <Editor>: the binding would push that content back into the CRDT and duplicate it.
    const binding = new MonacoBinding(
      getFileText(doc, DEFAULT_FILE.id),
      model,
      new Set([instance]),
      awareness,
    );
    return () => binding.destroy();
  }, [instance, doc, awareness]);

  // Monaco swallows keydown, so a document-level listener never fires while the editor has focus.
  useEffect(() => {
    if (!instance || !monaco) return;

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run.current());
  }, [instance, monaco]);

  // The language picker is a Y.Doc write, so it arrives here for everyone, not just the picker.
  useEffect(() => {
    const model = instance?.getModel();
    if (!monaco || !model || !file) return;

    monaco.editor.setModelLanguage(model, LANGUAGES[file.language].monaco);
  }, [instance, monaco, file]);

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      path={DEFAULT_FILE.name}
      defaultLanguage={LANGUAGES[DEFAULT_FILE.language].monaco}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
      onMount={setInstance}
      loading={
        <div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>
      }
    />
  );
}
```

Note `path={DEFAULT_FILE.name}` stays fixed. Changing `path` would make `@monaco-editor/react` create a **new model**, orphaning the `MonacoBinding` and silently breaking sync. The language is retargeted on the existing model instead.

- [ ] **Step 7: Wire the workspace**

`apps/web/components/Workspace.tsx` — replace the file:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { ExecProvider } from '@/lib/exec/ExecContext';
import { RoomProvider } from '@/lib/yjs/RoomContext';
import { ConnectionPill } from './ConnectionPill';
import { JoinGate } from './JoinGate';
import { PresenceBar } from './PresenceBar';
import { RemoteCursorStyles } from './RemoteCursorStyles';
import { RunBar } from './RunBar';

// Monaco and xterm both touch `window` at module scope and cannot be server-rendered.
const CodeEditor = dynamic(() => import('./CodeEditor').then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>
  ),
});

const Terminal = dynamic(() => import('./Terminal').then((m) => m.Terminal), {
  ssr: false,
  loading: () => <div className="h-full bg-neutral-950" />,
});

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
            <ExecProvider roomId={roomId} user={user}>
              <div className="flex h-full flex-col">
                <RemoteCursorStyles />

                <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
                  <span className="font-semibold">Sandbox</span>
                  <code data-testid="room-id" className="rounded bg-neutral-800 px-2 py-0.5 text-sm">
                    {roomId}
                  </code>
                  <div className="ml-auto flex items-center gap-3">
                    <PresenceBar />
                    <ConnectionPill status={status} />
                  </div>
                </header>

                <RunBar />

                <main className="min-h-0 flex-1">
                  <CodeEditor />
                </main>

                <section className="h-64 shrink-0 border-t border-neutral-800 bg-neutral-950 p-2">
                  <Terminal />
                </section>
              </div>
            </ExecProvider>
          )}
        </RoomProvider>
      )}
    </JoinGate>
  );
}
```

- [ ] **Step 8: Look at it with your own eyes**

xterm is the second riskiest integration in this codebase after Monaco. Stop and check it before trusting a test.

```bash
pnpm dev
# open http://localhost:3000, create a sandbox, join, press Run
```

Expected: FizzBuzz output in the terminal, `✓ exited 0 in …ms`, and **a clean browser console**. Switch the language to JavaScript — the filename becomes `main.js` and Monaco's highlighting changes. Press `Ctrl`/`Cmd`+`Enter` inside the editor — it runs.

If the terminal is blank but the run succeeded, the container has no height: xterm cannot fit into a zero-height box.

- [ ] **Step 9: Run the test and watch it pass**

```bash
pnpm test:e2e e2e/execution.spec.ts
```

Expected: PASS. This test calls the real Piston, so allow it the 30s timeout.

- [ ] **Step 10: Commit**

```bash
git add apps/web e2e
git commit -m "feat(web): xterm terminal, run bar, and the language picker" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: The two-person execution test, and the README

The acceptance criterion for the phase. Alice presses Run; **Bob** sees the output. Everything else in Phase 2 exists to make this test pass.

**Files:**
- Modify: `e2e/execution.spec.ts`, `README.md`

- [ ] **Step 1: Write the failing test**

Two **browser contexts**, not two tabs — as in Phase 1, contexts are isolated, so nothing can sync behind the server's back and hand us a false pass.

Append to `e2e/execution.spec.ts`:

```ts
test('one person runs, and the other person sees the output', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('run').click();

  // Bob pressed nothing. Bob sees the output, and Bob sees who ran it.
  await expect(bob.getByTestId('terminal')).toContainText('FizzBuzz', { timeout: 30_000 });
  await expect(bob.getByTestId('terminal')).toContainText('Alice ran main.py');
  await expect(bob.getByTestId('terminal')).toContainText('exited 0');

  await aliceContext.close();
  await bobContext.close();
});

test('stdin reaches the program, and the room can see what it was', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.press('ControlOrMeta+A');
  await alice.keyboard.type('print(f"hello {input()}")');

  await alice.getByLabel('Standard input').fill('world');
  await alice.getByTestId('run').click();

  await expect(bob.getByTestId('terminal')).toContainText('hello world', { timeout: 30_000 });
  // Bob did not type the input, so the output would be inexplicable without this.
  await expect(bob.getByTestId('terminal')).toContainText('stdin: world');

  await aliceContext.close();
  await bobContext.close();
});
```

- [ ] **Step 2: Run it**

```bash
pnpm test:e2e e2e/execution.spec.ts
```

Expected: PASS — 3 tests. If Bob sees `run:started` but never the output, the server is replying to the requester rather than broadcasting to the room.

- [ ] **Step 3: Run the whole suite**

```bash
pnpm test
pnpm typecheck
pnpm test:e2e
```

Expected: all green — **68 unit/integration tests** and **8 Playwright tests**. Fix anything that is not before writing the README: a README that describes software whose tests fail is a lie.

- [ ] **Step 4: Update the README**

`README.md` — replace the "Status", "What works today", "Tests", and "Not built yet" sections:

```markdown
**Status:** Phase 2 of 5 complete — real-time collaborative editing, and shared execution.
```

Add to "What works today":

```markdown
- Anyone presses **Run** (or `Ctrl`/`Cmd`+`Enter`) and *everyone* sees the same stdout and stderr
  appear in the same terminal at the same moment — with stdin echoed, so the output makes sense to
  the people who did not type it.
- Python, JavaScript and TypeScript. The language picker renames the file to match.
- Your code runs in Piston's isolated, network-less container — never on our server.
- Someone who joins late is replayed the runs they missed.
```

Update "Architecture" with:

```markdown
- **Two sockets, on purpose.** `/sync/<roomId>` is a pure Yjs relay that never parses document
  semantics. `/exec/<roomId>` is the single execution authority: it validates at the boundary,
  rate-limits, calls Piston, and broadcasts the result to the room. Run requests deliberately do
  *not* go through the CRDT — that would force the relay to understand the document, and every
  server instance would execute the same pending run.
```

Update "Tests":

```markdown
pnpm test         # 68 unit + integration tests (Vitest)
pnpm test:e2e     # 8 browser tests (Playwright), incl. two real browsers running one program
```

Update "Not built yet":

```markdown
The overlay drawing canvas (Phase 3), Postgres persistence and multi-file support (Phase 4),
line-anchored annotations and deployment (Phase 5).
```

- [ ] **Step 5: Commit**

```bash
git add e2e README.md
git commit -m "test(e2e): two-person shared execution, and the README" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the Phase 2 spec has a task. `/exec/<roomId>` transport → Task 5. Wire protocol and `RunRecord` → Task 1 (types), Task 5 (encode/decode). Who-receives-what, including the rate-limit/executor-failure split → Task 5 (`connection.ts`, and two integration tests that assert the split directly). Limits → Task 1. `CodeExecutor` + `PistonExecutor` → Task 3. Token bucket → Task 2. `RunStore` + `ExecRoom` → Task 4. Terminal → Task 7. RunBar and `Ctrl`+`Enter` → Task 7. Language picker → Task 1 (`setFileLanguage`) + Task 7 (the `<select>`). Error handling → Task 3 (executor failures), Task 5 (boundary, rate limit), Task 6 (`notice`, reconnect dedupe). Security → Task 3 (code never runs on the host), Task 5 (zod boundary, size caps, room-id validation). Testing → every task. Nothing in the spec is unassigned.

**One deviation from the spec, decided while planning.** §7 of the spec says the client "keeps runs in a map keyed by `runId`". The implementation keeps an *array* keyed by id on write (`applyExecMessage` merges by id and re-sorts). The property the spec was asking for — a reconnect re-renders the same scrollback rather than a second copy — holds, and is asserted by two tests in Task 6. An array keeps the render order trivially correct.

**A design choice worth flagging for review.** `Terminal.tsx` re-renders the entire scrollback on every state change (`xterm.reset()` then `write()`), rather than appending incrementally. This is only defensible because Piston is request/response: one run produces about three messages, not a stream of them, and runs are rate-limited to one per two seconds. It buys correctness on reconnect for free. If a streaming executor ever lands, this is the first thing that must change — and the `CodeExecutor` interface is the seam that would tell you so.

**Phase 1 must stay green.** Task 5 modifies `server.ts`, which the Phase 1 sync tests exercise. Its Step 9 asserts the 9 existing sync tests still pass. Phase 2 adds no read of the Y.Doc on the server: the relay stays pure.
