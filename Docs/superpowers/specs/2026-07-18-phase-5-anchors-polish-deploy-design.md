# Phase 5 — Anchors, polish, and deploy — Design

Date: 2026-07-18
Status: Approved
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.3, §5.6, §7, §11 row 5)
Builds on: Phases 1–4b, all complete and merged.

## 1. Purpose

Phase 3 pinned strokes to **content space**, so a drawing survives scrolling: two people scrolled to
different places see the same stroke over the same code. It does not survive **editing**. Insert a line
above an annotated block and the code moves down while the drawing stays exactly where it was, now
pointing at the wrong thing.

This phase closes that gap, and the master spec states the proof as the phase's headline:

> Insert lines above an annotated block; the annotation follows its code — master spec §11, row 5

`Stroke.anchor?: { rel: string; dy: number }` has been in the schema since Phase 1 and **nothing has ever
written it**. As in 4b, a large part of this phase is activation rather than invention: the field was
reserved for exactly this.

The rest of the phase finishes the product — an offline affordance that makes CRDT convergence something
you can demonstrate on purpose, the empty and loading states, keyboard shortcuts, and a real deployment.

## 2. What ships, and what does not

**Ships in Phase 5:**

- **Line-anchored strokes.** A new stroke binds to a character in its file's `Y.Text` and follows that
  character through every edit, on every client, with no extra document operations.
- **Orphaned strokes**, rendered dimmed rather than silently vanishing.
- **An explicit Offline toggle**, so the merge-on-reconnect story can be shown deliberately.
- **Empty and loading states**, including a cold-start "waking the sandbox…".
- **Keyboard shortcuts** and a `?` cheatsheet.
- **Deployment as infra-as-code plus a runbook**: Netlify (web), Render (ws-server), Supabase (Postgres).
- **README** with a recorded demo of the anchoring proof.

**Explicitly out of scope:**

- **Retro-anchoring strokes drawn before this phase** (§3.6). They keep rendering as they do today.
- **Running more than one file.** `RunRequest` is unchanged; Run still sends the active file.
- **Execution in the hosted demo** (§6.5). Run is disabled there, with a stated reason.
- **Moving, resizing, or editing a committed stroke.** Strokes remain immutable once drawn.
- **Anchoring a shape to a *range*** rather than a single point (§3.4).
- **A CI/CD pipeline.** The runbook is deliberately manual; see §6.6.

## 3. Line anchoring

### 3.1 Why a relative position, and not the two obvious alternatives

A stored **line number** goes stale the moment anyone inserts a line above it, and every client would then
race to write a corrected number back into the CRDT. That is the same write-back race 4b refused for
duplicate filenames, and it is rejected for the same reason.

**Monaco decorations** are the other tempting answer, because Monaco tracks ranges through edits natively.
They do not work here, and Phase 4b is why: `CodeEditor` keeps exactly **one model and one binding alive at
a time**, to the active file. A file nobody has opened in this session has no model at all, so a decoration
could not track edits for strokes on it. Decorations are also per-client view state, so a shared position
would still have to be stored — the approach collapses into the one below, plus extra state that can drift.

A **Yjs relative position** binds to a character in the CRDT itself. It survives concurrent edits by
construction, and each client resolves it to an absolute index **locally**, with no write-back and
therefore no race. Orphan detection is free: a deleted anchor resolves to `null`.

### 3.2 The encoding is JSON, not base64

The master spec describes `rel` as "a base64-encoded Yjs relative position". **We store JSON text
instead**, and the field stays `rel: string`.

The reason is a constraint the repo already imposes on itself deliberately. `packages/shared` compiles
against `lib: ["ES2022"]` and nothing else — no DOM, no `@types/node` — which is why ids are passed in
rather than generated there. `btoa` and `Buffer` are both absent by that same design, so base64 would have
to be hand-rolled and tested. Yjs already ships a supported JSON round trip:

```ts
const rel = JSON.stringify(Y.relativePositionToJSON(rpos));
const rpos = Y.createRelativePositionFromJSON(JSON.parse(rel));
```

This is a change of *encoding*, not of type or of meaning — `anchor` has never been written, so there is
nothing to migrate. JSON is larger than base64 on the wire; at demo stroke counts that is irrelevant, and
being able to read an anchor in a doc dump while debugging is worth more.

### 3.3 `assoc` is load-bearing

`Y.createRelativePositionFromTypeIndex(type, index, assoc)` takes an association argument that decides
which side of the gap the position sticks to. **We pass `assoc = 0`** (associate with the character that
follows).

This is not a detail — it *is* the headline behaviour. An anchor points at the first character of a line.
Inserting a newline at exactly that offset is what "insert a line above the annotated block" means. With
`assoc >= 0` the anchor stays attached to the original character, which has now moved down a line, and the
drawing follows its code. With `assoc < 0` it would bind to the end of the preceding text and stay put —
the exact failure this phase exists to fix.

### 3.4 The anchor is a point, not a range

One relative position and one `dy` per stroke. The topmost content point of the shape — minimum `y` across
`points`, across `from`/`to`, or `at` — is mapped to a line, and the whole shape translates rigidly by
whatever that line has moved.

The consequence is worth stating plainly: inserting a line **inside** a tall rectangle moves the rectangle
down without growing it. Anchoring both corners would stretch it, but a stretched shape needs two positions
that can orphan independently, and a rule for what a half-orphaned shape means. That complexity buys very
little for hand-drawn annotation, so it is refused.

### 3.5 Creating and resolving

**On commit**, in `CanvasOverlay`:

1. topmost content point of the shape → line, by **binary search over `editor.getTopForLineNumber`**
2. line → `Y.Text` offset, via `model.getOffsetAt({ lineNumber, column: 1 })`
3. offset → relative position → `rel` (§3.2)
4. `dy = topmostY - editor.getTopForLineNumber(line)`

Step 1 uses binary search rather than `y / lineHeight` because the division silently assumes uniform line
height, which wrapped lines and view zones break. Binary search is `O(log n)` and assumes nothing.

**On render:** `rel` → absolute index → `model.getPositionAt(index).lineNumber` →
`getTopForLineNumber(line) + dy`. The stroke is drawn inside its own `<g transform="translate(0, shift)">`
nested in the existing scroll group, where `shift` is the anchored top minus the stored topmost `y`.
Horizontal position never changes. Recompute on `onDidChangeModelContent`; scrolling is already handled by
the outer transform.

### 3.6 Three states, and no migration

| State | Condition | Rendering |
|---|---|---|
| **anchored** | `anchor` present and resolves | follows its code |
| **orphaned** | `anchor` present, resolves to `null` | stored coordinates, **dimmed** |
| **legacy** | no `anchor` | stored coordinates, exactly as today |

**Strokes drawn before this phase are never retro-anchored.** Two ways of doing it were considered and both
rejected. Writing anchors back on load is a write-back race — every client computes and writes the same
field. Deriving an anchor locally *without* writing looks race-free but is worse: the derivation depends on
the text at the moment a client loads, so two people who open the room at different times resolve the same
stroke to different code, and nothing in the document records the disagreement. Leaving them unanchored is
the only option where every client agrees, because the coordinates are stored.

`SCHEMA_VERSION` stays at **1**. `anchor` is already declared and optional; writing a field that was always
part of the type is not a schema change, and bumping the version would advertise a migration that does not
exist. This is the same reasoning 4b used when it *stopped* reading `FileMeta.language`.

### 3.7 Where the code lives

Anchor encode/resolve is **pure** and goes in `packages/shared/src/anchor.ts`, over plain `Y.Text` and
`Y.Doc`:

```ts
export const createAnchor = (text: Y.Text, index: number, dy: number): Anchor;
export const resolveAnchor = (doc: Y.Doc, anchor: Anchor): number | null;
```

Keeping it out of the web app is what makes it testable without a browser, and it lets the two-client
convergence test in `apps/ws-server/test` assert anchoring over a real socket (§9). Only the pixel↔line
mapping needs Monaco, and that stays thin in `CanvasOverlay`, in the shape of the existing `coords.ts`.

## 4. The offline toggle

### 4.1 Manual offline is not network offline

`RoomContext` gains `isOffline` and `setOffline`. This is client-local React state and **never a document
write** — the same rule `activeFileId` follows in 4b, for the same reason: one person's demo must not
disconnect everybody.

Toggling calls `provider.disconnect()` / `provider.connect()`. `y-websocket` stops its reconnect loop when
disconnected deliberately, so "offline" stays offline until it is switched back.

The pill must **distinguish a manual disconnect from a real one**. Without that, a genuine outage in the
middle of a demo reads as the toggle, and the demo quietly lies. Manual reads `Offline (you)`; an
unintended drop keeps today's `Reconnecting…`.

### 4.2 Pending edits are the point

While offline, local document updates are counted and shown (`3 local edits`). This is what makes the merge
visible: the number climbs while disconnected, and reconnecting drains it as both sides converge. Without a
count, a successful merge is indistinguishable from nothing having happened.

### 4.3 Run follows offline

`RunBar` already disables on `status !== 'connected'`. The manual flag feeds the same predicate, so an
offline sandbox cannot execute. A half-offline state — the pill claiming offline while Run still works —
would undercut the very thing being demonstrated.

## 5. Polish

### 5.1 Cold start

Render's free tier sleeps, and the first connection can take 30–50 seconds. §7 of the master spec asks for
an explicit state rather than "a dead Run button and a spinner that lies". After a **3s** threshold the
connection pill and an editor overlay say **"waking the sandbox…"**. The threshold exists so that a normal
fast connect never flashes the message.

### 5.2 Execution capability is advertised by the server

The hosted demo has no executor (§6.5), so Run must explain itself rather than appear broken. The web app
does **not** infer this from a build flag. The ws-server sends `{ type: 'exec:hello', executionEnabled }`
on the `/exec` channel at connect, and `RunBar` renders the disabled state with
`execution is local-only — run pnpm piston:up`.

**The flag is explicit, and is not inferred from `PISTON_URL`.** `env.ts` already defaults `pistonUrl` to
`http://localhost:2000/api/v2` when the variable is absent, so "unset" does not mean "no executor" — it
means "try localhost", which in production is a connection error rather than a clean disabled state. A
separate `EXECUTION_ENABLED` (default `true`, set to `false` in `render.yaml`) says what is actually meant.
Dropping the `PISTON_URL` default instead would break local development, where that default is the entire
convenience.

The server is the only component that knows, and this keeps the decision runtime rather than build-time:
attaching an executor later is an environment change and a restart, not a rebuild of the web app. That
matters because `NEXT_PUBLIC_*` values are inlined at build time (§6.2).

### 5.3 Empty states

- **Terminal, no runs yet** — `No runs yet — press Ctrl/Cmd + Enter`.
- **Room loading** — the existing editor skeleton, extended to cover the canvas and tab strip so the shell
  does not appear half-built.

### 5.4 Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Run (existing) |
| `Ctrl/Cmd + B` | toggle Code / Draw mode |
| `P` `A` `R` `T` `E` | pen, arrow, rect, text, erase (Draw mode only) |
| `Esc` | leave Draw mode, or cancel a rename |
| `Ctrl/Cmd + Z` | undo your own last stroke (Draw mode) |
| `?` | shortcut cheatsheet |

Two constraints come from existing code. **Monaco swallows keydown**, which `CodeEditor` already documents,
so editor-focused bindings go through `instance.addCommand` while canvas-focused ones use a document
listener. And **single-letter tool keys must be suppressed while focus is in a text field** — otherwise
typing `probe.py` into the rename box fires pen, then rect, then text. The guard is on the event target
being an `input`, `textarea`, or the Monaco text area.

## 6. Deployment

### 6.1 Topology

```text
Netlify  ──  Next.js web app (static + server routes)
   │            NEXT_PUBLIC_SYNC_URL / NEXT_PUBLIC_EXEC_URL  →  wss://<render-host>
   ▼
Render   ──  ws-server (/sync relay, /exec, /health)
   │            DATABASE_URL  →  Supabase session pooler :5432
   ▼
Supabase ──  Postgres (sandbox.rooms)
```

### 6.2 Netlify — and the build-time trap

`netlify.toml` plus `@netlify/plugin-nextjs`, building `apps/web` from the monorepo root.

`NEXT_PUBLIC_SYNC_URL` and `NEXT_PUBLIC_EXEC_URL` are **inlined into the bundle at build time**. Changing
them in the Netlify UI does nothing until the site is rebuilt. The runbook states this explicitly, because
the failure it produces — a redeployed site still talking to the old server — looks like a caching bug and
is not one.

### 6.3 Render — and `wss://`

`render.yaml` as a Blueprint, **at the repository root** — Render only discovers Blueprints there. A Node
web service running the ws-server, health check `/health`, with `DATABASE_URL`, `ROOM_GRACE_MS`,
`ROOM_TTL_DAYS`, and `EXECUTION_ENABLED=false` (§5.2).

Render terminates TLS, so the browser must connect with **`wss://`**. An `ws://` URL from an HTTPS page is
blocked as mixed content, with a console error that does not obviously point at the scheme.

### 6.4 Supabase, and the absence of RLS

The Session pooler connection string on port 5432, as `.env.example` already documents, then
`pnpm db:migrate` once against it.

**There is no RLS surface here, and that is worth writing down.** The ws-server is the only database client
and connects as a Postgres role; there is no browser-side Supabase client and no anon key anywhere in the
app. Row Level Security protects tables reached through PostgREST with a user JWT, and nothing in this
system does that. The security boundary is the connection string. Stating this prevents a later reader from
assuming RLS is protecting something it never touched.

Access control for rooms is, as it has always been, **knowing the URL** — the master spec is explicit that a
sandbox is disposable and unlisted, not private.

### 6.5 Execution is local-only in the hosted demo

The public Piston instance became **whitelist-only on 2026-02-15**: `GET /runtimes` still answers, but
`POST /execute` returns 401. `.env.example` already records this. Self-hosting Piston needs privileged
containers for its `isolate` sandbox, which Render's free tier does not provide.

So the deployed demo ships with `EXECUTION_ENABLED=false` and Run disabled, explained by §5.2. A publicly reachable
executor would also be an abuse surface — anyone who found the URL could run arbitrary code on it — so
leaving it off is a security decision as much as a cost one. The recorded demo (§7) shows execution from a
local run, where `pnpm piston:up` provides a real sandbox.

### 6.6 The runbook

`Docs/deploy-runbook.md`: ordered steps, exactly what to paste where, and a verification after each stage —
`curl /health` for Render, a room that survives a service restart for Supabase, and a two-browser check for
Netlify. No secret is ever committed; the repo carries only `.env.example` and the manifests.

It is manual on purpose. A CI/CD pipeline for a three-service demo would be more machinery than the thing it
deploys, and the runbook is the artefact a reader actually wants.

## 7. README and the demo recording

The README gains the deployed URL, a Phase 5 status line, the shortcut table, and an explicit note that
**execution is local-only in the hosted demo** while everything else is live.

The demo is recorded by `scripts/record-demo.mjs`, driving Playwright with `recordVideo` through the
anchoring proof: draw over a block, insert lines above it, watch the annotation follow. Playwright emits
`.webm`. Converting to GIF needs **ffmpeg, which may not be installed** — so the script emits the `.webm`
unconditionally, converts only when ffmpeg is present, and the README links whichever exists. The recording
is reproducible either way, which matters more than the container format.

## 8. Components

```text
packages/shared/src/
  anchor.ts                      NEW  createAnchor / resolveAnchor, pure, no DOM
  anchor.test.ts                 NEW  round trip, orphan → null, assoc behaviour
  model.ts                       MOD  Anchor type exported alongside Stroke

apps/web/
  lib/canvas/anchorLine.ts       NEW  content-y ↔ line, binary search over getTopForLineNumber
  lib/canvas/anchorLine.test.ts  NEW
  components/CanvasOverlay.tsx   MOD  write anchor on commit; per-stroke transform; dim orphans
  lib/yjs/RoomContext.tsx        MOD  isOffline, setOffline, pending-update count
  components/ConnectionPill.tsx  MOD  offline toggle, manual vs real, waking state
  components/RunBar.tsx          MOD  offline predicate, executionEnabled message
  lib/exec/ExecContext.tsx       MOD  receive executionEnabled
  components/Shortcuts.tsx       NEW  cheatsheet overlay + document-level key handling
  components/Terminal.tsx        MOD  empty state

apps/ws-server/src/
  env.ts                         MOD  EXECUTION_ENABLED, default true
  exec/connection.ts             MOD  send exec:hello on connect
apps/ws-server/test/
  anchor.test.ts                 NEW  two clients: B edits above, both resolve the same line

packages/shared/src/
  exec.ts                        MOD  the exec:hello message in ServerMessage

netlify.toml                     NEW  repo root — Netlify reads it from the base directory
render.yaml                      NEW  repo root — Render only discovers Blueprints there
Docs/deploy-runbook.md           NEW
scripts/record-demo.mjs          NEW
README.md                        MOD
```

## 9. Testing

- **Unit, `packages/shared`** — anchor round trip; `assoc = 0` puts the anchor on the moved line after an
  insert at its own offset; a deleted anchor resolves to `null`; topmost-point selection for each shape kind.
- **Unit, `apps/web`** — `anchorLine` binary search against a stubbed `getTopForLineNumber`, including
  non-uniform line heights, which is the case the naive division gets wrong.
- **Integration, two real clients** — A commits an anchored stroke, B inserts ten lines above it, and both
  docs resolve the anchor to the same line. This runs over a real socket, without a browser, which is only
  possible because §3.7 keeps the logic in `shared`.
- **E2E** — the roadmap's own proof: draw over a block, insert lines above, assert the stroke's rendered `y`
  moved by roughly *n* × line height; and an orphan case where deleting the anchored text dims the stroke
  rather than removing it.
- **E2E** — the offline toggle: go offline, type, see the pending count, reconnect, and see both sides
  converge in two browsers.

## 10. Risks

- **Monaco offset vs `Y.Text` index.** `model.getOffsetAt` counts characters using the model's EOL. If a
  model ever normalises to CRLF, offsets drift by one per line and every anchor lands a line off. Mitigation:
  create models with LF explicitly and assert it in the editor, rather than trusting the default.
- **Recompute cost.** Anchors resolve on every `onDidChangeModelContent`, which is `O(strokes)` per
  keystroke. Fine at demo scale; if it bites, memoise on the doc state vector. Not optimised pre-emptively.
- **Render cold start during a demo.** Mitigated, not solved, by §5.1 — the sandbox still takes 30–50s to
  wake. The runbook notes that a paid instance removes this if the demo matters.
- **ffmpeg absence** breaks GIF conversion, not the recording (§7).
- **Phase size.** This is the largest phase since 1. The plan sequences it as independently green slices —
  anchors, offline, polish, deploy, README — so no task leaves the suite red, the way 4b ordered its tasks.
