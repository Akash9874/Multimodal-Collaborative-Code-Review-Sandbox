# Phase 4b — Multi-file tabs — Design

Date: 2026-07-17
Status: Approved
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.4, §11 row 4)
Builds on: Phases 1–3 and Phase 4a (persistence), all complete.

## 1. Purpose

A room holds one file. It has held one file since Phase 1 — but only in the UI. The *schema* has been
multi-file from the start: a `files` `Y.Map<FileMeta>`, per-file text at `file:<id>`, a `fileId` on every
`Stroke`, and an `activeFileId` in `AwarenessState`. Phase 1 fixed those shapes deliberately, so that the
data model would stop moving before the UI arrived:

> Persistence and multi-file are data-model work, best done once the shapes of code and strokes have
> stopped moving — which is why the *schema* for both is fixed in Phase 1 even though the UI arrives in
> Phase 4. — master spec §11

This phase is that arrival. It is mostly *activation*: wiring a tab strip to a data model that already
exists, and replacing two hardcoded `DEFAULT_FILE.id` references in `CodeEditor` with a real active file.

Phase 4 in the master spec bundles persistence with multi-file. We split it: 4a shipped persistence, and
this is **4b**. 4a persists whatever files the doc holds, so multi-file rooms become durable on arrival
with no persistence work in this phase.

## 2. What ships, and what does not

**Ships in Phase 4b:**

- A **file tab strip**: create, rename, delete, and switch.
- **Per-file text and per-file strokes** — draw on `utils.py` and the stroke lives on `utils.py`.
- **Language derived from the filename's extension**, replacing stored `FileMeta.language`.
- The **Phase 2 language picker retargeted** as a rename shortcut for the active file.
- **Awareness filtered by file** — remote pens, pointers, and cursors appear only on the file they are on.

**Explicitly out of scope:**

- **Running more than one file.** Run sends the active file, exactly as today (§4).
- **Entry-point markers** — implied by the above; there is no "main" file to designate.
- **Folders / nested paths.** Names are flat; `/` is rejected (§5.3).
- **Soft delete / undo-delete.** Deletion is destructive, guarded by a confirm (§5.2).
- **Tab reordering, per-file run history, line anchoring** (Phase 5).

## 3. Schema and the derived language

### 3.1 The extension is the single source of truth

`FileMeta.language` is deleted. A new `languageForName(name)` in `model.ts` maps an extension to a
`LanguageId`, backed by an `EXTENSION_TO_LANGUAGE` map derived from the existing `LANGUAGES` table, so the
two cannot drift:

```ts
export const languageForName = (name: string): LanguageId | undefined => …
```

Today the invariant is *maintained* — `setFileLanguage` renames the file so that name and language agree,
because Piston keys off the extension and a `main.py` holding TypeScript will not compile. `doc.ts` warns
about exactly this drift, and predicts this phase:

> Phase 4 maintains the same invariant from the other end — there, renaming drives the language; here, the
> language drives the rename.

Deriving makes the invariant *unbreakable* rather than merely maintained: there is no second field to
disagree with the name.

**The return type widens to `LanguageId | undefined`,** and that is the real consequence. `notes.txt` is a
legitimate file that Piston has no runtime for. `undefined` is not an error state — the file opens, edits,
syncs, and is drawn on. It only disables Run, with a stated reason (§4).

### 3.2 No migration

Rooms persisted by 4a already carry `language` inside their `FileMeta` objects. We stop reading it. A
`Y.Map` holds plain objects, so the stale key is inert; nothing rewrites it and nothing breaks.

`SCHEMA_VERSION` stays at **1**. It marks the shape of the stored bytes, and no stored byte needs to change
— an unread field is not a schema change. Bumping it would imply a migration that does not exist.

### 3.3 File operations

Three operations join the existing ones in `doc.ts`, each a single `doc.transact`:

```ts
createFile(doc, name): string        // returns the new id
renameFile(doc, fileId, name): void
deleteFile(doc, fileId): void
```

`createFile` writes a `FileMeta` and leaves the text empty. Ids are never derived from the name, so a
rename is metadata-only and two concurrent creates cannot collide.

The id is **the caller's**, exactly as `appendStroke` takes a caller-built `Stroke`. This is forced, and the
constraint is worth knowing: `packages/shared` compiles with `lib: ["ES2022"]` and no DOM or `@types/node`,
so `crypto` does not exist to call there. That restraint is deliberate — `exec.ts` hand-rolls `byteLength`
rather than reach for `TextEncoder` for the same reason, because a package that can reach for `crypto` can
equally reach for `document` or `process`. The web app generates the id with `crypto.randomUUID`, where it
is real.

`renameFile` writes the name. Nothing else: the language follows from the name by derivation, with no
second write to keep in step.

### 3.4 `deleteFile`, and the root-type caveat

`deleteFile` cascades in one transaction: the `FileMeta`, the file's text content, and every stroke whose
`fileId` matches.

**A Yjs root type cannot be removed from a document.** `doc.getText('file:<id>')` brings the type into
existence permanently; there is no `doc.delete(key)`. So "delete the text" means `text.delete(0,
text.length)` — the content goes, the empty root type stays, and it is re-encoded into every subsequent
`Y.encodeStateAsUpdate` blob forever.

This is a real, permanent leak, and it is stated here rather than discovered later. It is also small and
bounded: an empty root type is a few bytes of structure, and a disposable sandbox has a 30-day TTL. The
alternative — rebuilding the doc without the dead type — means replacing every client's document out from
under them, which costs far more than the bytes are worth.

## 4. Execution

`RunRequest` is unchanged. Run sends **the active file** — its name, its derived language, its text —
exactly as it does today; only the source of those three values moves from `DEFAULT_FILE` to the active
file.

This is a deliberate limit, and it is worth being blunt about what it means: `import utils` from `main.py`
raises `ModuleNotFoundError`, because Piston receives one file. Multi-file here means *organising* code and
annotating it, not linking it.

Piston's `/execute` does accept a `files[]` array, so running a whole room is a coherent later slice. It
would change the wire protocol (`code` → `files[]`), re-open `MAX_CODE_BYTES` as a per-room budget rather
than a per-file one, and force an entry-point decision. None of that serves this phase's proof, which is
that files, their text, and their drawings are separate and shared.

**Run is disabled when the active file's language is `undefined`**, with the reason shown ("No runtime for
`.txt`") rather than a silently dead button. The disable is a UI affordance, not a security boundary: the
server's zod validation at the exec seam remains the authority, and it already rejects an unknown language.

## 5. The tab strip

### 5.1 Active file is client-local

`activeFileId` lives in a new `ActiveFileContext`, not in the `Y.Doc`. Which tab you are looking at is
yours, not the room's — putting it in the doc would mean one person's tab click yanks everyone else's
editor. It *is* published to awareness (§6), which is the difference between telling people where you are
and moving them.

### 5.2 Delete is confirmed

Deletion destroys a collaborator's text and their annotations, and a CRDT cannot make that safe:
delete-vs-concurrent-edit is lossy by nature, and no amount of merging changes that. So the guard is a
confirm dialog naming the file and its stroke count — cheap, and it stops the misclick case, which is the
realistic one.

Deleting the last file is **blocked** (the `×` is disabled on a lone tab). A room with no files has no
editor to render and no way back.

A client whose `activeFileId` has been deleted — by someone else, concurrently — falls back to the leftmost
remaining tab.

### 5.3 Name validation, and honest duplicates

`validateFileName(name, existingNames)` in `model.ts` rejects, in the rename/create UI:

- empty or whitespace-only names, and names over `MAX_FILE_NAME_LENGTH` (32)
- names containing `/`, `\`, or `..` — flat namespace; a slash would be a lie about what Piston does with it
- a name already taken by another file

**Uniqueness is a UI guard, not a doc invariant, and cannot be otherwise.** Two peers renaming
simultaneously both see a free name, both write, and the `Y.Map` faithfully keeps both. The room ends up
with two tabs reading `utils.py`.

We let that stand. Files are keyed by id, so duplicate *names* are cosmetic — distinct text, distinct
strokes, no corruption — and either user can rename one. The alternative, auto-suffixing to `utils-2.py` on
observing a collision, means a client rewrites a name out from under whoever just typed it: a write-back
race, and every observing client would race to perform it. That is precisely the anti-pattern the master
spec rejects for line anchoring (§5.6), and it is rejected here for the same reason.

### 5.4 The picker becomes a rename shortcut

`setFileLanguage` is deleted. The picker now calls `renameFile` on the active file, swapping the extension
via the existing `renameExtension` helper — "make this JavaScript" renames `main.py` to `main.js`, and the
language derives from that. One write path (`renameFile`), two entry points (the picker, and the tab's own
rename). The picker displays the active file's derived language, and is inert on a file whose language is
`undefined`.

## 6. Awareness, filtered by file

This does not appear in the master spec's Phase 4 row, but it falls directly out of multi-file, and without
it the feature is wrong.

`DraftStroke` carries a `fileId`, and `CanvasOverlay` already reads it — but only ever compares it against
`DEFAULT_FILE.id`, which with one file is a tautology. With tabs, an unfiltered draft means you watch a
remote pen scribble across a file you are not looking at, at coordinates that mean nothing where they land.
So the comparison becomes `activeFileId`.

`activeFileId` is **already published** to awareness — `RoomProvider` writes it at `RoomContext.tsx:30`,
hardcoded to `DEFAULT_FILE.id`. It is not an unused field waiting to be filled in; it is an existing write
that must start following the active file. It moves out of `RoomProvider` (which has no notion of an active
file) to a component inside `ActiveFileProvider`.

**`AwarenessState.pointer` is dead.** Nothing writes it — `setLocalStateField` is only ever called with
`user`, `activeFileId`, and `draft` — so there is no remote pointer to filter, and this phase adds no
filter for one. The field is left in place, untouched and still unwritten; removing it is unrelated
cleanup, and adding a filter for a value that is always `undefined` would be theatre.

Remote *text* cursors are filtered structurally rather than by a check, which §7 explains.

## 7. The editor

`CodeEditor` gains a model per file (Monaco's `path` prop, which already manages models by path) and keeps
**exactly one `MonacoBinding` alive** — to the active file — destroying and recreating it on switch. The
binding effect gains `activeFileId` in its deps; its two hardcoded `DEFAULT_FILE.id` references
(`CodeEditor.tsx:20` and `:37`) become `activeFileId`.

One binding at a time is the load-bearing decision. `y-monaco` writes its selection into awareness, so a
binding per open file would mean several writers racing over one awareness field, and remote cursors
bleeding into files they are not in. With one binding, that is impossible by construction rather than by a
filter someone can forget.

Keeping the models alive (rather than remounting the editor on each switch) keeps switching instant and
preserves scroll position per file.

**A caveat for the plan:** `MonacoBinding`'s constructor seeds the model from the `Y.Text`, so rebinding is
safe — it cannot duplicate content — but the seeding write lands on the model's undo stack. Per-file *Monaco*
undo history across a tab switch is therefore not something this design promises. Stroke undo
(`undoLastStrokeBy`) is unaffected; it reads the doc, not the model.

## 8. Components

| File | Change |
|---|---|
| `packages/shared/src/model.ts` | `languageForName`, `EXTENSION_TO_LANGUAGE`, `validateFileName`, `MAX_FILE_NAME_LENGTH`; drop `language` from `FileMeta` |
| `packages/shared/src/doc.ts` | `createFile`, `renameFile`, `deleteFile`; drop `setFileLanguage` |
| `apps/web/lib/yjs/useFiles.ts` | new — observes `files`, returns `FileMeta[]` (sorted, as `listFiles` already does) |
| `apps/web/lib/files/ActiveFileContext.tsx` | new — `activeFileId` + setter, with the deleted-file fallback |
| `apps/web/components/FileTabs.tsx` | new — the strip: switch, `+`, inline rename, `×` + confirm |
| `apps/web/components/CodeEditor.tsx` | `activeFileId` for `useFile`/binding/`path`; publish `activeFileId` to awareness (moved from `RoomContext`) |
| `apps/web/lib/yjs/RoomContext.tsx` | drop the hardcoded `activeFileId` write (`:30`); it keeps writing `user` |
| `apps/web/components/CanvasOverlay.tsx` | `useStrokes(activeFileId)`; new strokes carry it; filter remote drafts by `fileId` |
| `apps/web/components/RunBar.tsx`, `lib/exec/ExecContext.tsx` | run the active file; disable on `undefined` language |
| `apps/web/components/Workspace.tsx` | mount `ActiveFileProvider` + `FileTabs` |

`useStrokes(fileId)` already takes the parameter and needs no change — Phase 3 built the filter and had no
second file to use it on.

## 9. Testing

**Unit.** `languageForName` (each extension, unknown, no dot, `.env`-style leading dot). `validateFileName`
(empty, oversized, `/`, `\`, `..`, taken). `createFile` / `renameFile` / `deleteFile` in `doc.test.ts`,
including the stroke cascade and that deleting one file leaves another's strokes untouched.

**Integration** (two genuine Yjs clients, as `sync.test.ts` does): concurrent creates both survive;
concurrent renames to the same name both land and converge, with distinct ids and distinct text — the
duplicate is cosmetic, which is §5.3's claim, asserted rather than assumed; a delete on one client removes
the file and its strokes on the other.

**E2E** (two isolated browser contexts): A creates a file, B sees the tab; A draws on file 2, B switches to
file 2 and sees the stroke, and file 1 is clean; renaming `.py` → `.js` switches Monaco's language; Run
executes the active file, not the first one.

The persistence e2e from 4a is extended rather than duplicated: create a second file, draw on it, close
every tab, reopen — both files and both drawings return. This test is gated on `DATABASE_URL` like its
sibling.

**A note on gated tests.** Phase 4a shipped a blank-editor race that every ungated test missed, because the
suite was green with the Postgres tests skipped. `pnpm db:up` exists now. The gated tests are part of this
phase's definition of done, not an optional extra.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rebinding on tab switch duplicates text into the CRDT | `MonacoBinding` seeds the model from the `Y.Text`, never the reverse; asserted by an integration test that switches tabs and checks length |
| A stale binding writes into the wrong file's awareness | One binding, destroyed in the effect's cleanup before the next is made |
| Deleting a file another user is typing in loses their text | Accepted and confirmed (§5.2) — a CRDT cannot make delete-vs-edit safe |
| Duplicate names confuse Run | Run names the file it ran in the terminal header, as it already does |
| Dead root types accumulate in the persisted blob | Bounded and accepted (§3.4); the 30-day TTL sweeps the room regardless |
