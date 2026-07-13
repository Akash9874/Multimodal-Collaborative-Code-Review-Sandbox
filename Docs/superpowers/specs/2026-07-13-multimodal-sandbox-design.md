# Multimodal Collaborative Code Review Sandbox — Design

Date: 2026-07-13
Status: Approved
Source docs: `Docs/Multimodal-Sandbox-PRD.pdf`, `Docs/claude (2).md`

## 1. Purpose and Framing

A zero-install web workspace, reachable at a single URL, where several people simultaneously edit code,
draw architecture over that code, and run it — seeing the same output at the same moment.

This build is a **portfolio/demo project**. That framing is a design input, not a disclaimer: it means we
build the parts that are hard and visible (CRDT sync, the overlay canvas, shared execution) and we refuse
to build infrastructure we cannot honestly operate (our own container orchestrator, a Redis backplane,
autoscaling). Where the PRD names infrastructure we are not running, we implement the *requirement*
behind it and keep the seam that lets the real thing drop in later.

### Deployment shape

- Frontend: Next.js on **Netlify**.
- Server: Node WebSocket service on **Render** (free tier).
- Database: **Neon Postgres** (free tier).
- Execution: the server proxies to the **public Piston API**.

Netlify cannot host the WebSocket server — its functions are serverless and short-lived, and cannot hold
persistent connections. Render's free tier cannot run Docker-in-Docker, so we cannot spin up our own
ephemeral containers there. Piston already runs submitted code in isolated, network-less containers with
hard CPU/RAM/wall-clock limits, which satisfies the PRD's highest-priority NFR — *never execute user code
on the host* — with an executor we do not have to operate.

## 2. Success Criteria

The build is done when, on the deployed URL:

1. Two people open the same `/s/<roomId>` and see each other's keystrokes, cursors, and selections live.
2. Either of them presses Run, and **both** see the same stdout/stderr appear in the terminal.
3. One draws an arrow over line 12; the other — scrolled to a different position — sees that arrow on
   line 12, not floating over line 40.
4. Everyone closes the tab. A week later the link still opens the same code, files, and drawings.
5. Lines are inserted above an annotated block, and the annotation follows its code down the page.
6. The network drops, edits continue offline, the network returns, and both documents converge without
   loss or duplication.

## 3. Architecture

pnpm monorepo, following the structure prescribed in `claude (2).md`:

```text
/
├── apps/
│   ├── web/                 Next.js (App Router) + Monaco + canvas + xterm  → Netlify
│   │   ├── app/             routes: /, /s/[roomId]
│   │   ├── components/      Editor, Canvas, Terminal, Presence, Toolbar
│   │   └── lib/             yjs provider hooks, exec client, coordinate transforms
│   └── ws-server/           Node + ws → Render
│       ├── sync/            y-websocket protocol relay
│       ├── exec/            CodeExecutor interface + Piston adapter + rate limiter
│       └── persistence/     Postgres room store
├── packages/
│   ├── types/               shared interfaces (FileMeta, Stroke, RunRecord, wire messages)
│   └── config/              shared tsconfig + eslint
├── docs/
└── docker/                  (Phase 5, optional) self-hosted executor definition
```

A room is a URL. `/` mints a `nanoid` and redirects to `/s/<roomId>`; the id is the entire access control
story, and that is a deliberate, documented choice for a disposable sandbox (see §9).

### Two sockets, on purpose

| Socket | Carries | Server's role |
|---|---|---|
| `/sync?room=<id>` | Yjs sync + awareness protocol | **Pure relay.** Never parses document semantics. |
| `/exec?room=<id>` | Run requests, run output, run history | Execution authority. Broadcasts results to the room. |

The alternative — putting run requests *into* the Y.Doc and having the server observe them — was rejected.
It forces the relay to understand document semantics, and with more than one server instance every node
would observe the same pending run and execute it twice. A separate channel keeps a single execution
authority and preserves the relay property `claude (2).md` requires.

## 4. Data Model

### 4.1 Y.Doc — the single source of truth

| Key | Type | Contents |
|---|---|---|
| `files` | `Y.Map<FileMeta>` | fileId → `{ id, name, language, createdAt }` |
| `file:<fileId>` | `Y.Text` | that file's content; bound directly to a Monaco model by `y-monaco` |
| `strokes` | `Y.Array<Stroke>` | every shape drawn, in editor content-space coordinates |
| `meta` | `Y.Map` | `{ createdAt, schemaVersion }` |

The multi-file schema exists from **Phase 1**, even though the file-tab UI does not ship until Phase 4.
Phase 1 seeds a single `main.py`. Retrofitting multi-file later would mean migrating live documents;
designing for it now costs nothing.

`Y.Text` instances are top-level (`ydoc.getText('file:' + id)`) rather than nested inside a `Y.Map`,
because `y-monaco` binds to a `Y.Text` and top-level types are the well-trodden path.

### 4.2 Awareness (ephemeral, never persisted)

```ts
type AwarenessState = {
  user: { id: string; name: string; color: string };
  cursor?: { fileId: string; line: number; column: number };
  selection?: { fileId: string; startLine: number; startCol: number; endLine: number; endCol: number };
  activeFileId: string;
  pointer?: { fileId: string; x: number; y: number }; // content-space, for live draw cursors
};
```

Identity is a name + colour chosen at join and cached in `localStorage`. No accounts, no auth.

### 4.3 Shapes

```ts
type Point = { x: number; y: number; p?: number };   // content-space px; p = pen pressure

type Shape =
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string };

type Stroke = {
  id: string;
  fileId: string;             // a drawing belongs to the file it was drawn over
  authorId: string;
  color: string;
  width: number;
  shape: Shape;
  anchor?: { rel: string; dy: number };   // Phase 5: see §5.6. `rel` is a base64-encoded
  createdAt: number;                      // Yjs relative position into that file's Y.Text.
};
```

### 4.4 Postgres

```sql
CREATE TABLE rooms (
  id           TEXT PRIMARY KEY,
  ydoc_state   BYTEA NOT NULL,          -- Y.encodeStateAsUpdate(doc)
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  language     TEXT NOT NULL,
  by_user      TEXT NOT NULL,
  stdout       TEXT NOT NULL DEFAULT '',
  stderr       TEXT NOT NULL DEFAULT '',
  exit_code    INTEGER,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_room_created ON runs (room_id, created_at DESC);
```

The whole Y.Doc is stored as one opaque binary blob. The server does not — and must not — interpret it.
Run history is stored separately because it is server-authored, not collaborative state.

## 5. Components

### 5.1 Sync layer (`apps/web/lib/yjs`)

One hook, `useRoom(roomId)`, owns the `Y.Doc`, the `WebsocketProvider`, and the awareness instance, and
returns them plus a connection status. Everything collaborative reads from this one place.

**Known trap, guarded explicitly:** React StrictMode double-invokes effects in development. Creating the
provider inside a naive `useEffect` opens two sockets and the room shows phantom duplicate users. The hook
creates the doc/provider once (module-level ref keyed by roomId) and destroys on true unmount.

### 5.2 Editor (`components/Editor`)

Monaco via `@monaco-editor/react`, dynamically imported with `ssr: false` — Monaco touches `window` at
module scope and will crash a server render. `y-monaco`'s `MonacoBinding` ties the active file's `Y.Text`
to the Monaco model and, given the awareness instance, renders remote cursors and selection highlights.
Languages: JavaScript/TypeScript and Python, per the PRD.

### 5.3 Overlay canvas (`components/Canvas`)

An absolutely-positioned SVG layer above Monaco (`z-index` above the editor), rendering `strokes` for the
active file.

**Mode toggle**, exactly as `claude (2).md` specifies:

- *Code mode* → container has `pointer-events: none`; every event reaches Monaco.
- *Draw mode* → container has `pointer-events: auto`; the canvas captures pointer events and the editor
  is put in read-only.

**Coordinate space.** Points are stored in editor *content* space, not screen space:

```
contentX = clientX − editorRect.left + editor.getScrollLeft()
contentY = clientY − editorRect.top  + editor.getScrollTop()
```

and the SVG layer is rendered with `transform: translate(−scrollLeft, −scrollTop)`, recomputed on
`onDidScrollChange`. Screen-space storage was rejected: it breaks the moment two people have different
scroll positions, which is most of the time. Content space is also the substrate that makes line-anchoring
(§5.6) possible at all.

Freehand strokes are rendered with `perfect-freehand` (points → a filled outline path). Arrows, rects and
text are drawn directly as SVG. Live, in-progress strokes are rendered locally at pointer speed and
committed to the `Y.Array` on pointer-up; the remote author's *in-progress* stroke is broadcast through
awareness (`pointer`), so collaborators see the pen moving without flooding the CRDT with a document
operation per pointer event.

Undo removes the author's own most recent stroke. The eraser deletes strokes by hit-test.

### 5.4 Terminal (`components/Terminal`)

`xterm.js` docked at the bottom, fed by the `/exec` socket. It is a **shared output console**, not a pty:
a Run button (and `Ctrl`/`Cmd`+`Enter`), an stdin box whose contents are supplied to the process up front,
and a scrollback that every client in the room receives identically. Run history from before you joined is
fetched over REST on mount.

This is a deliberate, stated narrowing of the PRD's "interact with the terminal prompt". An interactive
shell requires a pty on a machine we control; the honest version on this infrastructure is
request/response execution with identical output for every participant. §10 records what it would take to
lift this.

### 5.5 Execution (`apps/ws-server/exec`)

```ts
interface CodeExecutor {
  run(req: { language: string; version?: string; code: string; stdin?: string }):
    Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>;
}
```

`PistonExecutor` implements it against the public Piston API. A `DockerExecutor` is a later, optional
adapter (§10) and must not require touching anything above this interface.

Wire protocol on `/exec`:

```
client → server : { type: 'run', fileName, language, code, stdin }
server → room   : { type: 'run:started', runId, byUser, fileName, at }
server → room   : { type: 'run:output', runId, stream: 'stdout'|'stderr', chunk }
server → room   : { type: 'run:done',   runId, exitCode, durationMs }
server → room   : { type: 'run:error',  runId, message }      // rate limited, timeout, executor down
```

The client that pressed Run sends the code snapshot it currently sees. The server therefore never reads
the CRDT, and the relay stays pure.

**On `run:output` being chunked:** Piston is request/response — it returns the complete stdout and stderr
when the process exits, so today the server emits exactly one `run:output` per non-empty stream. The
protocol is chunked anyway so that a streaming executor (a self-hosted Docker runner with a pty, §10) can
be dropped in behind `CodeExecutor` without changing the wire format or the terminal component. Do not
build a "streaming" Piston adapter; it cannot exist.

**Rate limiting** is server-side and non-negotiable: a token bucket per room (1 run / 2s) and per IP
(20 runs / min). Piston's public instance allows roughly 5 requests/second across all its users; hammering
it is both rude and the fastest way to get the demo blocked. A rejected run returns `run:error` and the
Run button shows a cooldown.

### 5.6 Line anchoring (Phase 5)

When a shape is committed, its topmost point is mapped to a line, that line's start is mapped to an
offset in the file's `Y.Text`, and we store a **Yjs relative position** (`Y.createRelativePositionFromTypeIndex`,
encoded to base64) plus the pixel offset `dy` within the line.

Relative positions are the correct primitive here, and the reason is worth stating: a stored *line number*
would go stale the moment anyone inserts a line above it, and every client would then race to write a
corrected line number back into the CRDT. A relative position instead binds to a character in the text
itself. It survives concurrent edits by construction, and each client resolves it to an absolute index
**locally** (`Y.createAbsolutePositionFromRelativePosition`) with no write-back and therefore no race.

Rendering an anchored shape is then: relative position → absolute index → Monaco line →
`editor.getTopForLineNumber(line) + dy`, recomputed on `onDidChangeModelContent` and `onDidScrollChange`.
Insert ten lines above an annotated block and the annotation travels down with the code it describes —
on every client, without a single extra document operation.

If the anchored text is deleted outright, the relative position resolves to `null`; the shape falls back
to its stored content-space coordinate and is rendered dimmed, marking it as orphaned rather than
silently vanishing.

## 6. Persistence and Room Lifecycle

The server holds `Map<roomId, { ydoc, connections }>`.

- **First connection to a room** → load `ydoc_state` from Postgres and apply it; if absent, create an
  empty doc seeded with `main.py`.
- **On update** → debounce 2s, then `Y.encodeStateAsUpdate(doc)` and upsert.
- **Last client leaves** → flush immediately, then evict from memory after a 30s grace period (so a
  refresh doesn't pay a database round-trip).
- Rooms untouched for 30 days are deleted by a cleanup query on boot. A sandbox is disposable by design.

## 7. Error Handling and Resilience

This is what separates a demo that feels real from one that feels like a toy.

- **Reconnection.** `y-websocket` reconnects with exponential backoff. A visible pill shows
  Connected / Reconnecting / Offline. Yjs keeps accepting edits while offline and merges them on
  reconnect — that convergence *is* the CRDT thesis, so Phase 5 gives it a deliberate demo affordance
  rather than hiding it.
- **Render cold start.** The free tier sleeps after idling; the first connection can take 30–50s. The UI
  shows an explicit "waking the sandbox…" state instead of a dead Run button and a spinner that lies.
- **Executor failures.** Piston 429s, timeouts, unsupported languages, and network errors are surfaced as
  red lines in the terminal with a human explanation. Never silent, never a swallowed promise.
- **Monaco/SSR.** Dynamic import with `ssr: false`; a skeleton renders server-side.
- **StrictMode double-mount.** Guarded in `useRoom` (§5.1). Without it, every dev session shows two of you.
- **Malformed messages.** Every inbound `/exec` message is validated (zod) at the boundary; anything that
  fails validation closes the socket rather than being coerced.

## 8. Testing Strategy

Written test-first, per phase.

- **Unit (Vitest).** Coordinate transforms (screen ↔ content, round-trip); doc-schema helpers
  (create/rename/delete file); stroke serialisation; the token-bucket rate limiter; the Piston adapter
  against a mocked `fetch`, including 429 and timeout paths; Postgres encode/decode round-trip.
- **Integration (Node).** Boot the server, connect two real Yjs clients, edit concurrently, assert
  convergence. Send a run over `/exec` with a stubbed executor and assert *both* clients receive
  `run:started`, `run:output`, `run:done`. Kill and restore a connection and assert no lost updates.
- **E2E (Playwright, two browser contexts).** The flagship test, and it mirrors the success criteria: A
  types → B sees it and B sees A's cursor; A draws over line 12 while B is scrolled elsewhere → B sees it
  on line 12; A runs → B sees the output; reload → state survives.

## 9. Security Posture (and its honest limits)

- User code **never** executes on our server or the host. The server shells out to nothing; it makes an
  HTTPS call to Piston, which runs the code in an isolated, network-less container with hard CPU, memory
  and wall-clock limits. This is the PRD's highest-priority NFR, met.
- Server-side rate limiting protects both Piston and us from an abusive client.
- All `/exec` input is schema-validated at the boundary; code is a string we forward, never something we
  evaluate, interpolate into a shell, or write to disk.
- **Known and accepted:** the room id is the only access control. Anyone with the URL can read and edit
  the room. That is correct for a disposable sandbox and wrong for anything private; the README will say
  so plainly. Adding auth is not in scope.
- No secrets in the client bundle. Database URL and any Piston configuration live only on the server.

## 10. Explicitly Out of Scope

From the PRD's own Phase-1 exclusions: full IDE features, GitHub/GitLab integration, voice/video.

Additionally out of scope for this build, with the reason:

- **Redis pub/sub backplane and multi-instance scaling.** One server instance is sufficient for a demo,
  and the `/exec` design (single execution authority) is the piece that would otherwise break under
  horizontal scaling — so the architecture is ready for it without the operational cost of building it.
- **Self-hosted Docker executor and an interactive pty.** Requires a VPS with a Docker daemon.
  The `CodeExecutor` interface is the seam; adding a `DockerExecutor` plus `node-pty` streaming would be a
  self-contained project that touches nothing above that interface.
- **Accounts, auth, private rooms.**

## 11. Phases

Each phase ends in something demonstrable. No phase leaves the app broken.

| Phase | Ships | Proof it works |
|---|---|---|
| **0 — Scaffold** | pnpm monorepo, Next.js + TS + Tailwind, ws-server skeleton, shared types, Vitest + Playwright wired, one `pnpm dev` boots both | App shell renders; WS handshake succeeds; a trivial test passes in CI |
| **1 — Collaborative editor** | `useRoom` hook, Y.Doc schema, `/sync` relay, Monaco + `y-monaco`, awareness cursors and selection highlights, join modal (name + colour), room URLs, connection pill | Two tabs type into one document; coloured cursors and name tags; convergence test green |
| **2 — Shared execution** | `/exec` channel, `CodeExecutor` + Piston adapter, token-bucket limiter, xterm.js panel, Run button + `Ctrl`+`Enter`, stdin, run history over REST | A presses Run; **B** sees the same output appear |
| **3 — Overlay canvas** | SVG layer, freehand/arrow/rect/text, mode toggle with `pointer-events`, content-space coordinates that track scroll, per-user colour, eraser, undo-own-stroke, live remote pen via awareness | A draws over line 12; B — scrolled elsewhere — sees it on line 12 |
| **4 — Persistence + multi-file** | Neon Postgres store, debounced flush + rehydrate + room TTL, file tabs (create/rename/delete/switch), per-file text and strokes, language from extension | Close every tab; reopen the link tomorrow; the code, files and drawings are all there |
| **5 — Anchors, polish, deploy** | Line-anchored shapes, offline/merge demo affordance, empty and loading states, keyboard shortcuts, Netlify + Render + Neon deploy, README with a GIF | Insert lines above an annotated block; the annotation follows its code |

Phase order rationale: the editor is the spine everything else attaches to. Execution comes second because
it is independent of the canvas and is the second-most-persuasive thing to show. The canvas is the
differentiator but needs a stable editor beneath it. Persistence and multi-file are data-model work, best
done once the shapes of code and strokes have stopped moving — which is why the *schema* for both is fixed
in Phase 1 even though the UI arrives in Phase 4.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Piston's public quota (~5 req/s) throttles or blocks us | Server-side token bucket; `run:error` surfaced honestly; `CodeExecutor` seam allows self-hosting Piston later |
| Render free-tier cold start makes the first impression a 45s spinner | Explicit "waking the sandbox…" UI; README notes it; upgrading to a paid instance is a config change |
| Canvas and Monaco fight over pointer events | The mode toggle is a hard `pointer-events` switch, not a heuristic — and it is tested in Playwright |
| Yjs + React StrictMode double-connect | Guarded provider creation in `useRoom`; asserted by the "no duplicate peers" test |
| Scope creep toward a real IDE | §10 is the contract; anything not in §11 is a later project |
