# Phase 0 + 1 — Scaffold and Collaborative Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people open the same `/s/<roomId>` URL and edit one document together in Monaco, seeing each other's keystrokes, coloured cursors, selections, and presence — over a Yjs CRDT relayed by our own WebSocket server.

**Architecture:** A pnpm monorepo with three packages. `@sandbox/shared` owns the Y.Doc schema and every type crossing the wire. `@sandbox/ws-server` implements the Yjs sync protocol directly (`y-protocols` + `lib0`) as a **pure relay** — it holds a `Y.Doc` per room and never interprets its contents. `@sandbox/web` is a Next.js App Router app; Monaco is bound to a `Y.Text` by `y-monaco`, and a single `WebsocketProvider` per room is cached module-side so React StrictMode's double-mount cannot open two sockets.

**Tech Stack:** pnpm workspaces, TypeScript 5.7, Next.js 15 (App Router, webpack), React 19, Tailwind v4, Monaco (npm build), Yjs 13, y-websocket 2 (client), y-protocols + lib0 (server), ws 8, Vitest 2, Playwright.

Spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md`. This plan covers Phase 0 and Phase 1 of §11 only.

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` WebSocket server is a **pure relay**: it may hold and merge the `Y.Doc`, but it must never read application-level keys out of it. The only exception is one-time seeding at room creation.
- **Exactly one Yjs instance in the dependency graph.** `@sandbox/shared` declares `yjs` as a **peerDependency**; the two apps depend on the same version range. Two copies of Yjs produce `instanceof` failures that look like random sync corruption.
- **Exactly one Monaco instance on the page.** `y-monaco` imports `monaco-editor` directly, so `@monaco-editor/react` must be pointed at the npm build via `loader.config({ monaco })` — never the default CDN loader.
- Monaco touches `window` at module scope: every module that imports `monaco-editor` is reachable only through `next/dynamic` with `ssr: false`.
- The server **broadcasts awareness updates to every connection, including the originator.** `y-websocket`'s client treats any inbound message as a liveness signal and drops the socket after 30 s of silence; the awareness echo is that heartbeat.
- Room ids: `^[A-Za-z0-9_-]{6,32}$`. Validate on both ends. Unvalidated ids let anyone allocate unbounded server rooms.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Until Phase 4 there is no persistence: a room lives while someone is connected, plus a 30 s grace period. That is expected, not a bug.

## File Structure

```text
package.json                       workspace root: scripts, shared devDeps
pnpm-workspace.yaml
tsconfig.base.json                 strictness only; each package sets its own module mode
playwright.config.ts               boots both apps, runs e2e/
.env.example
e2e/                               Playwright specs (smoke, presence, editor, collaboration)

packages/shared/
  package.json                     built to dist/ (ESM); yjs is a PEER dep
  tsconfig.json                    NodeNext — relative imports carry .js extensions
  src/model.ts                     types, constants, isValidRoomId, sanitizeName
  src/doc.ts                       Y.Doc accessors + seedDoc
  src/index.ts                     re-exports
  src/*.test.ts

apps/ws-server/
  package.json                     run by tsx, in dev and on Render
  src/env.ts                       PORT / HOST
  src/sync/protocol.ts             message codec — pure, fully unit-tested
  src/sync/room.ts                 one Room = Y.Doc + Awareness + connections
  src/sync/rooms.ts                registry: create, seed, grace-period eviction
  src/sync/connection.ts           wires one ws connection into a Room
  src/server.ts                    http + upgrade routing (factory, listens on any port)
  src/index.ts                     bootstrap
  test/sync.test.ts                integration: two real Yjs clients converge

apps/web/
  package.json
  next.config.mjs                  transpilePackages, webpack (not turbopack)
  postcss.config.mjs               Tailwind v4
  app/layout.tsx  app/globals.css
  app/page.tsx                     landing → mint a room id → /s/<id>
  app/s/[roomId]/page.tsx          validates the id, renders <Workspace>
  components/Workspace.tsx         client root: JoinGate + header + editor
  components/JoinGate.tsx          name + colour, persisted to localStorage
  components/ConnectionPill.tsx
  components/PresenceBar.tsx
  components/CodeEditor.tsx        Monaco + MonacoBinding  (ssr: false)
  components/RemoteCursorStyles.tsx  per-clientID CSS for y-monaco's decorations
  lib/env.ts
  lib/identity.ts
  lib/monaco/setup.ts              MonacoEnvironment workers + loader.config
  lib/yjs/room.ts                  module-level provider cache (StrictMode guard)
  lib/yjs/useRoom.ts               hook
  lib/yjs/RoomContext.tsx          shares one handle with the whole tree
  lib/*.test.ts
```

Deviations from the spec's tree, and why: the spec listed `packages/types` and `packages/config`. The shared package carries Y.Doc *accessors*, not only types, so it is named `packages/shared`; and a two-app monorepo does not need a config package — `tsconfig.base.json` at the root is enough.

---

### Task 1: Workspace scaffold and the shared model

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/model.ts`, `packages/shared/src/doc.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/model.test.ts`, `packages/shared/src/doc.test.ts`

**Interfaces:**
- Produces: `isValidRoomId(id: string | undefined): id is string`; `sanitizeName(raw: string): string`; `MAX_NAME_LENGTH`, `ROOM_ID_LENGTH`; types `FileMeta`, `Point`, `Shape`, `Stroke`, `User`, `AwarenessState`, `LanguageId`; `LANGUAGES`, `DEFAULT_FILE`, `DEFAULT_FILE_CONTENT`; `getFilesMap(doc)`, `getFileText(doc, fileId)`, `getStrokes(doc)`, `listFiles(doc): FileMeta[]`, `seedDoc(doc): void`.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "crdt-sandbox",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "pnpm --filter @sandbox/shared build && concurrently -n shared,server,web -c gray,magenta,cyan \"pnpm --filter @sandbox/shared dev\" \"pnpm --filter @sandbox/ws-server dev\" \"pnpm --filter @sandbox/web dev\"",
    "build": "pnpm --filter @sandbox/shared build && pnpm --filter @sandbox/web build",
    "typecheck": "pnpm --filter @sandbox/shared build && pnpm -r typecheck",
    "test": "pnpm --filter @sandbox/shared build && pnpm -r test",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "concurrently": "^9.1.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.env.example`:

```bash
# apps/web (inlined at build time)
NEXT_PUBLIC_SYNC_URL=ws://localhost:1234/sync

# apps/ws-server
PORT=1234
HOST=0.0.0.0
```

- [ ] **Step 2: Create the shared package manifest**

`packages/shared/package.json` — note `yjs` is a **peer** dependency (Global Constraints):

```json
{
  "name": "@sandbox/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": { "yjs": "^13.6.21" },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^2.1.8",
    "yjs": "^13.6.21"
  }
}
```

`packages/shared/tsconfig.json` — NodeNext, so relative imports must carry `.js` extensions:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 3: Write the failing tests for the model**

`packages/shared/src/model.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { MAX_NAME_LENGTH, isValidRoomId, sanitizeName } from './model.js';

describe('isValidRoomId', () => {
  test('accepts a nanoid-shaped id', () => {
    expect(isValidRoomId('V1StGXR8_Z')).toBe(true);
  });

  test('rejects ids that are too short, too long, missing, or contain path characters', () => {
    expect(isValidRoomId('abc')).toBe(false);
    expect(isValidRoomId('a'.repeat(33))).toBe(false);
    expect(isValidRoomId('../../etc/passwd')).toBe(false);
    expect(isValidRoomId(undefined)).toBe(false);
  });
});

describe('sanitizeName', () => {
  test('keeps letters, digits, spaces and simple punctuation', () => {
    expect(sanitizeName('Ada Lovelace-1')).toBe('Ada Lovelace-1');
  });

  test('strips characters that could break out of a CSS string', () => {
    // Names are interpolated into a <style> rule for remote cursors (Task 7).
    const clean = sanitizeName("Bob'; } body { display: none } /*");
    expect(clean).not.toMatch(/['{}();*\/\\]/);
  });

  test('truncates to MAX_NAME_LENGTH', () => {
    expect(sanitizeName('x'.repeat(100))).toHaveLength(MAX_NAME_LENGTH);
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

```bash
pnpm install
pnpm --filter @sandbox/shared test
```

Expected: FAIL — `Failed to resolve import "./model.js"`.

- [ ] **Step 5: Write `model.ts`**

`packages/shared/src/model.ts`:

```ts
export const SCHEMA_VERSION = 1;
export const ROOM_ID_LENGTH = 10;
export const MAX_NAME_LENGTH = 24;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/;

export const isValidRoomId = (id: string | undefined): id is string =>
  typeof id === 'string' && ROOM_ID_PATTERN.test(id);

export const sanitizeName = (raw: string): string =>
  raw.replace(/[^\p{L}\p{N} _.\-]/gu, '').slice(0, MAX_NAME_LENGTH).trim();

export const LANGUAGES = {
  python: { label: 'Python', monaco: 'python', extension: '.py' },
  javascript: { label: 'JavaScript', monaco: 'javascript', extension: '.js' },
  typescript: { label: 'TypeScript', monaco: 'typescript', extension: '.ts' },
} as const;

export type LanguageId = keyof typeof LANGUAGES;

export type FileMeta = {
  id: string;
  name: string;
  language: LanguageId;
  createdAt: number;
};

export type Point = { x: number; y: number; p?: number };

export type Shape =
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string };

export type Stroke = {
  id: string;
  fileId: string;
  authorId: string;
  color: string;
  width: number;
  shape: Shape;
  /** Phase 5. `rel` is a base64-encoded Yjs relative position into the file's Y.Text. */
  anchor?: { rel: string; dy: number };
  createdAt: number;
};

export type User = { id: string; name: string; color: string };

/** y-monaco writes its own `selection` field (Yjs relative positions) into awareness. */
export type AwarenessState = {
  user: User;
  activeFileId: string;
  pointer?: { fileId: string; x: number; y: number };
};

export const DOC_FILES_KEY = 'files';
export const DOC_STROKES_KEY = 'strokes';
export const DOC_META_KEY = 'meta';
export const fileTextKey = (fileId: string): string => `file:${fileId}`;

export const DEFAULT_FILE: FileMeta = {
  id: 'main',
  name: 'main.py',
  language: 'python',
  createdAt: 0, // deterministic: a timestamp here would differ per seeder
};

export const DEFAULT_FILE_CONTENT = `# Two people, one file. Try typing while someone else does.

def fizzbuzz(n: int) -> str:
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)


for i in range(1, 16):
    print(fizzbuzz(i))
`;
```

- [ ] **Step 6: Run the model tests and watch them pass**

```bash
pnpm --filter @sandbox/shared test
```

Expected: PASS — 5 tests.

- [ ] **Step 7: Write the failing tests for the doc accessors**

`packages/shared/src/doc.test.ts`:

```ts
import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE } from './model.js';
import { getFileText, listFiles, seedDoc } from './doc.js';

test('seedDoc creates exactly one default file, with content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(listFiles(doc).map((f) => f.name)).toEqual(['main.py']);
  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
});

test('seedDoc is idempotent — a second call cannot duplicate the content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const first = getFileText(doc, DEFAULT_FILE.id).toString();

  seedDoc(doc);

  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toBe(first);
  expect(listFiles(doc)).toHaveLength(1);
});

test('listFiles is ordered by creation time', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  doc.getMap('files').set('later', {
    id: 'later', name: 'notes.js', language: 'javascript', createdAt: 10,
  });

  expect(listFiles(doc).map((f) => f.id)).toEqual(['main', 'later']);
});
```

- [ ] **Step 8: Run and watch it fail**

```bash
pnpm --filter @sandbox/shared test
```

Expected: FAIL — `Failed to resolve import "./doc.js"`.

- [ ] **Step 9: Write `doc.ts` and `index.ts`**

`packages/shared/src/doc.ts`:

```ts
import * as Y from 'yjs';
import {
  DEFAULT_FILE,
  DEFAULT_FILE_CONTENT,
  DOC_FILES_KEY,
  DOC_META_KEY,
  DOC_STROKES_KEY,
  SCHEMA_VERSION,
  fileTextKey,
  type FileMeta,
  type Stroke,
} from './model.js';

export const getFilesMap = (doc: Y.Doc): Y.Map<FileMeta> => doc.getMap<FileMeta>(DOC_FILES_KEY);
export const getStrokes = (doc: Y.Doc): Y.Array<Stroke> => doc.getArray<Stroke>(DOC_STROKES_KEY);
export const getMeta = (doc: Y.Doc): Y.Map<number> => doc.getMap<number>(DOC_META_KEY);
export const getFileText = (doc: Y.Doc, fileId: string): Y.Text => doc.getText(fileTextKey(fileId));

export const listFiles = (doc: Y.Doc): FileMeta[] =>
  [...getFilesMap(doc).values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name),
  );

/**
 * Seed an empty doc. Only the server calls this, once, before any client connects:
 * two peers seeding concurrently would each insert DEFAULT_FILE_CONTENT and the CRDT
 * would faithfully merge both copies.
 */
export const seedDoc = (doc: Y.Doc): void => {
  if (getFilesMap(doc).size > 0) return;

  doc.transact(() => {
    getMeta(doc).set('schemaVersion', SCHEMA_VERSION);
    getMeta(doc).set('createdAt', Date.now());
    getFilesMap(doc).set(DEFAULT_FILE.id, DEFAULT_FILE);
    getFileText(doc, DEFAULT_FILE.id).insert(0, DEFAULT_FILE_CONTENT);
  });
};
```

`packages/shared/src/index.ts`:

```ts
export * from './model.js';
export * from './doc.js';
```

- [ ] **Step 10: Run the tests and the build**

```bash
pnpm --filter @sandbox/shared test
pnpm --filter @sandbox/shared build
ls packages/shared/dist/index.js
```

Expected: 8 tests PASS; `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .env.example packages/
git commit -m "feat(shared): workspace scaffold and Y.Doc schema" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The sync protocol codec

The server speaks the Yjs WebSocket protocol itself rather than importing `y-websocket/bin/utils` — the codec is 60 lines, it is the part worth being able to explain, and it gives us the hooks Phase 4 needs for persistence.

**Files:**
- Create: `apps/ws-server/package.json`, `apps/ws-server/tsconfig.json`, `apps/ws-server/vitest.config.ts`, `apps/ws-server/src/env.ts`, `apps/ws-server/src/sync/protocol.ts`
- Test: `apps/ws-server/src/sync/protocol.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (pure protocol).
- Produces: `MESSAGE_SYNC = 0`, `MESSAGE_AWARENESS = 1`, `MESSAGE_AUTH = 2`, `MESSAGE_QUERY_AWARENESS = 3`; `encodeSyncStep1(doc: Y.Doc): Uint8Array`; `encodeSyncUpdate(update: Uint8Array): Uint8Array`; `encodeAwarenessUpdate(awareness: Awareness, clients: number[]): Uint8Array`; `handleMessage(message, doc, awareness, origin): { reply?: Uint8Array }`.

- [ ] **Step 1: Create the ws-server manifest and configs**

`apps/ws-server/package.json`:

```json
{
  "name": "@sandbox/ws-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@sandbox/shared": "workspace:*",
    "lib0": "^0.2.99",
    "ws": "^8.18.0",
    "y-protocols": "^1.0.6",
    "yjs": "^13.6.21"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8",
    "y-websocket": "^2.1.0"
  }
}
```

`y-websocket` is a **dev** dependency: the integration test in Task 3 uses the real client against our server.

`apps/ws-server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`apps/ws-server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
```

`apps/ws-server/src/env.ts`:

```ts
export const env = {
  port: Number(process.env.PORT ?? 1234),
  host: process.env.HOST ?? '0.0.0.0',
};
```

- [ ] **Step 2: Write the failing protocol tests**

`apps/ws-server/src/sync/protocol.test.ts`:

```ts
import { expect, test } from 'vitest';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  Awareness,
  encodeAwarenessUpdate as encodeAwarenessStateUpdate,
} from 'y-protocols/awareness';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  encodeSyncStep1,
  handleMessage,
} from './protocol';

const syncStep1For = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

test('encodeSyncStep1 tags the message as a sync message', () => {
  const decoder = decoding.createDecoder(encodeSyncStep1(new Y.Doc()));
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
});

test('handleMessage answers a step-1 message with the updates the peer is missing', () => {
  const server = new Y.Doc();
  server.getText('file:main').insert(0, 'server content');
  const client = new Y.Doc();

  const { reply } = handleMessage(
    syncStep1For(client), server, new Awareness(server), 'test',
  );
  expect(reply).toBeDefined();

  const decoder = decoding.createDecoder(reply!);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), client, 'test');

  expect(client.getText('file:main').toString()).toBe('server content');
});

test('handleMessage applies an inbound awareness update', () => {
  const doc = new Y.Doc();
  const serverAwareness = new Awareness(doc);
  serverAwareness.setLocalState(null);

  const peerDoc = new Y.Doc();
  const peerAwareness = new Awareness(peerDoc);
  peerAwareness.setLocalStateField('user', { id: 'u1', name: 'Ada', color: '#f97316' });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    encodeAwarenessStateUpdate(peerAwareness, [peerDoc.clientID]),
  );

  handleMessage(encoding.toUint8Array(encoder), doc, serverAwareness, 'test');

  const state = serverAwareness.getStates().get(peerDoc.clientID) as { user?: { name: string } };
  expect(state?.user?.name).toBe('Ada');
});

test('handleMessage answers a query-awareness message with every known state', () => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', { id: 'u1', name: 'Ada', color: '#f97316' });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);

  const { reply } = handleMessage(encoding.toUint8Array(encoder), doc, awareness, 'test');

  expect(reply).toBeDefined();
  const decoder = decoding.createDecoder(reply!);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_AWARENESS);
});

test('handleMessage rejects an unknown message type', () => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 99);
  const doc = new Y.Doc();

  expect(() =>
    handleMessage(encoding.toUint8Array(encoder), doc, new Awareness(doc), 'test'),
  ).toThrow(/unknown message type/);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm install
pnpm --filter @sandbox/ws-server test
```

Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 4: Write `protocol.ts`**

`apps/ws-server/src/sync/protocol.ts`:

```ts
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

/** "Here is my state vector — send me what I am missing." */
export const encodeSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

export const encodeSyncUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

export const encodeAwarenessUpdate = (
  awareness: awarenessProtocol.Awareness,
  clients: number[],
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
  );
  return encoding.toUint8Array(encoder);
};

export type HandleResult = { reply?: Uint8Array };

/**
 * Apply one inbound client message to the room's doc and awareness.
 * The doc is merged, never inspected: this function is the whole of what the relay "understands".
 */
export const handleMessage = (
  message: Uint8Array,
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  origin: unknown,
): HandleResult => {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  const type = decoding.readVarUint(decoder);

  switch (type) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
      // A length of 1 is just the type byte: we have nothing to say back.
      return encoding.length(encoder) > 1 ? { reply: encoding.toUint8Array(encoder) } : {};
    }
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        origin,
      );
      return {};
    }
    case MESSAGE_QUERY_AWARENESS:
      return { reply: encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]) };
    case MESSAGE_AUTH:
      return {}; // server → client only
    default:
      throw new Error(`unknown message type ${type}`);
  }
};
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm --filter @sandbox/ws-server test
pnpm --filter @sandbox/ws-server typecheck
```

Expected: 5 tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/ws-server
git commit -m "feat(ws-server): Yjs sync protocol codec" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
### Task 3: Rooms, connections, and the server

**Files:**
- Create: `apps/ws-server/src/sync/room.ts`, `apps/ws-server/src/sync/rooms.ts`, `apps/ws-server/src/sync/connection.ts`, `apps/ws-server/src/server.ts`, `apps/ws-server/src/index.ts`
- Test: `apps/ws-server/test/sync.test.ts`

**Interfaces:**
- Consumes: `seedDoc`, `getFileText`, `listFiles`, `isValidRoomId`, `DEFAULT_FILE` from `@sandbox/shared`; `encodeSyncStep1`, `encodeSyncUpdate`, `encodeAwarenessUpdate`, `handleMessage` from Task 2.
- Produces: `class Room { id, doc, awareness, conns, broadcast(msg), addConnection(ws), removeConnection(ws), size, destroy() }`; `send(conn, message)`; `getOrCreateRoom(id): Room`; `releaseRoom(room, graceMs?)`; `roomCount(): number`; `resetRooms(): void`; `setupSyncConnection(conn, room)`; `createSandboxServer(): http.Server`.

- [ ] **Step 1: Write the failing integration test**

`apps/ws-server/test/sync.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, getFileText, listFiles } from '@sandbox/shared';
import { createSandboxServer } from '../src/server';
import { resetRooms } from '../src/sync/rooms';

let server: ReturnType<typeof createSandboxServer>;
let syncUrl: string;
const open: WebsocketProvider[] = [];

beforeEach(async () => {
  server = createSandboxServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  syncUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sync`;
});

afterEach(async () => {
  open.splice(0).forEach((p) => p.destroy());
  resetRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connect = (room: string) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(syncUrl, room, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true, // Node has BroadcastChannel; using it here would sync the two docs *around* the server
  });
  open.push(provider);
  return { doc, provider };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

test('a new room is seeded with the default file', async () => {
  const alice = connect('room-seed-a');
  await waitFor(() => listFiles(alice.doc).length === 1);

  expect(listFiles(alice.doc)[0]?.name).toBe('main.py');
  expect(getFileText(alice.doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
});

test('two clients converge on concurrent edits', async () => {
  const alice = connect('room-converge-a');
  const bob = connect('room-converge-a');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  getFileText(alice.doc, DEFAULT_FILE.id).insert(0, 'ALICE\n');
  getFileText(bob.doc, DEFAULT_FILE.id).insert(0, 'BOB\n');

  await waitFor(() => {
    const a = getFileText(alice.doc, DEFAULT_FILE.id).toString();
    const b = getFileText(bob.doc, DEFAULT_FILE.id).toString();
    return a === b && a.includes('ALICE') && a.includes('BOB');
  });

  expect(getFileText(alice.doc, DEFAULT_FILE.id).toString()).toBe(
    getFileText(bob.doc, DEFAULT_FILE.id).toString(),
  );
});

test('awareness propagates from one client to another', async () => {
  const alice = connect('room-aware-a');
  const bob = connect('room-aware-a');
  await waitFor(() => alice.provider.wsconnected && bob.provider.wsconnected);

  alice.provider.awareness.setLocalStateField('user', {
    id: 'u1', name: 'Ada', color: '#f97316',
  });

  await waitFor(() =>
    [...bob.provider.awareness.getStates().values()].some(
      (state) => (state as { user?: { name: string } }).user?.name === 'Ada',
    ),
  );
});

test('a room in the registry is not evicted while a client is still connected', async () => {
  const alice = connect('room-evict-a');
  await waitFor(() => alice.provider.wsconnected);

  const { roomCount } = await import('../src/sync/rooms');
  expect(roomCount()).toBe(1);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/ws-server test
```

Expected: FAIL — cannot resolve `../src/server`.

- [ ] **Step 3: Write `room.ts`**

`apps/ws-server/src/sync/room.ts`:

```ts
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { seedDoc } from '@sandbox/shared';
import { encodeAwarenessUpdate, encodeSyncUpdate } from './protocol';

export const send = (conn: WebSocket, message: Uint8Array): void => {
  if (conn.readyState !== WebSocket.OPEN) return;
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
};

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  /** connection → the awareness clientIDs it has announced, so we can clear them on close */
  private readonly connections = new Map<WebSocket, Set<number>>();

  constructor(readonly id: string) {
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState(null); // the server is a relay, not a peer

    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  seed(): void {
    seedDoc(this.doc);
  }

  get size(): number {
    return this.connections.size;
  }

  addConnection(conn: WebSocket): void {
    this.connections.set(conn, new Set());
  }

  removeConnection(conn: WebSocket): void {
    const announced = this.connections.get(conn);
    this.connections.delete(conn);
    if (announced && announced.size > 0) {
      removeAwarenessStates(this.awareness, [...announced], null);
    }
  }

  broadcast(message: Uint8Array): void {
    for (const conn of this.connections.keys()) send(conn, message);
  }

  destroy(): void {
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
  }

  private onDocUpdate = (update: Uint8Array): void => {
    this.broadcast(encodeSyncUpdate(update));
  };

  private onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const { added, updated, removed } = changes;

    const announced = this.connections.get(origin as WebSocket);
    if (announced) {
      [...added, ...updated].forEach((id) => announced.add(id));
      removed.forEach((id) => announced.delete(id));
    }

    // Every connection, including the originator: y-websocket's client drops a socket
    // after 30s with no inbound message, and this echo is the heartbeat that prevents it.
    this.broadcast(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
  };
}
```

- [ ] **Step 4: Write `rooms.ts`**

`apps/ws-server/src/sync/rooms.ts`:

```ts
import { Room } from './room';

/** A room outlives its last connection briefly, so a page refresh does not wipe the document. */
export const ROOM_GRACE_MS = 30_000;

const rooms = new Map<string, Room>();
const evictions = new Map<string, NodeJS.Timeout>();

const cancelEviction = (id: string): void => {
  const pending = evictions.get(id);
  if (!pending) return;
  clearTimeout(pending);
  evictions.delete(id);
};

export const getOrCreateRoom = (id: string): Room => {
  cancelEviction(id);

  let room = rooms.get(id);
  if (!room) {
    room = new Room(id);
    room.seed(); // exactly once, before the first client syncs
    rooms.set(id, room);
  }
  return room;
};

export const releaseRoom = (room: Room, graceMs: number = ROOM_GRACE_MS): void => {
  if (room.size > 0 || evictions.has(room.id)) return;

  const timer = setTimeout(() => {
    evictions.delete(room.id);
    const current = rooms.get(room.id);
    if (current && current.size === 0) {
      rooms.delete(room.id);
      current.destroy();
    }
  }, graceMs);
  timer.unref();

  evictions.set(room.id, timer);
};

export const roomCount = (): number => rooms.size;

export const resetRooms = (): void => {
  evictions.forEach(clearTimeout);
  evictions.clear();
  rooms.forEach((room) => room.destroy());
  rooms.clear();
};
```

- [ ] **Step 5: Write `connection.ts`**

`apps/ws-server/src/sync/connection.ts`:

```ts
import type { WebSocket, RawData } from 'ws';
import { encodeAwarenessUpdate, encodeSyncStep1, handleMessage } from './protocol';
import { send, type Room } from './room';
import { releaseRoom } from './rooms';

const PING_INTERVAL_MS = 20_000;

export const setupSyncConnection = (conn: WebSocket, room: Room): void => {
  room.addConnection(conn);

  let alive = true;
  conn.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      conn.terminate();
      return;
    }
    alive = false;
    conn.ping();
  }, PING_INTERVAL_MS);

  conn.on('message', (data: RawData) => {
    try {
      // Copy element-wise. `data` is a pooled Buffer: reading its .buffer would hand us
      // the whole shared pool, not this message.
      const message = new Uint8Array(data as Buffer);
      const { reply } = handleMessage(message, room.doc, room.awareness, conn);
      if (reply) send(conn, reply);
    } catch (error) {
      console.error(`[sync] bad message in room ${room.id}:`, error);
      conn.close(1003, 'protocol error');
    }
  });

  const teardown = (): void => {
    clearInterval(heartbeat);
    room.removeConnection(conn);
    releaseRoom(room);
  };
  conn.on('close', teardown);
  conn.on('error', teardown);

  send(conn, encodeSyncStep1(room.doc));
  const known = [...room.awareness.getStates().keys()];
  if (known.length > 0) send(conn, encodeAwarenessUpdate(room.awareness, known));
};
```

- [ ] **Step 6: Write `server.ts` and `index.ts`**

`apps/ws-server/src/server.ts`:

```ts
import { type Server, createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { isValidRoomId } from '@sandbox/shared';
import { setupSyncConnection } from './sync/connection';
import { getOrCreateRoom, roomCount } from './sync/rooms';

export const createSandboxServer = (): Server => {
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

    if (prefix !== 'sync' || !isValidRoomId(roomId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (conn) => {
      setupSyncConnection(conn, getOrCreateRoom(roomId));
    });
  });

  return http;
};
```

`apps/ws-server/src/index.ts`:

```ts
import { env } from './env';
import { createSandboxServer } from './server';

createSandboxServer().listen(env.port, env.host, () => {
  console.log(`[ws-server] listening on ${env.host}:${env.port}`);
});
```

- [ ] **Step 7: Run the integration tests and watch them pass**

```bash
pnpm --filter @sandbox/ws-server test
```

Expected: 4 tests PASS. If `two clients converge` times out, the first thing to check is that awareness updates are broadcast to the originator too (Global Constraints) — without it, clients silently drop their sockets.

- [ ] **Step 8: Verify the server boots for real**

```bash
pnpm --filter @sandbox/ws-server dev
# in another shell:
curl -s http://localhost:1234/health
```

Expected: `{"ok":true,"rooms":0}`.

- [ ] **Step 9: Commit**

```bash
git add apps/ws-server
git commit -m "feat(ws-server): room registry, sync connections, http server" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Next.js app shell, landing page, and room route

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`, `apps/web/postcss.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/next-env.d.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/app/s/[roomId]/page.tsx`, `apps/web/components/Workspace.tsx`
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `isValidRoomId`, `ROOM_ID_LENGTH` from `@sandbox/shared`.
- Produces: route `/s/<roomId>`; `Workspace({ roomId }: { roomId: string })` — a `'use client'` component that later tasks fill in.

- [ ] **Step 1: Create the web package**

`apps/web/package.json`:

```json
{
  "name": "@sandbox/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.7.0",
    "@sandbox/shared": "workspace:*",
    "monaco-editor": "^0.52.2",
    "nanoid": "^5.0.9",
    "next": "^15.1.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "y-monaco": "^0.1.6",
    "y-protocols": "^1.0.6",
    "y-websocket": "^2.1.0",
    "yjs": "^13.6.21"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

Note: no `"type": "module"` — Next.js expects CommonJS semantics for its config resolution, and `.mjs` config files work regardless.

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

`apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sandbox/shared'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
```

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`apps/web/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
  resolve: { alias: { '@': root } },
});
```

- [ ] **Step 2: Create the app shell**

`apps/web/app/globals.css`:

```css
@import "tailwindcss";

html,
body {
  height: 100%;
}
```

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRDT Sandbox',
  description: 'A real-time collaborative code review sandbox.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
```

`apps/web/app/page.tsx`:

```tsx
'use client';

import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { ROOM_ID_LENGTH } from '@sandbox/shared';

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Multimodal Collaborative Sandbox</h1>
      <p className="max-w-md text-center text-neutral-400">
        Create a room, share the URL, and write code together in real time.
      </p>
      <button
        type="button"
        data-testid="create-room"
        onClick={() => router.push(`/s/${nanoid(ROOM_ID_LENGTH)}`)}
        className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
      >
        Create a sandbox
      </button>
    </main>
  );
}
```

`apps/web/app/s/[roomId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { isValidRoomId } from '@sandbox/shared';
import { Workspace } from '@/components/Workspace';

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  return <Workspace roomId={roomId} />;
}
```

`apps/web/components/Workspace.tsx` — a placeholder that Tasks 5–7 fill in:

```tsx
'use client';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold">Sandbox</span>
        <code data-testid="room-id" className="rounded bg-neutral-800 px-2 py-0.5 text-sm">
          {roomId}
        </code>
      </header>
      <main className="min-h-0 flex-1" />
    </div>
  );
}
```

- [ ] **Step 3: Add Playwright and the smoke test**

`playwright.config.ts` (repo root):

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: [
    {
      command: 'pnpm --filter @sandbox/ws-server start',
      url: 'http://localhost:1234/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @sandbox/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
```

`e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the landing page mints a room and routes to it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();

  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{10}$/);
  await expect(page.getByTestId('room-id')).toBeVisible();
});

test('an invalid room id is a 404', async ({ page }) => {
  const response = await page.goto('/s/no');
  expect(response?.status()).toBe(404);
});
```

- [ ] **Step 4: Install, then run the smoke test and watch it pass**

```bash
pnpm install
pnpm exec playwright install chromium
pnpm --filter @sandbox/shared build
pnpm test:e2e
```

Expected: 2 tests PASS. The first run compiles Next from cold — allow up to two minutes.

- [ ] **Step 5: Commit**

```bash
git add apps/web playwright.config.ts e2e package.json
git commit -m "feat(web): app shell, landing page, and room route" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---
### Task 5: Identity and the join gate

**Files:**
- Create: `apps/web/lib/identity.ts`, `apps/web/components/JoinGate.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Test: `apps/web/lib/identity.test.ts`

**Interfaces:**
- Consumes: `sanitizeName`, `MAX_NAME_LENGTH`, type `User` from `@sandbox/shared`.
- Produces: `USER_COLORS: readonly string[]`; `randomColor(rand?: () => number): string`; `loadIdentity(storage: Storage): User | null`; `saveIdentity(storage: Storage, user: User): void`; `<JoinGate onJoin={(user: User) => void}>` rendering a name form when there is no stored identity.

- [ ] **Step 1: Write the failing identity tests**

`apps/web/lib/identity.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { USER_COLORS, loadIdentity, randomColor, saveIdentity } from './identity';

const memoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
};

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

test('an identity round-trips through storage', () => {
  const user = { id: 'u1', name: 'Ada', color: '#f97316' };
  saveIdentity(storage, user);

  expect(loadIdentity(storage)).toEqual(user);
});

test('no stored identity yields null', () => {
  expect(loadIdentity(storage)).toBeNull();
});

test('corrupt or incomplete stored identities yield null rather than throwing', () => {
  storage.setItem('sandbox:identity', 'not json');
  expect(loadIdentity(storage)).toBeNull();

  storage.setItem('sandbox:identity', JSON.stringify({ name: 'Ada' }));
  expect(loadIdentity(storage)).toBeNull();
});

test('randomColor always returns a colour from the palette', () => {
  expect(USER_COLORS).toContain(randomColor(() => 0));
  expect(USER_COLORS).toContain(randomColor(() => 0.999));
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test
```

Expected: FAIL — cannot resolve `./identity`.

- [ ] **Step 3: Write `identity.ts`**

`apps/web/lib/identity.ts`:

```ts
import type { User } from '@sandbox/shared';

export const USER_COLORS = [
  '#f97316', '#22d3ee', '#a78bfa', '#34d399',
  '#f472b6', '#facc15', '#60a5fa', '#fb7185',
] as const;

const STORAGE_KEY = 'sandbox:identity';

export const randomColor = (rand: () => number = Math.random): string =>
  USER_COLORS[Math.floor(rand() * USER_COLORS.length)] ?? USER_COLORS[0];

export const loadIdentity = (storage: Storage): User | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed.id || !parsed.name || !parsed.color) return null;
    return { id: parsed.id, name: parsed.name, color: parsed.color };
  } catch {
    return null;
  }
};

export const saveIdentity = (storage: Storage, user: User): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify(user));
};
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/web test
```

Expected: 4 tests PASS.

- [ ] **Step 5: Write `JoinGate.tsx`**

`apps/web/components/JoinGate.tsx`:

```tsx
'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { MAX_NAME_LENGTH, type User, sanitizeName } from '@sandbox/shared';
import { USER_COLORS, loadIdentity, randomColor, saveIdentity } from '@/lib/identity';

export function JoinGate({ children }: { children: (user: User) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(USER_COLORS[0]);

  useEffect(() => {
    const stored = loadIdentity(window.localStorage);
    if (stored) setUser(stored);
    else setColor(randomColor());
    setReady(true);
  }, []);

  const join = (event: FormEvent) => {
    event.preventDefault();
    const clean = sanitizeName(name);
    if (!clean) return;

    const next: User = { id: crypto.randomUUID(), name: clean, color };
    saveIdentity(window.localStorage, next);
    setUser(next);
  };

  if (!ready) return null;
  if (user) return <>{children(user)}</>;

  return (
    <div className="grid h-full place-items-center p-8">
      <form
        onSubmit={join}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h2 className="text-lg font-semibold">Join the sandbox</h2>

        <label htmlFor="name" className="mt-4 block text-sm text-neutral-400">
          Display name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2"
        />

        <fieldset className="mt-4">
          <legend className="text-sm text-neutral-400">Cursor colour</legend>
          <div className="mt-2 flex gap-2">
            {USER_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Choose ${option}`}
                aria-pressed={option === color}
                onClick={() => setColor(option)}
                style={{ backgroundColor: option }}
                className={`h-7 w-7 rounded-full ${
                  option === color ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900' : ''
                }`}
              />
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!sanitizeName(name)}
          className="mt-6 w-full rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
        >
          Join sandbox
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the workspace**

`apps/web/components/Workspace.tsx`:

```tsx
'use client';

import { JoinGate } from './JoinGate';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
            <span className="font-semibold">Sandbox</span>
            <code data-testid="room-id" className="rounded bg-neutral-800 px-2 py-0.5 text-sm">
              {roomId}
            </code>
            <span className="ml-auto text-sm text-neutral-400">{user.name}</span>
          </header>
          <main className="min-h-0 flex-1" />
        </div>
      )}
    </JoinGate>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): identity and join gate" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: The room hook, connection status, and presence

The StrictMode guard lives here. Creating the `WebsocketProvider` inside a `useEffect` opens two sockets in development, and the room shows a phantom duplicate of every user.

**Files:**
- Create: `apps/web/lib/env.ts`, `apps/web/lib/yjs/room.ts`, `apps/web/lib/yjs/useRoom.ts`, `apps/web/lib/yjs/RoomContext.tsx`
- Create: `apps/web/components/ConnectionPill.tsx`, `apps/web/components/PresenceBar.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Test: `e2e/presence.spec.ts`

**Interfaces:**
- Consumes: `User`, `AwarenessState`, `DEFAULT_FILE` from `@sandbox/shared`; `JoinGate` from Task 5.
- Produces: `SYNC_URL: string`; `acquireRoom(roomId): RoomHandle`; `releaseRoom(roomId): void`; `type RoomHandle = { doc: Y.Doc; provider: WebsocketProvider; awareness: Awareness }`; `useRoom(roomId): { handle: RoomHandle | null; status: ConnectionStatus }`; `type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'`; `<RoomProvider roomId user>`, `useRoomContext(): RoomHandle`.

- [ ] **Step 1: Write the failing presence test**

`e2e/presence.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('one tab shows exactly one peer — never a StrictMode phantom', async ({ page }) => {
  await join(page, `p${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('connection-pill')).toHaveText(/connected/i);
  await expect(page.getByTestId('presence-avatar')).toHaveCount(1);
});
```

`e2e/helpers.ts`:

```ts
import { type Page, expect } from '@playwright/test';

export const join = async (page: Page, roomId: string, name: string): Promise<void> => {
  await page.goto(`/s/${roomId}`);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Join sandbox' }).click();
  await expect(page.getByTestId('connection-pill')).toHaveText(/connected/i);
};
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm test:e2e e2e/presence.spec.ts
```

Expected: FAIL — no element with test id `connection-pill`.

- [ ] **Step 3: Write the provider cache**

`apps/web/lib/env.ts`:

```ts
export const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234/sync';
```

`apps/web/lib/yjs/room.ts`:

```ts
import type { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { SYNC_URL } from '@/lib/env';

export type RoomHandle = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
};

type Entry = { handle: RoomHandle; refs: number; teardown?: ReturnType<typeof setTimeout> };

/**
 * One handle per room id, cached outside React. StrictMode mounts every effect twice in
 * development; without this cache each mount would open its own socket and every user
 * would see a phantom duplicate of themselves in the presence bar.
 */
const entries = new Map<string, Entry>();

/** Long enough to survive StrictMode's synchronous unmount/remount, short enough to free a real leave. */
const TEARDOWN_DELAY_MS = 1_000;

export const acquireRoom = (roomId: string): RoomHandle => {
  const existing = entries.get(roomId);
  if (existing) {
    if (existing.teardown) {
      clearTimeout(existing.teardown);
      existing.teardown = undefined;
    }
    existing.refs += 1;
    return existing.handle;
  }

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(SYNC_URL, roomId, doc);
  const handle: RoomHandle = { doc, provider, awareness: provider.awareness };
  entries.set(roomId, { handle, refs: 1 });
  return handle;
};

export const releaseRoom = (roomId: string): void => {
  const entry = entries.get(roomId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.teardown = setTimeout(() => {
    const current = entries.get(roomId);
    if (!current || current.refs > 0) return;
    entries.delete(roomId);
    current.handle.provider.destroy();
    current.handle.doc.destroy();
  }, TEARDOWN_DELAY_MS);
};
```

- [ ] **Step 4: Write the hook and context**

`apps/web/lib/yjs/useRoom.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { type RoomHandle, acquireRoom, releaseRoom } from './room';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const useRoom = (roomId: string) => {
  const [handle, setHandle] = useState<RoomHandle | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const acquired = acquireRoom(roomId);
    setHandle(acquired);
    setStatus(acquired.provider.wsconnected ? 'connected' : 'connecting');

    const onStatus = ({ status: next }: { status: string }) => {
      setStatus(next === 'connected' ? 'connected' : 'disconnected');
    };
    acquired.provider.on('status', onStatus);

    return () => {
      acquired.provider.off('status', onStatus);
      releaseRoom(roomId);
    };
  }, [roomId]);

  return { handle, status };
};
```

`apps/web/lib/yjs/RoomContext.tsx`:

```tsx
'use client';

import { type ReactNode, createContext, useContext, useEffect } from 'react';
import { DEFAULT_FILE, type User } from '@sandbox/shared';
import { type ConnectionStatus, useRoom } from './useRoom';
import type { RoomHandle } from './room';

const RoomContext = createContext<RoomHandle | null>(null);

export const useRoomContext = (): RoomHandle => {
  const handle = useContext(RoomContext);
  if (!handle) throw new Error('useRoomContext must be used inside <RoomProvider>');
  return handle;
};

export function RoomProvider({
  roomId,
  user,
  children,
}: {
  roomId: string;
  user: User;
  children: (status: ConnectionStatus) => ReactNode;
}) {
  const { handle, status } = useRoom(roomId);

  useEffect(() => {
    if (!handle) return;
    handle.awareness.setLocalStateField('user', user);
    handle.awareness.setLocalStateField('activeFileId', DEFAULT_FILE.id);
  }, [handle, user]);

  if (!handle) return null;

  return <RoomContext.Provider value={handle}>{children(status)}</RoomContext.Provider>;
}
```

- [ ] **Step 5: Write the presence UI**

`apps/web/components/ConnectionPill.tsx`:

```tsx
'use client';

import type { ConnectionStatus } from '@/lib/yjs/useRoom';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Offline',
};

const DOTS: Record<ConnectionStatus, string> = {
  connecting: 'bg-amber-400',
  connected: 'bg-emerald-400',
  disconnected: 'bg-rose-500',
};

export function ConnectionPill({ status }: { status: ConnectionStatus }) {
  return (
    <span
      data-testid="connection-pill"
      className="flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-300"
    >
      <span className={`h-2 w-2 rounded-full ${DOTS[status]}`} />
      {LABELS[status]}
    </span>
  );
}
```

`apps/web/components/PresenceBar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { AwarenessState } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';

export function PresenceBar() {
  const { awareness } = useRoomContext();
  const [users, setUsers] = useState<AwarenessState['user'][]>([]);

  useEffect(() => {
    const read = () => {
      const seen = new Map<string, AwarenessState['user']>();
      awareness.getStates().forEach((raw) => {
        const user = (raw as Partial<AwarenessState>).user;
        if (user) seen.set(user.id, user);
      });
      setUsers([...seen.values()]);
    };

    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);

  return (
    <div className="flex items-center -space-x-2">
      {users.map((user) => (
        <span
          key={user.id}
          data-testid="presence-avatar"
          title={user.name}
          style={{ backgroundColor: user.color }}
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-neutral-950 text-xs font-semibold text-neutral-900"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire the workspace**

`apps/web/components/Workspace.tsx`:

```tsx
'use client';

import { ConnectionPill } from './ConnectionPill';
import { JoinGate } from './JoinGate';
import { PresenceBar } from './PresenceBar';
import { RoomProvider } from '@/lib/yjs/RoomContext';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
            <div className="flex h-full flex-col">
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
              <main className="min-h-0 flex-1" />
            </div>
          )}
        </RoomProvider>
      )}
    </JoinGate>
  );
}
```

- [ ] **Step 7: Run the presence test and watch it pass**

```bash
pnpm test:e2e e2e/presence.spec.ts
```

Expected: PASS — the pill reads "Connected" and exactly **one** avatar is rendered.

- [ ] **Step 8: Commit**

```bash
git add apps/web e2e
git commit -m "feat(web): room provider, connection status, presence bar" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Monaco, bound to the CRDT

**Files:**
- Create: `apps/web/lib/monaco/setup.ts`, `apps/web/components/CodeEditor.tsx`, `apps/web/components/RemoteCursorStyles.tsx`
- Modify: `apps/web/components/Workspace.tsx`
- Test: `e2e/editor.spec.ts`

**Interfaces:**
- Consumes: `useRoomContext` (Task 6); `getFileText`, `DEFAULT_FILE`, `LANGUAGES`, `AwarenessState` from `@sandbox/shared`.
- Produces: `setupMonaco(): void`; `<CodeEditor />`; `<RemoteCursorStyles />`.

- [ ] **Step 1: Write the failing editor test**

`e2e/editor.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('the editor loads the document seeded by the server', async ({ page }) => {
  await join(page, `e${Date.now().toString(36)}`, 'Ada');

  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toContainText('fizzbuzz');
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm test:e2e e2e/editor.spec.ts
```

Expected: FAIL — no `.monaco-editor` element.

- [ ] **Step 3: Configure Monaco**

`apps/web/lib/monaco/setup.ts`:

```ts
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

let configured = false;

export const setupMonaco = (): void => {
  if (configured || typeof window === 'undefined') return;
  configured = true;

  // Monaco's language services run in workers; it throws on boot without this.
  window.MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
        );
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      );
    },
  };

  // The npm build, not the CDN: y-monaco imports `monaco-editor` directly, and two copies
  // of Monaco on one page render no remote cursors at all.
  loader.config({ monaco });
};
```

- [ ] **Step 4: Write the editor**

`apps/web/components/CodeEditor.tsx`:

```tsx
'use client';

import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEffect, useState } from 'react';
import { MonacoBinding } from 'y-monaco';
import { DEFAULT_FILE, LANGUAGES, getFileText } from '@sandbox/shared';
import { setupMonaco } from '@/lib/monaco/setup';
import { useRoomContext } from '@/lib/yjs/RoomContext';

setupMonaco();

export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);

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
      loading={<div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>}
    />
  );
}
```

- [ ] **Step 5: Write the remote cursor styles**

`y-monaco` decorates remote selections with `yRemoteSelection-<clientID>` and `yRemoteSelectionHead-<clientID>` and leaves the colours to us.

`apps/web/components/RemoteCursorStyles.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { AwarenessState } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';

export function RemoteCursorStyles() {
  const { awareness } = useRoomContext();
  const [css, setCss] = useState('');

  useEffect(() => {
    const render = () => {
      const rules: string[] = [];

      awareness.getStates().forEach((raw, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = (raw as Partial<AwarenessState>).user;
        if (!user) return;

        // `user.name` is sanitized at the join gate; it cannot close this CSS string.
        rules.push(`
.yRemoteSelection-${clientId} { background-color: ${user.color}59; }
.yRemoteSelectionHead-${clientId} {
  position: absolute; box-sizing: border-box; height: 100%;
  border-left: 2px solid ${user.color};
}
.yRemoteSelectionHead-${clientId}::after {
  content: '${user.name}'; position: absolute; left: -2px; top: -1.4em;
  padding: 0 4px; font-size: 11px; line-height: 1.4em; white-space: nowrap;
  border-radius: 3px 3px 3px 0; color: #0a0a0a; background-color: ${user.color};
}`);
      });

      setCss(rules.join('\n'));
    };

    render();
    awareness.on('change', render);
    return () => awareness.off('change', render);
  }, [awareness]);

  return <style>{css}</style>;
}
```

- [ ] **Step 6: Mount them, client-side only**

`apps/web/components/Workspace.tsx` — replace the empty `<main>` and add the dynamic import:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { ConnectionPill } from './ConnectionPill';
import { JoinGate } from './JoinGate';
import { PresenceBar } from './PresenceBar';
import { RemoteCursorStyles } from './RemoteCursorStyles';
import { RoomProvider } from '@/lib/yjs/RoomContext';

// Monaco touches `window` at module scope and cannot be server-rendered.
const CodeEditor = dynamic(() => import('./CodeEditor').then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>,
});

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
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
              <main className="min-h-0 flex-1">
                <CodeEditor />
              </main>
            </div>
          )}
        </RoomProvider>
      )}
    </JoinGate>
  );
}
```

- [ ] **Step 7: Verify Monaco actually bundles before going further**

This is the riskiest integration in the plan — stop here and look at it with your own eyes:

```bash
pnpm dev
# open http://localhost:3000, create a sandbox, join, and check the browser console
```

Expected: the editor renders with the seeded FizzBuzz, typing works, and **the console is clean**.

If the build fails on Monaco's CSS or the workers, the fallback is to drop `loader.config({ monaco })` and the `monaco-editor` import, let `@monaco-editor/react` load Monaco from its CDN, and replace `y-monaco` with a hand-written binding over the `monaco` instance handed to `onMount` (observe the `Y.Text` delta → `model.applyEdits`; `model.onDidChangeContent` → `ytext.insert`/`delete`, guarded by a re-entrancy flag). Do not run both Monaco copies at once — that is the one configuration guaranteed to fail silently.

- [ ] **Step 8: Run the editor test and watch it pass**

```bash
pnpm test:e2e e2e/editor.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web e2e
git commit -m "feat(web): Monaco bound to the CRDT with remote cursors" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: The two-person collaboration test, and the README

This is the test that proves Phase 1: it is the acceptance criterion, not a formality.

**Files:**
- Create: `e2e/collaboration.spec.ts`, `README.md`
- Test: `e2e/collaboration.spec.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing collaboration test**

Two **browser contexts**, not two tabs — contexts are isolated, so nothing can sync through `BroadcastChannel` behind the server's back and give a false pass.

`e2e/collaboration.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('two people edit one document and see each other', async ({ browser }) => {
  const roomId = `c${Date.now().toString(36)}`;

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  // Both tabs see both people — and neither sees a duplicate of itself.
  await expect(alice.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(bob.getByTestId('presence-avatar')).toHaveCount(2);

  // Alice types; Bob sees it.
  await alice.locator('.monaco-editor').click();
  await alice.keyboard.press('ControlOrMeta+A');
  await alice.keyboard.type('alicewashere');
  await expect(bob.locator('.monaco-editor')).toContainText('alicewashere');

  // Bob types; Alice sees it, and Bob's cursor is rendered in Alice's editor.
  await bob.locator('.monaco-editor').click();
  await bob.keyboard.press('End');
  await bob.keyboard.type('_and_bob');
  await expect(alice.locator('.monaco-editor')).toContainText('alicewashere_and_bob');
  await expect(alice.locator('[class*="yRemoteSelectionHead"]').first()).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
```

- [ ] **Step 2: Run it**

```bash
pnpm test:e2e e2e/collaboration.spec.ts
```

Expected: PASS. If the cursor assertion fails but the text assertions pass, the binding is working and the *decoration* is not — check that `RemoteCursorStyles` is mounted and that only one copy of Monaco is in the bundle.

- [ ] **Step 3: Run the whole suite**

```bash
pnpm test
pnpm typecheck
pnpm test:e2e
```

Expected: all green. Fix anything that is not before writing the README — a README that describes software whose tests fail is a lie.

- [ ] **Step 4: Write the README**

`README.md`:

```markdown
# Multimodal Collaborative Code Review Sandbox

A zero-install web workspace where several people edit code together, draw architecture
directly over that code, and run it — seeing the same output at the same moment.

**Status:** Phase 1 of 5 complete — real-time collaborative editing.
See `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` for the full design.

## What works today

- A room is a URL. Open `/`, click *Create a sandbox*, share the link.
- Everyone in the room edits one document, synced by a Yjs CRDT over WebSockets.
- Remote cursors, selections, and a presence bar with names and colours.
- Edits made while offline merge cleanly on reconnect — that is the CRDT, not a retry queue.

## Architecture

- `apps/web` — Next.js 15, Monaco, bound to a `Y.Text` by `y-monaco`.
- `apps/ws-server` — Node + `ws`, speaking the Yjs sync protocol directly. It relays and
  merges the document; it never inspects its contents.
- `packages/shared` — the Y.Doc schema and every type that crosses the wire.

## Running it

```bash
pnpm install
pnpm dev          # web on :3000, sync server on :1234
```

Open two browser windows on the same `/s/<roomId>` URL.

## Tests

```bash
pnpm test         # unit + server integration (Vitest)
pnpm test:e2e     # two real browsers, editing one document (Playwright)
```

## Not built yet

Shared code execution (Phase 2), the overlay drawing canvas (Phase 3), persistence and
multi-file (Phase 4), line-anchored annotations and deployment (Phase 5).
```

- [ ] **Step 5: Commit**

```bash
git add e2e README.md
git commit -m "test(e2e): two-person collaboration, and the README" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 0 + 1 rows of §11).** Monorepo and both apps booting from one command → Task 1, 4. `useRoom` hook and the StrictMode guard → Task 6. Y.Doc schema, multi-file-ready → Task 1. `/sync` relay → Tasks 2, 3. Monaco + `y-monaco` → Task 7. Awareness cursors and selection highlights → Tasks 6, 7. Join modal → Task 5. Room URLs → Task 4. Connection pill → Task 6. Convergence test → Task 3. Two-browser E2E → Task 8. Nothing in the Phase 0/1 rows is unassigned.

**Deliberate deferrals, each with a home.** The "waking the sandbox…" copy for Render's cold start is Phase 5 (there is nothing to wake locally). Persistence is Phase 4, so a room still dies 30 s after the last person leaves — stated in Global Constraints so it is not mistaken for a bug. Strokes, runs, and file tabs exist in the schema and in no UI, by design.

**One knowing deviation from the spec.** §4.2 lists `cursor` and `selection` on `AwarenessState`. `y-monaco` writes a `selection` field itself, encoded as Yjs *relative positions* — strictly better than line/column, because relative positions survive concurrent edits. We therefore do not hand-roll those fields, and `AwarenessState` carries `user`, `activeFileId`, and `pointer` only. The spec's intent (awareness carries cursors and selections) holds.

## Later Phases

Phases 2–5 each produce working software on their own and get their own plan, written when we
reach them, against the code that actually exists rather than the code I imagine now:

- **Phase 2 — Shared execution.** `/exec` channel, `CodeExecutor` + Piston adapter, token-bucket limiter, xterm.js.
- **Phase 3 — Overlay canvas.** SVG layer, content-space coordinates, mode toggle, `perfect-freehand`.
- **Phase 4 — Persistence + multi-file.** Neon Postgres, debounced flush, file tabs.
- **Phase 5 — Anchors, polish, deploy.** Yjs relative-position anchors, Netlify + Render + Neon.
