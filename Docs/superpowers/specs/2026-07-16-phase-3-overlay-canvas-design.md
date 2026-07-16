# Phase 3 — Overlay Drawing Canvas — Design

Date: 2026-07-16
Status: Approved
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§3, §4.3, §5.3, §11 row 3)
Builds on: Phase 1 (collaborative editor) and Phase 2 (shared execution), both complete.

## 1. Purpose

Anyone in the room draws over the code — freehand, arrows, boxes, and short text labels — and **everyone**
sees the drawing pinned to the *same code*, even when they are scrolled to different places. That is the
master spec's success criterion for Phase 3:

> A draws over line 12; B — scrolled elsewhere — sees it on line 12.

The whole phase exists to make that one sentence true, and to make it provable by an end-to-end test with
two real browsers.

User drawings are collaborative state. They live in the Y.Doc and sync through the Phase 1 `/sync` relay
**untouched** — the relay never learns what a stroke is. Phase 3 therefore adds **no** ws-server code; it
is `apps/web` plus one small `@sandbox/shared` schema addition.

## 2. What ships, and what does not

Decided during brainstorming, recorded here rather than inferred from the master spec's larger list.

**Ships in Phase 3:**

- Four tools: **freehand**, **arrow**, **rect**, and a **lightweight one-line text label**.
- **Eraser** (hit-test, deletes any stroke), **undo** (own last stroke only), **per-user colour** (the
  drawer's identity colour — no colour picker), and a **Code/Draw mode toggle**.
- **Content-space coordinates that track scroll** — the crux of the acceptance test.
- The **live remote pen**: each person's in-progress stroke is broadcast over awareness, so collaborators
  watch the pen move before pointer-up.

**Explicitly out of scope (§8):** line-anchoring (Phase 5), multi-file tabs (Phase 4), Postgres persistence
(Phase 4), and redo / colour picker / width UI / shape select-move-resize / multi-line rich text.

## 3. Architecture

### 3.1 The overlay and the mode toggle

An absolutely-positioned `<svg>` layer inside the editor region, stacked above Monaco (`absolute inset-0`,
`z-index` above the editor). It renders the active file's strokes.

A **Code/Draw mode toggle** flips a single `pointer-events` switch — a hard switch, not a heuristic, and the
one thing that reliably stops the canvas and editor from fighting over the pointer:

- **Code mode** → overlay `pointer-events: none`; every event reaches Monaco; the editor behaves normally.
- **Draw mode** → overlay `pointer-events: auto`; the overlay captures the pen; Monaco is put `readOnly`
  so a stray keystroke cannot edit code while you draw.

Default is Code mode.

### 3.2 Coordinates — the crux

Points are stored in Monaco **content space**, never screen space:

```
contentX = clientX − editorRect.left + editor.getScrollLeft()
contentY = clientY − editorRect.top  + editor.getScrollTop()
```

and a `<g transform="translate(−scrollLeft, −scrollTop)">` wraps the committed strokes, recomputed on
Monaco's `onDidScrollChange`. "Line 12" is a content-space position, not a pixel on anyone's screen — so the
same stroke lands on the same code for every viewer regardless of their scroll offset. Screen-space storage
was rejected: it breaks the moment two people have different scroll positions, which is most of the time.

### 3.3 Transport — no server changes

Committed strokes live in the existing `strokes` `Y.Array<Stroke>` and sync through the Phase 1 `/sync`
relay, which never parses document semantics. The **live in-progress pen** rides on **awareness**
(ephemeral, never persisted), throttled, and clears on pointer-up when the real stroke commits to the CRDT.

### 3.4 Two alternatives considered and rejected

- **Monaco decorations / view-zones** to host drawings in Monaco's own coordinate system — fights Monaco,
  cannot render freehand, and couples drawings to the editor's internals. Rejected.
- **Line-anchoring strokes now** (Yjs relative positions) instead of content space — that is explicitly
  Phase 5. The schema already reserves `anchor?`, and content space is the substrate anchoring builds on.
  Pulling it forward is YAGNI for Phase 3. Rejected.

## 4. Data Model

Almost everything is already in `@sandbox/shared/model.ts` from Phase 1 — the point of having designed the
schema early.

### 4.1 Unchanged

`Stroke`, `Shape`, `Point` are unchanged:

```ts
type Point = { x: number; y: number; p?: number };   // content-space px; p = pen pressure

type Shape =
  | { kind: 'freehand'; points: Point[] }
  | { kind: 'arrow'; from: Point; to: Point }
  | { kind: 'rect'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string };

type Stroke = {
  id: string;
  fileId: string;
  authorId: string;
  color: string;
  width: number;
  shape: Shape;
  anchor?: { rel: string; dy: number };   // Phase 5 — reserved
  createdAt: number;
};
```

`getStrokes(doc): Y.Array<Stroke>` already exists.

### 4.2 One awareness addition

`AwarenessState` gains a `draft?` field — the in-progress shape for the live pen:

```ts
type DraftStroke = { fileId: string; color: string; width: number; shape: Shape };

type AwarenessState = {
  user: User;
  activeFileId: string;
  pointer?: { fileId: string; x: number; y: number };
  draft?: DraftStroke;                     // set (throttled) while drawing; cleared on pointer-up
};
```

The draft is ephemeral by nature — never persisted, exactly like a cursor. When a peer disconnects
mid-stroke, Phase 1 already clears their awareness, so no orphaned in-progress stroke is left behind and
nothing was ever half-committed.

### 4.3 Three doc accessors (new, in `doc.ts`)

All `Y.Array` mutation lives in one tested place, next to `setFileLanguage`:

```ts
appendStroke(doc: Y.Doc, stroke: Stroke): void;       // commit on pointer-up
eraseStroke(doc: Y.Doc, id: string): void;            // eraser; no-op if the id is already gone
undoLastStrokeBy(doc: Y.Doc, authorId: string): void; // undo — the author's most recent surviving stroke
```

## 5. Components

All in `apps/web`, mirroring the Phase 1/2 patterns (pure modules + a render layer + a small context).

### 5.1 Pure modules — `lib/canvas/` (unit-tested, no React)

- `coords.ts` — `toContentPoint(clientX, clientY, rect, scroll): Point`. The one formula everything depends on.
- `hitTest.ts` — `hits(stroke, point, tolerance): boolean`. Distance-to-segment for freehand/arrow, edge/area
  test for rect, bounding-box for text. Drives the eraser.
- `draft.ts` — a pure builder: given the active tool and the pointer path so far, produce the in-progress
  `Shape` (freehand accumulates points; arrow/rect track `from` → current). The reducer-equivalent of
  Phase 2's `state.ts`. Discards degenerate shapes (see §7).
- `freehand.ts` — a thin wrapper over `perfect-freehand`: `points → SVG path d`.

### 5.2 React

- `lib/canvas/CanvasContext.tsx` — tool/mode state shared by the toolbar and overlay:
  `mode: 'code' | 'draw'`, `tool: 'freehand' | 'arrow' | 'rect' | 'text' | 'eraser'`. The draw colour is the
  user's identity colour; there is no colour picker in Phase 3. Stroke `width` is a fixed constant (there is
  no width UI in Phase 3) — one value in `@sandbox/shared`, so a width picker is a later additive change.
- `lib/yjs/useStrokes.ts` — subscribes to the `strokes` `Y.Array` → `Stroke[]` for the active file (the
  `useFile` pattern from Phase 2).
- `components/CanvasOverlay.tsx` — the SVG layer. Takes the mounted Monaco `instance`; reads `strokes` and
  remote `draft`s; renders committed strokes and remote drafts; in Draw mode captures pointer events, builds
  the draft, broadcasts it throttled over awareness, and commits on pointer-up; owns the `translate(−scroll)`
  transform via `onDidScrollChange`; and toggles Monaco `readOnly` when the mode flips.
- `components/Toolbar.tsx` — the Code/Draw toggle, the tool buttons, and undo. Lives in the workspace header.

### 5.3 Integration

`CodeEditor.tsx` wraps `<Editor>` and `<CanvasOverlay instance={instance}>` in a `relative` container
(overlay `absolute inset-0`). `Toolbar` goes in the header next to the RunBar. No ws-server changes; the exec
path is untouched.

### 5.4 Rendering

- **freehand** → a filled `perfect-freehand` outline `<path>`.
- **arrow** → a `<line>` plus an arrowhead `<polygon>`.
- **rect** → a stroked `<rect>` (no fill).
- **text** → an SVG `<text>` at the point, in the author's colour.
- **remote drafts** → the same renderers, drawn translucent in the author's colour.

## 6. Interaction

- **Mode toggle** (default Code). Draw → overlay captures the pen, Monaco `readOnly`. Switching back to Code,
  or pressing `Esc`, cancels any in-progress draft cleanly (local state and awareness both cleared).
- **Freehand:** down starts, move accumulates points (rendered locally at full speed, broadcast throttled),
  up commits.
- **Arrow / rect:** down sets `from`, move updates `to` with a live preview, up commits. A click with no drag
  is discarded.
- **Text:** click places a one-line `<input>` at the content point; Enter or blur commits `{kind:'text'}`,
  Escape or empty cancels; not re-editable in Phase 3 (erase and redraw). While the input is open, other
  tools are inert until it commits or cancels.
- **Eraser:** down + drag hit-tests strokes under the pointer and deletes any match (deduped within one
  gesture). It deletes *any* stroke — this is a shared canvas.
- **Undo:** `Ctrl`/`Cmd`+`Z` removes the current user's most recent surviving stroke. It is a document-level
  keydown listener gated to Draw mode; Monaco is `readOnly` in Draw mode, so its own undo is inert and there
  is no conflict.
- **Live pen:** awareness `draft` is updated at most ~every 40 ms during a stroke, and cleared on commit or
  cancel. Remote drafts render translucent in the author's colour.

## 7. Error Handling & Edge Cases

- **Disconnect mid-stroke:** the draft is awareness-only, and Phase 1 already clears a peer's awareness on
  disconnect — no orphaned in-progress stroke, nothing half-committed.
- **Degenerate strokes discarded:** a zero-length arrow or rect, empty text, and freehand with fewer than two
  points are never committed.
- **Concurrent erase:** `eraseStroke(id)` is a no-op if the id is already gone; the CRDT resolves concurrent
  deletes.
- **Code mode must not eat events:** `pointer-events: none` in Code mode is asserted by a test that typing
  still edits the document with strokes on screen.
- **Scroll and resize:** the transform is recomputed on `onDidScrollChange`; `automaticLayout` handles editor
  resize; pointer math reads `getBoundingClientRect()` and the scroll offsets at event time, so it is correct
  under both.

## 8. Out of Scope for Phase 3

- **Line-anchoring** — Phase 5. `anchor?` is reserved in the schema.
- **Multi-file tabs** — Phase 4. Phase 3 draws over the one seeded file; the `fileId` filter is already in
  place so strokes are per-file from the start.
- **Persistence** — Phase 4 (Postgres). Strokes die with the room's grace period, like the document.
- **Redo, colour picker, width UI, shape select/move/resize, multi-line rich text, image paste** — later or
  never.

## 9. Testing

Written test-first, as in Phases 1 and 2.

**Unit (Vitest).**
- `coords.toContentPoint`: a known rect + scroll offset maps to the expected content point.
- `hitTest`: a point on and off a freehand path, an arrow segment, a rect edge, and a text bounding box, at
  and beyond tolerance.
- `draft`: freehand accumulation; arrow/rect `from` → `to`; degenerate shapes discarded.
- `doc.ts` accessors: `appendStroke` / `eraseStroke` / `undoLastStrokeBy` — order, author-filter, idempotent
  delete — the `setFileLanguage` test pattern.
- A two-`Y.Doc` convergence test: a stroke appended on one doc appears on the other, and concurrent erases
  resolve.

**E2E (Playwright, two browser contexts).** Asserting on real SVG elements avoids the xterm-viewport trouble
from Phase 2 — the DOM is genuinely there to read.
1. **Acceptance:** A enters Draw mode and draws over line 12; B, scrolled elsewhere, sees the stroke at the
   same content position.
2. **Mode toggle:** in Code mode, with strokes present, typing still edits Monaco; in Draw mode, drawing does
   not change the document.
3. **Live pen:** A holds a stroke (pointer down + move, no pointer-up); B sees the draft appear.
4. **Undo / eraser:** undo removes the author's own last stroke; the eraser removes a stroke by hit-test.

## 10. Self-Review

**Spec coverage.** Every shipped feature in §2 has a home: overlay + mode toggle → §3.1, §5.2 (`CanvasOverlay`,
`Toolbar`); content-space coordinates → §3.2, `coords.ts`; transport → §3.3 (no server changes); tools →
§5.4, §6; eraser/undo/colour → §4.3, §6; live pen → §4.2, §6; testing → §9. Nothing in §2 is unassigned, and
nothing outside §2 is designed in.

**Deviation from the master spec's larger canvas.** The master spec's §5.3 lists the same tool set; Phase 3
ships all of it, narrowing only the text tool to a single non-editable line (recorded in §2 and §6). The
colour picker the master spec implies is dropped in favour of the drawer's identity colour — one fewer piece
of UI for no loss to the acceptance test.

**The one property everything rests on.** Content-space storage plus a scroll-synced transform. If the
acceptance test ever fails, this is where to look first — a stroke drifting from its code means the transform
or the `toContentPoint` formula is wrong, and both are unit-tested in isolation before the overlay is wired.
