# Phase 4b — Multi-file tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room holds many files. Create, rename, delete, and switch tabs; each file has its own text and its own drawings; the language follows the filename's extension; Run executes the active file.

**Architecture:** Almost pure activation — the Y.Doc schema has been multi-file since Phase 1 (`files` map, `file:<id>` text, `Stroke.fileId`, `AwarenessState.activeFileId`). Three new doc operations (`createFile`/`renameFile`/`deleteFile`) join the existing ones; `FileMeta.language` is deleted in favour of `languageForName(name)`, making the name/language invariant unbreakable. A client-local `ActiveFileContext` drives a `FileTabs` strip, and `CodeEditor` keeps exactly one `MonacoBinding` alive — to the active file.

**Tech Stack:** Everything from Phases 1–4a. No new dependencies.

Spec: `Docs/superpowers/specs/2026-07-17-phase-4b-multi-file-design.md`.
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.4, §11 row 4).

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` server stays a **pure relay**. Every operation in this phase is a client-side Y.Doc write; **no ws-server source changes at all**. Persistence (4a) stores an opaque blob and picks up new files for free.
- **The extension is the single source of truth for language.** `FileMeta.language` is deleted, not deprecated. There must be no second field that can disagree with the name.
- **`SCHEMA_VERSION` stays at `1`.** No stored byte changes — we stop *reading* a field. Do not bump it.
- **Run stays single-file.** `RunRequest` is unchanged; it sends the active file. Do not add `files[]`, entry points, or Piston multi-file support.
- **`activeFileId` is client-local**, never written to the Y.Doc. It *is* published to awareness.
- **Uniqueness of filenames is a UI guard, not a doc invariant.** Never auto-rename a file in response to observing a duplicate — that is a write-back race.
- **A Yjs root type cannot be removed.** `deleteFile` clears text content; the empty root type remains. Do not attempt to delete it.
- **`AwarenessState.pointer` is dead** (nothing writes it). Leave it alone; do not add a filter for it.
- Tests gated on `DATABASE_URL` are part of done. `pnpm db:up` boots a local Postgres. Run them.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

```text
packages/shared/src/
  model.ts                        MOD  + languageForName, EXTENSION_TO_LANGUAGE, validateFileName,
                                       MAX_FILE_NAME_LENGTH; − FileMeta.language, − DEFAULT_FILE.language
  model.test.ts                   MOD  + languageForName / validateFileName tests
  doc.ts                          MOD  + createFile, renameFile, deleteFile; − setFileLanguage
  doc.test.ts                     MOD  + file-op tests incl. stroke cascade; − setFileLanguage tests

apps/web/
  lib/yjs/useFiles.ts             NEW  observes `files`, returns FileMeta[]
  lib/files/ActiveFileContext.tsx NEW  client-local activeFileId + deleted-file fallback
  components/FileTabs.tsx         NEW  the strip: switch, +, inline rename, × + confirm
  components/CodeEditor.tsx       MOD  activeFileId → useFile/binding/path; publish activeFileId
  components/CanvasOverlay.tsx    MOD  useStrokes(activeFileId); strokes + draft filter carry it
  components/RunBar.tsx           MOD  active file; picker → renameFile; disable Run on no runtime
  components/Workspace.tsx        MOD  mount ActiveFileProvider + FileTabs
  lib/exec/ExecContext.tsx        MOD  run the active file; languageForName
  lib/yjs/RoomContext.tsx         MOD  − hardcoded activeFileId write

apps/ws-server/test/
  multifile.test.ts               NEW  two Yjs clients: concurrent create/rename/delete converge

e2e/
  multifile.spec.ts               NEW  tabs across two browsers; per-file strokes; rename; Run
  persistence.spec.ts             MOD  a second file + its drawing survive reopen (gated)
README.md                         MOD
```

**Task order rationale.** Tasks 1–2 are purely additive, so the suite stays green. Task 3 is the one breaking change (dropping `FileMeta.language`) and updates every consumer in a single commit, so no commit has a failing typecheck. Tasks 4–6 build the UI on top. Components keep using `DEFAULT_FILE.id` until Task 6 swaps it for `activeFileId`, which keeps each task independently green.

---

### Task 1: `languageForName` and `validateFileName`

Purely additive to `model.ts`. Nothing is removed yet, so the whole suite stays green.

**Files:**
- Modify: `packages/shared/src/model.ts`
- Test: `packages/shared/src/model.test.ts`

**Interfaces:**
- Consumes: the existing `LANGUAGES` table and `LanguageId` type in `model.ts`.
- Produces:
  - `EXTENSION_TO_LANGUAGE: Record<string, LanguageId>`
  - `languageForName(name: string): LanguageId | undefined`
  - `MAX_FILE_NAME_LENGTH = 32`
  - `validateFileName(name: string, existingNames: string[]): string | null` — returns an error message, or `null` when valid.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/model.test.ts`:

```ts
import { MAX_FILE_NAME_LENGTH, languageForName, validateFileName } from './model.js';

test('languageForName derives the language from the extension', () => {
  expect(languageForName('main.py')).toBe('python');
  expect(languageForName('main.js')).toBe('javascript');
  expect(languageForName('main.ts')).toBe('typescript');
  expect(languageForName('MAIN.PY')).toBe('python'); // extensions are case-insensitive
  expect(languageForName('a.b.py')).toBe('python');  // only the last dot counts
});

test('languageForName returns undefined when there is no runtime', () => {
  expect(languageForName('notes.txt')).toBeUndefined();
  expect(languageForName('Makefile')).toBeUndefined(); // no dot at all
  expect(languageForName('.py')).toBeUndefined();      // a dotfile named .py, not a Python file
});

test('validateFileName accepts a plain name', () => {
  expect(validateFileName('utils.py', ['main.py'])).toBeNull();
});

test('validateFileName rejects empty, oversized, and path-ish names', () => {
  expect(validateFileName('', [])).toMatch(/empty/i);
  expect(validateFileName('   ', [])).toMatch(/empty/i);
  expect(validateFileName(`${'a'.repeat(MAX_FILE_NAME_LENGTH)}.py`, [])).toMatch(/too long/i);
  expect(validateFileName('src/utils.py', [])).toMatch(/\//);
  expect(validateFileName('src\\utils.py', [])).toMatch(/\\/);
  expect(validateFileName('../secrets.py', [])).toMatch(/\//);
});

test('validateFileName rejects a name already taken', () => {
  expect(validateFileName('main.py', ['main.py'])).toMatch(/already/i);
  // Case-insensitive: two tabs reading main.py and MAIN.PY is the same confusion.
  expect(validateFileName('MAIN.PY', ['main.py'])).toMatch(/already/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox/shared test`
Expected: FAIL — `languageForName is not a function` / `validateFileName is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/shared/src/model.ts` (after the existing `LANGUAGES` block):

```ts
/** Derived from LANGUAGES so the two can never disagree. */
export const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = Object.fromEntries(
  Object.entries(LANGUAGES).map(([id, { extension }]) => [extension, id as LanguageId]),
);

/**
 * The filename is the single source of truth for the language: Piston keys off the extension,
 * so a `main.py` holding TypeScript will not compile. `undefined` is not an error — the file
 * edits and syncs fine; it simply has no runtime, and Run is disabled for it.
 *
 * `dot > 0`, not `>= 0`, matches renameExtension: `.py` is a dotfile whose stem is `.py`,
 * not a Python file with an empty name.
 */
export const languageForName = (name: string): LanguageId | undefined => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return EXTENSION_TO_LANGUAGE[name.slice(dot).toLowerCase()];
};

export const MAX_FILE_NAME_LENGTH = 32;

/**
 * Guards the create/rename UI. Returns an error message, or null when the name is usable.
 *
 * Uniqueness here is a UI guard and cannot be a doc invariant: two peers renaming concurrently
 * both see a free name and both write. That duplicate is tolerated (files are keyed by id, so
 * it is cosmetic) — see the spec §5.3. Never auto-rename to resolve one.
 */
export const validateFileName = (name: string, existingNames: string[]): string | null => {
  const trimmed = name.trim();

  if (!trimmed) return 'Name cannot be empty';
  if (trimmed.length > MAX_FILE_NAME_LENGTH) return `Name is too long (max ${MAX_FILE_NAME_LENGTH})`;
  if (trimmed.includes('/') || trimmed.includes('..')) return 'Name cannot contain / or ..';
  if (trimmed.includes('\\')) return 'Name cannot contain \\';

  const taken = existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());
  return taken ? 'That name is already taken' : null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sandbox/shared test`
Expected: PASS — all new tests green, existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/model.ts packages/shared/src/model.test.ts
git commit -m "feat(shared): derive language from the filename, and validate names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `createFile`, `renameFile`, `deleteFile`

Additive to `doc.ts`. `setFileLanguage` still exists after this task; Task 3 removes it.

**Files:**
- Modify: `packages/shared/src/doc.ts`
- Test: `packages/shared/src/doc.test.ts`

**Interfaces:**
- Consumes: `getFilesMap`, `getFileText`, `getStrokes` from `doc.ts`; `FileMeta` from `model.ts`.
- Produces:
  - `createFile(doc: Y.Doc, name: string, id: string): string` — returns `id`. **The id is the caller's**, exactly as `appendStroke` takes a caller-built `Stroke`. See Step 3 for why this is not optional.
  - `renameFile(doc: Y.Doc, fileId: string, name: string): void`
  - `deleteFile(doc: Y.Doc, fileId: string): void`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/doc.test.ts`:

```ts
import { createFile, deleteFile, renameFile } from './doc.js';

const stroke = (id: string, fileId: string): Stroke => ({
  id,
  fileId,
  authorId: 'u1',
  color: '#ff0000',
  width: 3,
  shape: { kind: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
  createdAt: 1,
});

test('createFile adds an empty file and returns its id', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  const id = createFile(doc, 'utils.py', 'f2');

  expect(id).toBe('f2');
  expect(listFiles(doc).map((f) => f.name)).toEqual(['main.py', 'utils.py']);
  expect(getFileText(doc, 'f2').toString()).toBe('');
});

test('renameFile changes only the name — the id and text are untouched', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const id = createFile(doc, 'utils.py', 'f2');
  getFileText(doc, id).insert(0, 'x = 1');

  renameFile(doc, id, 'helpers.js');

  expect(getFilesMap(doc).get(id)?.name).toBe('helpers.js');
  expect(getFilesMap(doc).get(id)?.id).toBe('f2');
  expect(getFileText(doc, id).toString()).toBe('x = 1');
});

test('deleteFile removes the file, its text, and only its strokes', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const id = createFile(doc, 'utils.py', 'f2');
  getFileText(doc, id).insert(0, 'doomed');

  appendStroke(doc, stroke('s-main', DEFAULT_FILE.id));
  appendStroke(doc, stroke('s-utils', 'f2'));

  deleteFile(doc, id);

  expect(listFiles(doc).map((f) => f.id)).toEqual([DEFAULT_FILE.id]);
  expect(getFileText(doc, id).toString()).toBe('');
  // The cascade is exact: main.py's stroke survives.
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s-main']);
});

test('deleteFile is a no-op on an unknown id, so concurrent deletes are safe', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(() => deleteFile(doc, 'ghost')).not.toThrow();
  expect(listFiles(doc)).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox/shared test`
Expected: FAIL — `createFile is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/shared/src/doc.ts`:

```ts
/**
 * Ids are generated, never derived from the name: a rename is then metadata-only, and two
 * concurrent creates cannot collide on an id.
 *
 * The id is the caller's, like `appendStroke`'s. This package's `lib` is `ES2022` and nothing
 * else — no DOM, no @types/node — so `crypto` does not exist here to call. That is deliberate
 * and load-bearing (see `byteLength` in exec.ts): an isomorphic package that could reach for
 * `crypto` could equally reach for `document` or `process`. The web app generates the id, where
 * `crypto.randomUUID` is real; tests pass a literal, which makes them deterministic for free.
 */
export const createFile = (doc: Y.Doc, name: string, id: string): string => {
  doc.transact(() => {
    getFilesMap(doc).set(id, { id, name, createdAt: Date.now() });
    getFileText(doc, id); // bring the text type into existence, empty
  });
  return id;
};

/** The only write. The language follows from the name by derivation — there is nothing else to set. */
export const renameFile = (doc: Y.Doc, fileId: string, name: string): void => {
  const files = getFilesMap(doc);
  const file = files.get(fileId);
  if (!file) return;

  files.set(fileId, { ...file, name });
};

/**
 * Cascades in one transaction: metadata, text, and every stroke on this file.
 *
 * A Yjs root type cannot be removed from a document — there is no `doc.delete(key)` — so the
 * text can only be emptied. The empty `file:<id>` type stays in the doc and is re-encoded into
 * every future persisted blob. That leak is accepted (spec §3.4); a room is disposable and has
 * a 30-day TTL.
 */
export const deleteFile = (doc: Y.Doc, fileId: string): void => {
  const files = getFilesMap(doc);
  if (!files.has(fileId)) return;

  doc.transact(() => {
    files.delete(fileId);

    const text = getFileText(doc, fileId);
    text.delete(0, text.length);

    const strokes = getStrokes(doc);
    // Back to front: deleting shifts the indices of everything after it.
    const list = strokes.toArray();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.fileId === fileId) strokes.delete(i, 1);
    }
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sandbox/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/doc.ts packages/shared/src/doc.test.ts
git commit -m "feat(shared): create, rename, and delete files

deleteFile cascades to the file's strokes. It cannot remove the text's
root type — Yjs has no doc.delete(key) — so it empties it and leaves an
empty type behind, which every future blob re-encodes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Delete `FileMeta.language` — the extension is the only truth

The one breaking change. `FileMeta.language` and `setFileLanguage` go, and every consumer is updated **in this same commit** so no commit has a failing typecheck.

Components still address `DEFAULT_FILE.id` after this task — Task 6 swaps that for `activeFileId`.

**Files:**
- Modify: `packages/shared/src/model.ts` (drop `language` from `FileMeta` and `DEFAULT_FILE`)
- Modify: `packages/shared/src/doc.ts` (drop `setFileLanguage`)
- Modify: `packages/shared/src/doc.test.ts` (drop its `setFileLanguage` tests)
- Modify: `apps/web/lib/exec/ExecContext.tsx`, `apps/web/components/RunBar.tsx`, `apps/web/components/CodeEditor.tsx`

**Interfaces:**
- Consumes: `languageForName` from Task 1; `renameFile` from Task 2.
- Produces: `FileMeta = { id: string; name: string; createdAt: number }` — no `language`. `setFileLanguage` no longer exists.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/doc.test.ts`:

```ts
test('a file carries no language field — the name is the only source of truth', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  const file = getFilesMap(doc).get(DEFAULT_FILE.id)!;
  expect(file).not.toHaveProperty('language');
  expect(languageForName(file.name)).toBe('python');
});

test('renaming a file changes its language, with no second write', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  renameFile(doc, DEFAULT_FILE.id, 'main.js');

  expect(languageForName(getFilesMap(doc).get(DEFAULT_FILE.id)!.name)).toBe('javascript');
});
```

Add `languageForName` to the `./model.js` import in `doc.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox/shared test`
Expected: FAIL — `expected { … language: 'python' } not to have property "language"`.

- [ ] **Step 3: Write the implementation**

In `packages/shared/src/model.ts` — drop the field and the seed's value:

```ts
export type FileMeta = {
  id: string;
  name: string;
  createdAt: number;
};
```

```ts
export const DEFAULT_FILE: FileMeta = {
  id: 'main',
  name: 'main.py',
  createdAt: 0, // deterministic: a timestamp here would differ per seeder
};
```

In `packages/shared/src/doc.ts` — delete `setFileLanguage` entirely (the whole function and its doc comment), and drop `LANGUAGES`, `renameExtension`, and `LanguageId` from its import list if nothing else uses them.

In `packages/shared/src/doc.test.ts` — delete the `setFileLanguage` tests and its import. Also drop the
stale `language: 'javascript'` key from the raw object literal in the existing "listFiles is ordered by
creation time" test: the shared tsconfig excludes `*.test.ts`, so nothing would catch it, and a test
asserting the old shape is a lie waiting for the next reader.

In `apps/web/lib/exec/ExecContext.tsx` — derive the language, and refuse to send a run with no runtime:

```ts
import { DEFAULT_FILE, type User, getFileText, getFilesMap, languageForName } from '@sandbox/shared';
```

```ts
  const runActiveFile = useCallback(() => {
    const file = getFilesMap(doc).get(DEFAULT_FILE.id);
    if (!file) return;

    // No runtime for this extension — the button is disabled, and this is the same guard
    // one layer down, so a keyboard shortcut cannot route around it.
    const language = languageForName(file.name);
    if (!language) return;

    // The snapshot the presser currently sees. The server never reads the CRDT.
    socket.current?.send({
      type: 'run',
      byUser: user,
      fileName: file.name,
      language,
      code: getFileText(doc, DEFAULT_FILE.id).toString(),
      stdin,
    });
  }, [doc, stdin, user]);
```

In `apps/web/components/RunBar.tsx` — the picker becomes a rename shortcut, and Run states its reason:

```tsx
'use client';

import {
  DEFAULT_FILE,
  LANGUAGES,
  type LanguageId,
  MAX_STDIN_BYTES,
  languageForName,
  renameExtension,
  renameFile,
} from '@sandbox/shared';
import { useExecContext } from '@/lib/exec/ExecContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

export function RunBar() {
  const { doc } = useRoomContext();
  const { runActiveFile, isRunning, status, stdin, setStdin } = useExecContext();
  const file = useFile(DEFAULT_FILE.id);

  const language = file ? languageForName(file.name) : undefined;
  const offline = status !== 'connected';
  const disabled = offline || isRunning || !file || !language;

  const label = offline ? 'Offline' : isRunning ? 'Running…' : 'Run';
  const title = !language && file ? `No runtime for ${file.name}` : 'Ctrl/Cmd + Enter';

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
      <code className="text-sm text-neutral-400">{file?.name ?? '—'}</code>

      {/* One write path: picking a language renames the file, and the language derives from that. */}
      <select
        aria-label="Language"
        value={language ?? ''}
        disabled={!file}
        onChange={(event) =>
          file &&
          renameFile(
            doc,
            file.id,
            renameExtension(file.name, LANGUAGES[event.target.value as LanguageId].extension),
          )
        }
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        {!language && <option value="">—</option>}
        {Object.entries(LANGUAGES).map(([id, lang]) => (
          <option key={id} value={id}>
            {lang.label}
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
        title={title}
        className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        ▶ {label}
      </button>
    </div>
  );
}
```

In `apps/web/components/CodeEditor.tsx` — the language effect derives from the name, and the fallback for an unknown extension is plaintext:

```tsx
import { DEFAULT_FILE, LANGUAGES, getFileText, languageForName } from '@sandbox/shared';
```

```tsx
  // A rename is a Y.Doc write, so it arrives here for everyone, not just the renamer.
  useEffect(() => {
    const model = instance?.getModel();
    if (!monaco || !model || !file) return;

    const language = languageForName(file.name);
    monaco.editor.setModelLanguage(model, language ? LANGUAGES[language].monaco : 'plaintext');
  }, [instance, monaco, file]);
```

and its `<Editor>` prop:

```tsx
        defaultLanguage="python"
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — all tests green, typecheck clean. A `language` reference left anywhere fails the typecheck, which is how you find it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/web
git commit -m "refactor(shared): the extension is the only source of truth for language

FileMeta.language is deleted rather than deprecated: a second field is a
second thing to disagree with the name, and Piston keys off the extension.
The picker becomes a rename shortcut, so there is one write path.

Rooms persisted by 4a keep a stale language key inside their FileMeta. It
is inert — we stop reading it — so SCHEMA_VERSION stays at 1. Bumping it
would advertise a migration that does not exist.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `useFiles` and `ActiveFileContext`

The state behind the strip. No UI yet.

**Files:**
- Create: `apps/web/lib/yjs/useFiles.ts`
- Create: `apps/web/lib/files/ActiveFileContext.tsx`

**Interfaces:**
- Consumes: `listFiles` from `@sandbox/shared`; `useRoomContext` from `@/lib/yjs/RoomContext`.
- Produces:
  - `useFiles(): FileMeta[]` — creation-ordered, live.
  - `<ActiveFileProvider>{children}</ActiveFileProvider>`
  - `useActiveFile(): { activeFileId: string; setActiveFileId: (id: string) => void }`

- [ ] **Step 1: Write `useFiles`**

`apps/web/lib/yjs/useFiles.ts` — the same observe/re-read shape as the existing `useFile` and `useStrokes`:

```ts
'use client';

import { useEffect, useState } from 'react';
import type { FileMeta } from '@sandbox/shared';
import { getFilesMap, listFiles } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** Every file in the room, creation-ordered, re-read whenever anyone adds, renames, or deletes one. */
export const useFiles = (): FileMeta[] => {
  const { doc } = useRoomContext();
  const [files, setFiles] = useState<FileMeta[]>(() => listFiles(doc));

  useEffect(() => {
    const map = getFilesMap(doc);
    const read = () => setFiles(listFiles(doc));

    read();
    map.observe(read);
    return () => map.unobserve(read);
  }, [doc]);

  return files;
};
```

- [ ] **Step 2: Write `ActiveFileContext`**

`apps/web/lib/files/ActiveFileContext.tsx`:

```tsx
'use client';

import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_FILE } from '@sandbox/shared';
import { useFiles } from '@/lib/yjs/useFiles';

type ActiveFileContextValue = {
  activeFileId: string;
  setActiveFileId: (id: string) => void;
};

const ActiveFileContext = createContext<ActiveFileContextValue | null>(null);

export const useActiveFile = (): ActiveFileContextValue => {
  const value = useContext(ActiveFileContext);
  if (!value) throw new Error('useActiveFile must be used inside <ActiveFileProvider>');
  return value;
};

/**
 * Which tab you are on is yours, not the room's — this is deliberately client-local state and
 * never a Y.Doc write. Putting it in the doc would mean one person's tab click moves everyone
 * else's editor.
 */
export function ActiveFileProvider({ children }: { children: ReactNode }) {
  const files = useFiles();
  const [activeFileId, setActiveFileId] = useState<string>(DEFAULT_FILE.id);

  // Someone else deleted the file you were on: fall back to the leftmost survivor.
  useEffect(() => {
    if (files.length === 0) return;
    if (!files.some((file) => file.id === activeFileId)) setActiveFileId(files[0]!.id);
  }, [files, activeFileId]);

  const value = useMemo(() => ({ activeFileId, setActiveFileId }), [activeFileId]);

  return <ActiveFileContext.Provider value={value}>{children}</ActiveFileContext.Provider>;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Nothing consumes these yet — Task 6 wires them in.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/yjs/useFiles.ts apps/web/lib/files/ActiveFileContext.tsx
git commit -m "feat(web): useFiles, and client-local active-file state

Which tab you are on is yours, not the room's, so activeFileId is React
state and never a doc write. If the file you are on is deleted under you,
you fall back to the leftmost survivor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: The `FileTabs` strip

Switch, create, rename, delete. Not mounted yet — Task 6 mounts it.

**Files:**
- Create: `apps/web/components/FileTabs.tsx`

**Interfaces:**
- Consumes: `useFiles` and `useActiveFile` (Task 4); `createFile`, `renameFile`, `deleteFile` (Task 2); `validateFileName` (Task 1); `getStrokes` from `@sandbox/shared`.
- Produces: `<FileTabs />`. Test ids: `file-tab` (each tab), `file-tab-<id>`, `new-file`, `rename-file`, `delete-file`, `file-name-input`.

- [ ] **Step 1: Write the component**

`apps/web/components/FileTabs.tsx`:

```tsx
'use client';

import { createFile, deleteFile, getStrokes, renameFile, validateFileName } from '@sandbox/shared';
import { useState } from 'react';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFiles } from '@/lib/yjs/useFiles';

export function FileTabs() {
  const { doc } = useRoomContext();
  const files = useFiles();
  const { activeFileId, setActiveFileId } = useActiveFile();

  // The id being renamed, or 'new' while creating. One input serves both.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startCreate = () => {
    setEditing('new');
    setDraftName('');
    setError(null);
  };

  const startRename = (id: string, name: string) => {
    setEditing(id);
    setDraftName(name);
    setError(null);
  };

  const commit = () => {
    if (!editing) return;

    // A rename must not collide with itself.
    const others = files.filter((file) => file.id !== editing).map((file) => file.name);
    const problem = validateFileName(draftName, others);
    if (problem) {
      setError(problem);
      return;
    }

    const name = draftName.trim();
    // The id is generated here, not in @sandbox/shared — that package has no `crypto`.
    if (editing === 'new') setActiveFileId(createFile(doc, name, crypto.randomUUID()));
    else renameFile(doc, editing, name);

    setEditing(null);
    setError(null);
  };

  const remove = (id: string, name: string) => {
    // Deletion destroys someone else's text and annotations, and a CRDT cannot make that safe.
    // The confirm is the guard, and the stroke count is the part people do not expect.
    const strokes = getStrokes(doc).toArray().filter((stroke) => stroke.fileId === id).length;
    const drawings = strokes === 1 ? '1 drawing' : `${strokes} drawings`;
    const warning = `Delete ${name}? Its text and ${drawings} are gone for everyone.`;

    if (window.confirm(warning)) deleteFile(doc, id);
  };

  return (
    <div className="flex items-center gap-1 border-b border-neutral-800 px-4 py-1">
      {files.map((file) => {
        const active = file.id === activeFileId;

        if (editing === file.id) {
          return <NameInput key={file.id} {...{ draftName, setDraftName, commit, setEditing, error }} />;
        }

        return (
          <div
            key={file.id}
            data-testid="file-tab"
            className={`group flex items-center gap-1 rounded-t-md px-3 py-1 text-sm ${
              active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <button
              type="button"
              data-testid={`file-tab-${file.id}`}
              onClick={() => setActiveFileId(file.id)}
              onDoubleClick={() => startRename(file.id, file.name)}
              title="Double-click to rename"
            >
              {file.name}
            </button>

            {active && (
              <button
                type="button"
                data-testid="rename-file"
                aria-label={`Rename ${file.name}`}
                onClick={() => startRename(file.id, file.name)}
                className="text-neutral-500 hover:text-neutral-200"
              >
                ✎
              </button>
            )}

            <button
              type="button"
              data-testid="delete-file"
              aria-label={`Delete ${file.name}`}
              // A room with no files has no editor to render and no way back.
              disabled={files.length === 1}
              onClick={() => remove(file.id, file.name)}
              className="text-neutral-500 hover:text-red-400 disabled:invisible"
            >
              ×
            </button>
          </div>
        );
      })}

      {editing === 'new' && (
        <NameInput {...{ draftName, setDraftName, commit, setEditing, error }} />
      )}

      <button
        type="button"
        data-testid="new-file"
        aria-label="New file"
        onClick={startCreate}
        className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
      >
        +
      </button>
    </div>
  );
}

function NameInput({
  draftName,
  setDraftName,
  commit,
  setEditing,
  error,
}: {
  draftName: string;
  setDraftName: (value: string) => void;
  commit: () => void;
  setEditing: (value: string | null) => void;
  error: string | null;
}) {
  return (
    <div className="relative">
      <input
        aria-label="File name"
        data-testid="file-name-input"
        autoFocus
        value={draftName}
        placeholder="name.py"
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(null);
        }}
        onBlur={commit}
        className="w-32 rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 text-sm text-white"
      />
      {error && (
        <p role="alert" className="absolute left-0 top-full z-10 whitespace-nowrap rounded bg-red-950 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/FileTabs.tsx
git commit -m "feat(web): the file tab strip

Delete confirms and names the stroke count, because losing someone's
annotations to a misclick is the realistic failure. The last file cannot
be deleted: a room with no files has no editor and no way back.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the active file through the editor, canvas, and Run

Every remaining `DEFAULT_FILE.id` in the web app becomes `activeFileId`. This is the task that makes the feature real.

**Files:**
- Modify: `apps/web/components/Workspace.tsx`, `CodeEditor.tsx`, `CanvasOverlay.tsx`, `RunBar.tsx`
- Modify: `apps/web/lib/exec/ExecContext.tsx`, `apps/web/lib/yjs/RoomContext.tsx`

**Interfaces:**
- Consumes: `useActiveFile` (Task 4), `<FileTabs />` (Task 5).
- Produces: no new exports. `ExecProvider` must sit **inside** `ActiveFileProvider`, since `runActiveFile` needs the active file.

- [ ] **Step 1: Mount the providers and the strip**

In `apps/web/components/Workspace.tsx` — add the import, wrap `ExecProvider`, and render `FileTabs` above `RunBar`:

```tsx
import { ActiveFileProvider } from '@/lib/files/ActiveFileContext';
import { FileTabs } from './FileTabs';
```

```tsx
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
            <ActiveFileProvider>
              <ExecProvider roomId={roomId} user={user}>
                <CanvasProvider user={user}>
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

                    <FileTabs />
                    <RunBar />
                    <Toolbar />

                    <main className="min-h-0 flex-1">
                      <CodeEditor />
                    </main>

                    <section className="h-64 shrink-0 border-t border-neutral-800 bg-neutral-950 p-2">
                      <Terminal />
                    </section>
                  </div>
                </CanvasProvider>
              </ExecProvider>
            </ActiveFileProvider>
          )}
        </RoomProvider>
```

- [ ] **Step 2: Move the awareness write out of `RoomContext`**

`RoomProvider` has no notion of an active file, and its write is hardcoded. Delete that line and the now-unused import in `apps/web/lib/yjs/RoomContext.tsx`:

```tsx
import { type ReactNode, createContext, useContext, useEffect } from 'react';
import type { User } from '@sandbox/shared';
```

```tsx
  useEffect(() => {
    if (!handle) return;
    handle.awareness.setLocalStateField('user', user);
  }, [handle, user]);
```

- [ ] **Step 3: Point the editor at the active file**

In `apps/web/components/CodeEditor.tsx` — `path` gives Monaco a model per file; the binding effect gains `activeFileId`; and the editor publishes where you are:

```tsx
import { LANGUAGES, getFileText, languageForName } from '@sandbox/shared';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
```

```tsx
export function CodeEditor() {
  const { doc, awareness } = useRoomContext();
  const { runActiveFile } = useExecContext();
  const { activeFileId } = useActiveFile();
  const monaco = useMonaco();
  const file = useFile(activeFileId);
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
```

```tsx
  // Exactly ONE binding is alive at a time — to the active file. y-monaco writes its selection
  // into awareness, so a binding per open file would mean several writers racing over one field
  // and remote cursors bleeding across files. Destroying on switch makes that impossible.
  useEffect(() => {
    const model = instance?.getModel();
    if (!instance || !model) return;

    // MonacoBinding seeds the model from the Y.Text. Never pass `value`/`defaultValue` to
    // <Editor>: the binding would push that content back into the CRDT and duplicate it.
    const binding = new MonacoBinding(
      getFileText(doc, activeFileId),
      model,
      new Set([instance]),
      awareness,
    );
    return () => binding.destroy();
  }, [instance, doc, awareness, activeFileId]);

  // Tell the room which file you are looking at. CanvasOverlay filters remote pens on this.
  useEffect(() => {
    awareness.setLocalStateField('activeFileId', activeFileId);
  }, [awareness, activeFileId]);
```

and the `<Editor>` `path`, which is what gives each file its own model:

```tsx
        path={activeFileId}
```

**The path is the id, not the name — this matters.** Monaco keys its models by `path`, and §5.3 tolerates
duplicate filenames. Two files both called `utils.py` would collide on one model, and the binding would
then wire two different `Y.Text`s to the same model. Ids are unique by construction, so they cannot. The
language does not come from the path's extension either way — the effect above sets it explicitly.

- [ ] **Step 4: Point the canvas at the active file**

In `apps/web/components/CanvasOverlay.tsx` — replace all five `DEFAULT_FILE.id` uses (`:71` `useStrokes`, `:102` the draft filter, `:124` `broadcastDraft`, `:187` `onPointerUp`, `:203` `commitText`). Drop `DEFAULT_FILE` from the `@sandbox/shared` import and add:

```tsx
import { useActiveFile } from '@/lib/files/ActiveFileContext';
```

```tsx
export function CanvasOverlay({ instance }: { instance: editor.IStandaloneCodeEditor }) {
  const { doc, awareness } = useRoomContext();
  const { mode, tool, user } = useCanvas();
  const { activeFileId } = useActiveFile();
  const strokes = useStrokes(activeFileId);
```

```tsx
  // Collect every peer's in-progress draft from awareness (mine is rendered from localDraft).
  // Filtered by file: an unfiltered draft would scribble a remote pen across a file you are
  // not looking at, at coordinates that mean nothing here.
  useEffect(() => {
    const read = () => {
      const mine = awareness.clientID;
      const next: DraftStroke[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== mine && state?.draft?.fileId === activeFileId) next.push(state.draft);
      });
      setDrafts(next);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness, activeFileId]);
```

In `broadcastDraft`, `onPointerUp`, and `commitText`, replace `fileId: DEFAULT_FILE.id` with `fileId: activeFileId`.

- [ ] **Step 5: Run the active file**

In `apps/web/lib/exec/ExecContext.tsx` — drop `DEFAULT_FILE` from the import, add `useActiveFile`:

```tsx
import { type User, getFileText, getFilesMap, languageForName } from '@sandbox/shared';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
```

```tsx
export function ExecProvider({ roomId, user, children }: { roomId: string; user: User; children: ReactNode }) {
  const { doc } = useRoomContext();
  const { activeFileId } = useActiveFile();
```

```tsx
  const runActiveFile = useCallback(() => {
    const file = getFilesMap(doc).get(activeFileId);
    if (!file) return;

    const language = languageForName(file.name);
    if (!language) return;

    // The snapshot the presser currently sees. The server never reads the CRDT.
    socket.current?.send({
      type: 'run',
      byUser: user,
      fileName: file.name,
      language,
      code: getFileText(doc, activeFileId).toString(),
      stdin,
    });
  }, [doc, activeFileId, stdin, user]);
```

In `apps/web/components/RunBar.tsx` — drop `DEFAULT_FILE` from the import and read the active file:

```tsx
import { useActiveFile } from '@/lib/files/ActiveFileContext';
```

```tsx
  const { activeFileId } = useActiveFile();
  const file = useFile(activeFileId);
```

- [ ] **Step 6: Verify no hardcoded file remains in the web app**

Run: `grep -rn "DEFAULT_FILE" apps/web`
Expected: exactly one hit — `ActiveFileContext.tsx`, for its initial state before the first file list arrives. Nothing in `CodeEditor`, `CanvasOverlay`, `RunBar`, `ExecContext`, or `RoomContext`; drop the now-unused import from each.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Drive it in a real browser**

Run: `pnpm db:up && pnpm dev`, open `/`, click **Create a sandbox**, then:
- `+` → type `utils.py` → Enter. The tab appears and becomes active; the editor is empty.
- Type in it. Switch to `main.py` and back. Your text is still there.
- Draw on `utils.py`, switch to `main.py`. The drawing is **not** there. Switch back. It is.
- Rename `utils.py` → `utils.js`. Monaco's syntax highlighting changes.
- Rename it → `notes.txt`. Run is disabled and titled "No runtime for notes.txt".
- Press Run on `main.py`. It runs `main.py`, not the file you created.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): tabs drive the editor, the canvas, and Run

One MonacoBinding at a time, to the active file: y-monaco writes its
selection into awareness, so a binding per open file would race several
writers over one field and bleed remote cursors across files.

The activeFileId awareness write moves out of RoomProvider, which had it
hardcoded and has no notion of an active file.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Two real clients, converging

Proves the doc operations behave under concurrency — including that a duplicate name is cosmetic, which is the claim §5.3 makes and the reason we refuse to auto-rename.

**Files:**
- Create: `apps/ws-server/test/multifile.test.ts`

**Interfaces:**
- Consumes: `createSandboxServer` from `../src/server`; `resetRooms` from `../src/sync/rooms`; `createFile`/`renameFile`/`deleteFile`/`appendStroke`/`listFiles`/`getFileText`/`getStrokes` from `@sandbox/shared`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

`apps/ws-server/test/multifile.test.ts` — the connect/waitFor harness is copied from `test/sync.test.ts`, which is the house pattern:

```ts
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import {
  DEFAULT_FILE,
  appendStroke,
  createFile,
  deleteFile,
  getFileText,
  getStrokes,
  listFiles,
  renameFile,
} from '@sandbox/shared';
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
  open.splice(0).forEach((provider) => provider.destroy());
  resetRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connect = (room: string) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(syncUrl, room, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Node has BroadcastChannel: leaving it on would sync the two docs *around* the server.
    disableBc: true,
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

test('a file one person creates reaches the other, with its text', async () => {
  const alice = connect('mf-create');
  const bob = connect('mf-create');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  const id = createFile(alice.doc, 'utils.py', 'f-utils');
  getFileText(alice.doc, id).insert(0, 'def helper(): pass');

  await waitFor(() => listFiles(bob.doc).length === 2);
  expect(listFiles(bob.doc).map((f) => f.name)).toEqual(['main.py', 'utils.py']);
  await waitFor(() => getFileText(bob.doc, id).toString() === 'def helper(): pass');
});

test('two people creating at once both get their file — ids never collide', async () => {
  const alice = connect('mf-concurrent');
  const bob = connect('mf-concurrent');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  // Real generated ids, as the web app passes — a literal here would make the claim vacuous.
  createFile(alice.doc, 'alice.py', randomUUID());
  createFile(bob.doc, 'bob.py', randomUUID());

  await waitFor(() => listFiles(alice.doc).length === 3 && listFiles(bob.doc).length === 3);
  const names = listFiles(bob.doc).map((f) => f.name).sort();
  expect(names).toEqual(['alice.py', 'bob.py', 'main.py']);
});

test('a concurrent rename to the same name converges, and the duplicate is cosmetic', async () => {
  const alice = connect('mf-dup');
  const bob = connect('mf-dup');
  await waitFor(() => listFiles(alice.doc).length === 1);

  const a = createFile(alice.doc, 'a.py', 'f-a');
  const b = createFile(alice.doc, 'b.py', 'f-b');
  await waitFor(() => listFiles(bob.doc).length === 3);

  getFileText(alice.doc, a).insert(0, 'I am A');
  getFileText(alice.doc, b).insert(0, 'I am B');
  await waitFor(() => getFileText(bob.doc, b).toString() === 'I am B');

  // Both peers rename to the same name, each seeing it free. Neither is wrong.
  renameFile(alice.doc, a, 'utils.py');
  renameFile(bob.doc, b, 'utils.py');

  await waitFor(() => listFiles(alice.doc).length === listFiles(bob.doc).length);
  await waitFor(() =>
    listFiles(bob.doc).filter((f) => f.name === 'utils.py').length === 2,
  );

  // The duplicate is a display collision only: distinct ids, distinct text, nothing lost.
  // This is why we never auto-rename to resolve one — that would be a write-back race.
  expect(getFileText(bob.doc, a).toString()).toBe('I am A');
  expect(getFileText(bob.doc, b).toString()).toBe('I am B');
});

test('deleting a file removes it and its strokes for everyone, and spares the others', async () => {
  const alice = connect('mf-delete');
  const bob = connect('mf-delete');
  await waitFor(() => listFiles(alice.doc).length === 1);

  const id = createFile(alice.doc, 'doomed.py', 'f-doomed');
  getFileText(alice.doc, id).insert(0, 'goodbye');

  const stroke = (sid: string, fileId: string) => ({
    id: sid,
    fileId,
    authorId: 'u1',
    color: '#ff0000',
    width: 3,
    shape: { kind: 'rect' as const, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
    createdAt: 1,
  });
  appendStroke(alice.doc, stroke('s-doomed', id));
  appendStroke(alice.doc, stroke('s-main', DEFAULT_FILE.id));

  await waitFor(() => getStrokes(bob.doc).length === 2 && listFiles(bob.doc).length === 2);

  deleteFile(bob.doc, id);

  await waitFor(() => listFiles(alice.doc).length === 1);
  await waitFor(() => getStrokes(alice.doc).length === 1);
  expect(getStrokes(alice.doc).toArray()[0]!.id).toBe('s-main');
  expect(getFileText(alice.doc, id).toString()).toBe('');
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @sandbox/ws-server test multifile`
Expected: PASS. (These test Task 2's operations over a real socket; they should pass on first run. If the duplicate-name test fails, the doc operations are wrong — not the test.)

- [ ] **Step 3: Commit**

```bash
git add apps/ws-server/test/multifile.test.ts
git commit -m "test(sync): file operations converge across two real clients

Asserts the duplicate-name claim rather than assuming it: two peers rename
to the same name, both land, and the collision is cosmetic — distinct ids,
distinct text, nothing lost. That is why auto-renaming is refused.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end, in two real browsers

**Files:**
- Create: `e2e/multifile.spec.ts`
- Modify: `e2e/persistence.spec.ts`

**Interfaces:**
- Consumes: `join` from `./helpers`; the test ids from Task 5.
- Produces: nothing.

- [ ] **Step 1: Read the existing persistence spec**

Run: `cat e2e/persistence.spec.ts`
You need its `DATABASE_URL` gate and its close-every-tab mechanics before extending it.

- [ ] **Step 2: Write the multi-file e2e**

`e2e/multifile.spec.ts`:

```ts
import { type Page, expect, test } from '@playwright/test';
import { join } from './helpers';

/** Draw a freehand stroke by dragging across the editor. Returns after pointer-up. */
const drawStroke = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const canvas = page.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
  await page.mouse.up();
};

const createFile = async (page: Page, name: string) => {
  await page.getByTestId('new-file').click();
  await page.getByTestId('file-name-input').fill(name);
  await page.getByTestId('file-name-input').press('Enter');
};

test('a file one person creates appears for the other', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await createFile(alice, 'utils.py');

  await expect(bob.getByTestId('file-tab')).toHaveCount(2, { timeout: 10_000 });
  await expect(bob.getByText('utils.py')).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});

test('each file keeps its own text and its own drawings', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await createFile(alice, 'utils.py');
  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# only in utils');

  // Alice draws on utils.py.
  await alice.getByTestId('mode-toggle').click();
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(alice.getByTestId('stroke')).toHaveCount(1);

  // Bob is still on main.py: he must see neither the text nor the drawing.
  await expect(bob.getByTestId('stroke')).toHaveCount(0);
  await expect(bob.locator('.monaco-editor')).not.toContainText('only in utils');
  await expect(bob.locator('.monaco-editor')).toContainText('fizzbuzz');

  // Bob switches to utils.py and finds both waiting.
  await bob.getByText('utils.py').click();
  await expect(bob.locator('.monaco-editor')).toContainText('only in utils', { timeout: 10_000 });
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  // And back: main.py is untouched, and still has no drawing.
  await bob.getByText('main.py').click();
  await expect(bob.locator('.monaco-editor')).toContainText('fizzbuzz');
  await expect(bob.getByTestId('stroke')).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
});

test('renaming a file changes its language, and an unknown extension disables Run', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await createFile(page, 'thing.py');
  await expect(page.getByLabel('Language')).toHaveValue('python');

  // Rename via the tab: the extension drives the language.
  await page.getByTestId('rename-file').click();
  await page.getByTestId('file-name-input').fill('thing.js');
  await page.getByTestId('file-name-input').press('Enter');
  await expect(page.getByLabel('Language')).toHaveValue('javascript');

  // No runtime for .txt: the file still edits, but Run says why it cannot.
  await page.getByTestId('rename-file').click();
  await page.getByTestId('file-name-input').fill('notes.txt');
  await page.getByTestId('file-name-input').press('Enter');
  await expect(page.getByTestId('run')).toBeDisabled();
  await expect(page.getByTestId('run')).toHaveAttribute('title', /No runtime for notes\.txt/);
});

test('a duplicate name is rejected in the UI', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await page.getByTestId('new-file').click();
  await page.getByTestId('file-name-input').fill('main.py');
  await page.getByTestId('file-name-input').press('Enter');

  await expect(page.getByRole('alert')).toContainText(/already/i);
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
});

test('the last file cannot be deleted', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(page.getByTestId('delete-file')).toBeDisabled();
});

test('deleting a file takes its drawings and moves you to a neighbour', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');
  page.on('dialog', (dialog) => dialog.accept());

  await createFile(page, 'doomed.py');
  await page.getByTestId('mode-toggle').click();
  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  await page.getByTestId('delete-file').click();

  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(page.getByText('main.py')).toBeVisible();
  // You are on main.py now, which was never drawn on.
  await expect(page.getByTestId('stroke')).toHaveCount(0);
});
```

- [ ] **Step 3: Run the multi-file e2e**

Run: `pnpm db:up && pnpm piston:up && pnpm test:e2e multifile`
Expected: PASS — 6 tests.

- [ ] **Step 4: Extend the persistence e2e**

In `e2e/persistence.spec.ts`, add a test beside the existing one, keeping its `DATABASE_URL` gate and its close-every-tab mechanics. Adapt the names below to match that file's existing helpers:

```ts
test('a second file and its drawing survive reopening the room', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await join(page, roomId, 'Ada');

  await page.getByTestId('new-file').click();
  await page.getByTestId('file-name-input').fill('utils.py');
  await page.getByTestId('file-name-input').press('Enter');
  await page.locator('.monaco-editor').click();
  await page.keyboard.type('# survives the night');

  await page.getByTestId('mode-toggle').click();
  const canvas = page.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  // Close every tab and let the room flush and evict.
  await ctx.close();
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const reopened = await browser.newContext();
  const tomorrow = await reopened.newPage();
  await join(tomorrow, roomId, 'Ada');

  await expect(tomorrow.getByTestId('file-tab')).toHaveCount(2, { timeout: 10_000 });
  await tomorrow.getByText('utils.py').click();
  await expect(tomorrow.locator('.monaco-editor')).toContainText('survives the night');
  await expect(tomorrow.getByTestId('stroke')).toHaveCount(1);

  await reopened.close();
});
```

- [ ] **Step 5: Run the gated persistence e2e for real**

Run: `pnpm db:up` then `pnpm test:e2e persistence` with `DATABASE_URL` set.
Expected: PASS — both tests, neither skipped.

**Do not skip this.** Phase 4a shipped a blank-editor race precisely because the suite was green with these tests skipped. If the output says "skipped", `DATABASE_URL` is not reaching Playwright's webServer env and the test proved nothing.

- [ ] **Step 6: Commit**

```bash
git add e2e/multifile.spec.ts e2e/persistence.spec.ts
git commit -m "test(e2e): tabs, per-file drawings, and multi-file persistence

The load-bearing assertion is the negative one: Bob on main.py sees
neither utils.py's text nor its drawing. Per-file only means something
if the other file is genuinely clean.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: The README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the status line and the feature list**

- Status: `Phase 4b of 5` — collaborative editing, shared execution, a drawing overlay, durable rooms, and multi-file tabs. Point `Design:` at the master spec as it does now.
- Under **What works today**, add: several files per room, each with its own code and drawings; the language follows the filename; and state plainly that **Run executes the active file, so imports between files do not resolve.**
- Under **Architecture**, note that the doc has been multi-file since Phase 1 and that 4b is the UI arriving; and that `activeFileId` is client-local, published to awareness so remote pens are filtered per file.
- Under **Not built yet**, remove multi-file (Phase 4b) and leave line-anchored annotations and deployment (Phase 5).
- Under **Tests**, update the counts to the real numbers from `pnpm test` and `pnpm test:e2e`. Run them and read the output — do not guess.

- [ ] **Step 2: Verify the counts you wrote**

Run: `pnpm test && pnpm test:e2e`
Expected: the numbers in the README match the output exactly.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: multi-file tabs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of done

- `pnpm test` green, including the 4 gated Postgres tests with `DATABASE_URL` set — **not skipped**.
- `pnpm test:e2e` green, including the gated persistence specs.
- `pnpm typecheck` clean.
- `grep -rn "setFileLanguage\|FileMeta.*language" packages apps` returns nothing.
- The Task 6 Step 8 browser walkthrough performed by hand, not inferred.
