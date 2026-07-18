# Phase 5 — Anchors, polish, and deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drawing follows the code it describes. Insert ten lines above an annotated block and the annotation travels down with it, on every client, with no extra document operations — plus the offline affordance, the empty and loading states, the shortcuts, and a deployable stack.

**Architecture:** A committed stroke stores a **Yjs relative position** into its file's `Y.Text` plus a pixel offset `dy`. Each client resolves that locally on every content change — no write-back, so no race. The pure encode/resolve lives in `packages/shared/src/anchor.ts` so it is testable without a browser and usable from a two-client socket test; only the pixel↔line mapping needs Monaco.

**Tech Stack:** Everything from Phases 1–4b. No new runtime dependencies. Deployment adds `@netlify/plugin-nextjs` as a build-time dev dependency.

Spec: `Docs/superpowers/specs/2026-07-18-phase-5-anchors-polish-deploy-design.md`.
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.3, §5.6, §7, §11 row 5).

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` server stays a **pure relay**. Anchors are a client-side Y.Doc write; `/sync` needs no changes.
- **`packages/shared` compiles against `lib: ["ES2022"]` and nothing else.** No DOM, no `@types/node`. There is no `btoa`, no `Buffer`, no `crypto`. This is why `rel` is JSON and why ids are passed in.
- **`assoc = 0`** in `createRelativePositionFromTypeIndex`. Measured: with `assoc = 0` an insert at the anchored offset moves the anchor to index 8; with `assoc = -1` it stays at 4. The whole feature is that difference.
- **Orphan detection uses the item tombstone, never `null`.** Measured against `yjs@13.6.31`: deleting the anchored text still resolves to index 4, and emptying the document resolves to 0. `null` means only "this doc has never seen the type".
- **`SCHEMA_VERSION` stays at `1`.** `anchor` is already declared and optional; writing a field that was always in the type is not a schema change.
- **Strokes drawn before this phase are never retro-anchored** — no migration, no write-back.
- **Run stays single-file.** `RunRequest` is unchanged.
- Tests gated on `DATABASE_URL` are part of done. `pnpm db:up` boots a local Postgres. Run them.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

```text
packages/shared/src/
  anchor.ts                       NEW  Anchor, AnchorResolution, createAnchor, resolveAnchor
  anchor.test.ts                  NEW
  model.ts                        MOD  Stroke.anchor uses the Anchor type
  index.ts                        MOD  export * from './anchor.js'
  exec.ts                         MOD  + { type: 'exec:hello'; executionEnabled: boolean }

apps/web/
  lib/canvas/anchorLine.ts        NEW  topmostPoint, lineAtContentY
  lib/canvas/anchorLine.test.ts   NEW
  components/CanvasOverlay.tsx    MOD  write anchor on commit; per-stroke transform; dim orphans
  lib/yjs/RoomContext.tsx         MOD  isOffline, setOffline, pendingUpdates
  components/ConnectionPill.tsx   MOD  offline toggle, manual vs real, waking state
  lib/exec/ExecContext.tsx        MOD  executionEnabled from exec:hello
  components/RunBar.tsx           MOD  offline predicate + executionEnabled message
  lib/exec/render.ts              MOD  empty-terminal hint (Terminal is xterm, not JSX)
  lib/exec/render.test.ts         MOD
  components/Shortcuts.tsx        NEW  document-level keys + ? cheatsheet
  components/Workspace.tsx        MOD  mount <Shortcuts />

apps/ws-server/src/
  env.ts                          MOD  executionEnabled
  exec/connection.ts              MOD  send exec:hello before run:history
  server.ts                       MOD  thread executionEnabled into ExecDeps
apps/ws-server/test/
  anchor.test.ts                  NEW  two clients: B edits above, both resolve one line

e2e/
  anchor.spec.ts                  NEW  the roadmap proof + the orphan case
  offline.spec.ts                 NEW  toggle, pending count, converge on reconnect

netlify.toml                      NEW  repo root
render.yaml                       NEW  repo root
Docs/deploy-runbook.md            NEW
scripts/record-demo.mjs           NEW
README.md                         MOD
```

**Task order rationale.** Tasks 1–2 are pure and additive, so the suite stays green with nothing wired up. Task 3 is the only change to drawing behaviour and lands with its own tests. Tasks 4–5 prove it across clients and browsers. Tasks 6–10 are independent of anchoring and of each other. Tasks 11–12 touch no application code.

---

### Task 1: `anchor.ts` — encode and resolve

Pure, no DOM, no Monaco. This is the whole correctness surface of the phase.

**Files:**
- Create: `packages/shared/src/anchor.ts`
- Test: `packages/shared/src/anchor.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/model.ts`

**Interfaces:**
- Consumes: `yjs`.
- Produces:
  - `type Anchor = { rel: string; dy: number }`
  - `type AnchorResolution = { kind: 'anchored'; index: number } | { kind: 'orphaned' }`
  - `createAnchor(text: Y.Text, index: number, dy: number): Anchor`
  - `resolveAnchor(doc: Y.Doc, anchor: Anchor): AnchorResolution`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/anchor.test.ts`:

```ts
import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { createAnchor, resolveAnchor } from './anchor.js';

/** Indices: a=0 a=1 a=2 \n=3 b=4 b=5 b=6 \n=7 c=8 c=9 c=10 */
const seed = (doc: Y.Doc) => {
  const text = doc.getText('file:main');
  text.insert(0, 'aaa\nbbb\nccc');
  return text;
};

test('an anchor round-trips to the index it was created at', () => {
  const doc = new Y.Doc();
  const text = seed(doc);

  const anchor = createAnchor(text, 4, 12);

  expect(anchor.dy).toBe(12);
  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 4 });
});

test('inserting a line AT the anchored offset carries the anchor down with its code', () => {
  // The headline behaviour of the phase, and precisely what assoc=0 buys. A result of 4 here
  // means assoc regressed to -1: the annotation stayed behind while its code moved.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.insert(4, 'XXX\n');

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 8 });
});

test('inserting before the anchor shifts it', () => {
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.insert(0, 'ZZ');

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 6 });
});

test('deleting the anchored character orphans the anchor', () => {
  // Yjs still resolves this to index 4 — the surviving neighbour — so a null check would call a
  // dead anchor healthy. The tombstone is the only honest signal.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.delete(4, 3);

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'orphaned' });
});

test('deleting text around the anchor leaves it anchored', () => {
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.delete(5, 2); // the 2nd and 3rd 'b'; the anchored one survives

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 4 });
});

test('a peer that receives the deletion agrees it is orphaned', () => {
  // Orphan state must be identical for everyone, or two people see different annotations over
  // the same code.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  expect(resolveAnchor(peer, anchor)).toEqual({ kind: 'anchored', index: 4 });

  text.delete(4, 3);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

  expect(resolveAnchor(peer, anchor)).toEqual({ kind: 'orphaned' });
});

test('an anchor from a document this client has never seen is orphaned, not a crash', () => {
  const doc = new Y.Doc();
  const anchor = createAnchor(seed(doc), 4, 0);

  expect(resolveAnchor(new Y.Doc(), anchor)).toEqual({ kind: 'orphaned' });
});

test('a malformed anchor is orphaned, not a crash', () => {
  // Anchors arrive from other clients; this is a trust boundary.
  expect(resolveAnchor(new Y.Doc(), { rel: 'not json', dy: 0 })).toEqual({ kind: 'orphaned' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox/shared test anchor`
Expected: FAIL — cannot find module `./anchor.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/anchor.ts`:

```ts
import * as Y from 'yjs';

/** A stroke's binding to a character in its file's text. See the Phase 5 design §3. */
export type Anchor = { rel: string; dy: number };

export type AnchorResolution = { kind: 'anchored'; index: number } | { kind: 'orphaned' };

/** The shape of `Y.relativePositionToJSON`. `item` is absent for a position at the very start. */
type RelJson = { item?: { client: number; clock: number } };

/**
 * `assoc = 0` associates the position with the character that FOLLOWS it, and that is the entire
 * feature. Inserting a newline at the anchored offset is what "add a line above the annotated
 * block" means; assoc=0 keeps the anchor on the original character as it moves down, while
 * assoc=-1 would bind to the end of the preceding text and stay put.
 *
 * The encoding is JSON, not the master spec's base64: this package compiles against
 * `lib: ["ES2022"]` alone, so neither `btoa` nor `Buffer` exists here. That constraint is
 * deliberate — it is the same one that forces ids to be passed in rather than generated.
 */
export const createAnchor = (text: Y.Text, index: number, dy: number): Anchor => ({
  rel: JSON.stringify(
    Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index, 0)),
  ),
  dy,
});

/**
 * Yjs resolves an anchor whose text was deleted to the surviving neighbour's index, NOT to null,
 * so a null check reports a dead anchor as healthy. The anchored item's tombstone is the honest
 * signal, and a synced peer independently agrees with it — which is what keeps orphan state the
 * same for every viewer instead of per-client.
 *
 * Every failure path returns `orphaned` rather than throwing: anchors are written by other
 * clients, so this is a trust boundary.
 */
export const resolveAnchor = (doc: Y.Doc, anchor: Anchor): AnchorResolution => {
  let json: RelJson;
  try {
    json = JSON.parse(anchor.rel) as RelJson;
  } catch {
    return { kind: 'orphaned' };
  }

  let index: number;
  try {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      doc,
    );
    if (!absolute) return { kind: 'orphaned' };
    index = absolute.index;
  } catch {
    return { kind: 'orphaned' };
  }

  // No item id means a position pinned to the start of the type, which cannot be deleted.
  const id = json.item;
  if (id) {
    try {
      if (Y.getItem(doc.store, Y.createID(id.client, id.clock)).deleted) {
        return { kind: 'orphaned' };
      }
    } catch {
      // Not in the store: this client has not received that update, so it cannot be placed.
      return { kind: 'orphaned' };
    }
  }

  return { kind: 'anchored', index };
};
```

In `packages/shared/src/index.ts`, add the export **before** `./model.js` so the type is available to it:

```ts
export * from './anchor.js';
export * from './model.js';
export * from './doc.js';
export * from './exec.js';
```

In `packages/shared/src/model.ts`, replace the inline anchor shape with the named type. Add the import at the top:

```ts
import type { Anchor } from './anchor.js';
```

and change the field on `Stroke`:

```ts
  anchor?: Anchor;            // Phase 5: a relative position into that file's Y.Text.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sandbox/shared test`
Expected: PASS — 8 new tests green, existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/anchor.ts packages/shared/src/anchor.test.ts packages/shared/src/index.ts packages/shared/src/model.ts
git commit -m "feat(shared): anchors bind a stroke to a character, not a line number

assoc=0 is the feature: an insert at the anchored offset carries the
anchor down with its code. assoc=-1 would leave it behind.

Orphan detection reads the item tombstone rather than a null resolution,
because Yjs resolves a deleted anchor to the surviving neighbour and a
null check would call it healthy. A synced peer agrees with the
tombstone, so orphan state is the same for everyone.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `anchorLine.ts` — the pixel↔line mapping

The only Monaco-shaped logic, kept pure by taking `topForLine` as a function.

**Files:**
- Create: `apps/web/lib/canvas/anchorLine.ts`
- Test: `apps/web/lib/canvas/anchorLine.test.ts`

**Interfaces:**
- Consumes: `Point`, `Shape` from `@sandbox/shared`.
- Produces:
  - `topmostPoint(shape: Shape): Point`
  - `lineAtContentY(y: number, lineCount: number, topForLine: (line: number) => number): number`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/canvas/anchorLine.test.ts`:

```ts
import { expect, test } from 'vitest';
import { lineAtContentY, topmostPoint } from './anchorLine';

/** Uniform 19px lines, as Monaco reports them for a default editor. */
const uniform = (line: number) => (line - 1) * 19;

/**
 * Line 3 wraps to double height, so lines below it are pushed down. This is the case the
 * `y / lineHeight` shortcut gets wrong, which is why the implementation binary-searches.
 */
const wrapped = (line: number) => [0, 19, 38, 76, 95][line - 1]!;

test('the top of a line maps to that line', () => {
  expect(lineAtContentY(0, 5, uniform)).toBe(1);
  expect(lineAtContentY(19, 5, uniform)).toBe(2);
  expect(lineAtContentY(76, 5, uniform)).toBe(5);
});

test('a y inside a line maps to that line, not the next', () => {
  expect(lineAtContentY(18, 5, uniform)).toBe(1);
  expect(lineAtContentY(37, 5, uniform)).toBe(2);
});

test('a y below every line clamps to the last line', () => {
  expect(lineAtContentY(10_000, 5, uniform)).toBe(5);
});

test('a y above the first line clamps to line 1', () => {
  expect(lineAtContentY(-50, 5, uniform)).toBe(1);
});

test('non-uniform line heights resolve correctly', () => {
  // y=70 sits inside wrapped line 3, which spans 38..75. Dividing by a 19px line height would
  // answer 4, and the annotation would anchor to the wrong code.
  expect(lineAtContentY(70, 5, wrapped)).toBe(3);
  expect(lineAtContentY(76, 5, wrapped)).toBe(4);
});

test('topmostPoint picks the highest point of each shape kind', () => {
  expect(
    topmostPoint({ kind: 'freehand', points: [{ x: 0, y: 50 }, { x: 5, y: 20 }, { x: 9, y: 90 }] }),
  ).toEqual({ x: 5, y: 20 });

  expect(topmostPoint({ kind: 'rect', from: { x: 0, y: 90 }, to: { x: 10, y: 30 } })).toEqual({ x: 10, y: 30 });
  expect(topmostPoint({ kind: 'arrow', from: { x: 0, y: 10 }, to: { x: 10, y: 80 } })).toEqual({ x: 0, y: 10 });
  expect(topmostPoint({ kind: 'text', at: { x: 3, y: 7 }, text: 'hi' })).toEqual({ x: 3, y: 7 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sandbox/web test anchorLine`
Expected: FAIL — cannot find module `./anchorLine`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/canvas/anchorLine.ts`:

```ts
import type { Point, Shape } from '@sandbox/shared';

/** The highest point of a shape in content space — the point its anchor binds to. */
export const topmostPoint = (shape: Shape): Point => {
  switch (shape.kind) {
    case 'freehand':
      return shape.points.reduce((top, point) => (point.y < top.y ? point : top), shape.points[0]!);
    case 'arrow':
    case 'rect':
      return shape.from.y <= shape.to.y ? shape.from : shape.to;
    case 'text':
      return shape.at;
  }
};

/**
 * Content-space y → 1-based line number, by binary search for the last line whose top is at or
 * above `y`.
 *
 * `Math.floor(y / lineHeight) + 1` is shorter and wrong: it assumes every line has the same
 * height, which wrapped lines and view zones break. Monaco is the authority on where a line
 * starts, so ask it — `O(log n)` times, assuming nothing.
 */
export const lineAtContentY = (
  y: number,
  lineCount: number,
  topForLine: (line: number) => number,
): number => {
  let low = 1;
  let high = Math.max(1, lineCount);

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (topForLine(mid) <= y) low = mid;
    else high = mid - 1;
  }

  return low;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sandbox/web test anchorLine`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/canvas/anchorLine.ts apps/web/lib/canvas/anchorLine.test.ts
git commit -m "feat(web): map content-space y to a line by asking Monaco, not by dividing

Dividing by line height assumes uniform lines, which wrapped lines and
view zones break — and a wrong line anchors the annotation to the wrong
code. Binary search over getTopForLineNumber assumes nothing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Anchor strokes on commit, and place them on render

The task that makes the feature real.

**Files:**
- Modify: `apps/web/components/CanvasOverlay.tsx`

**Interfaces:**
- Consumes: `createAnchor`, `resolveAnchor`, `getFileText` from `@sandbox/shared`; `topmostPoint`, `lineAtContentY` from Task 2.
- Produces: strokes render inside `<g data-testid="stroke" data-orphaned?>` with a vertical transform.

- [ ] **Step 1: Extend the `@sandbox/shared` import**

In `apps/web/components/CanvasOverlay.tsx`, replace the existing import block:

```tsx
import {
  type Anchor,
  type DraftStroke,
  STROKE_WIDTH,
  type Shape,
  type Stroke,
  appendStroke,
  createAnchor,
  eraseStroke,
  getFileText,
  resolveAnchor,
} from '@sandbox/shared';
```

and add, beside the other local imports:

```tsx
import { lineAtContentY, topmostPoint } from '@/lib/canvas/anchorLine';
import { useMemo } from 'react';
```

(`useMemo` joins the existing `react` import rather than adding a second one.)

- [ ] **Step 2: Re-render when the text changes**

A stroke's position now depends on the document text, so the overlay must re-render when it
changes. Add below the existing scroll effect (`instance.onDidScrollChange`, around line 85):

```tsx
  // A stroke's anchored position depends on the text, so a remote edit must repaint the overlay.
  // The model is swapped when the active file changes, so this resubscribes on activeFileId.
  const [contentVersion, setContentVersion] = useState(0);
  useEffect(() => {
    const model = instance.getModel();
    if (!model) return;

    const sub = model.onDidChangeContent(() => setContentVersion((version) => version + 1));
    return () => sub.dispose();
  }, [instance, activeFileId]);
```

- [ ] **Step 3: Build the anchor when a stroke is committed**

Add above `onPointerDown`:

```tsx
  /**
   * The anchor binds the shape's topmost point to the first character of the line it sits on.
   * `undefined` when there is no model yet — a stroke without an anchor is legacy-rendered, which
   * is strictly better than one anchored to a guess.
   */
  const anchorFor = (shape: Shape): Anchor | undefined => {
    const model = instance.getModel();
    if (!model) return undefined;

    const top = topmostPoint(shape);
    const line = lineAtContentY(top.y, model.getLineCount(), (l) => instance.getTopForLineNumber(l));
    const index = model.getOffsetAt({ lineNumber: line, column: 1 });

    return createAnchor(getFileText(doc, activeFileId), index, top.y - instance.getTopForLineNumber(line));
  };
```

In `onPointerUp`, add the anchor to the appended stroke:

```tsx
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: activeFileId,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape,
        anchor: anchorFor(shape),
        createdAt: Date.now(),
      });
```

In `commitText`, the same — note the shape is built first so the anchor can be taken from it:

```tsx
  const commitText = () => {
    const text = textValue.trim();
    if (textAt && text) {
      const shape: Shape = { kind: 'text', at: textAt, text };
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: activeFileId,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape,
        anchor: anchorFor(shape),
        createdAt: Date.now(),
      });
    }
    setTextAt(null);
    setTextValue('');
  };
```

- [ ] **Step 4: Place each stroke on render**

Add above the `return`:

```tsx
  /**
   * Three states, per the design §3.7. A legacy stroke (no anchor) renders exactly where it always
   * did; an orphan falls back to the same coordinates but dimmed, so losing the code it described
   * is visible rather than silent; an anchored stroke moves by however far its line has travelled.
   */
  const placed = useMemo(
    () =>
      strokes.map((stroke: Stroke) => {
        const model = instance.getModel();
        if (!stroke.anchor || !model) return { stroke, shift: 0, orphaned: false };

        const resolution = resolveAnchor(doc, stroke.anchor);
        if (resolution.kind === 'orphaned') return { stroke, shift: 0, orphaned: true };

        const line = model.getPositionAt(resolution.index).lineNumber;
        const anchoredTop = instance.getTopForLineNumber(line) + stroke.anchor.dy;
        return { stroke, shift: anchoredTop - topmostPoint(stroke.shape).y, orphaned: false };
      }),
    // contentVersion is the point: it is what recomputes these after an edit.
    [strokes, doc, instance, contentVersion],
  );
```

and replace the committed-stroke map in the JSX:

```tsx
        {placed.map(({ stroke, shift, orphaned }) => (
          <g
            key={stroke.id}
            data-testid="stroke"
            data-orphaned={orphaned ? 'true' : undefined}
            transform={`translate(0, ${shift})`}
          >
            <ShapeView shape={stroke.shape} color={stroke.color} opacity={orphaned ? 0.35 : 1} />
          </g>
        ))}
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Drive it in a real browser**

Run `pnpm db:up && pnpm dev`, open a room, then:
- Draw a box over line 3. Put the cursor on line 1 and press Enter ten times. **The box follows the code down.**
- Scroll. The box stays on its code (the Phase 3 behaviour still works).
- Select the annotated line and delete it. The box **dims** and stays where it was.
- Reload. The box is still on its code.

**Stop and report if the box does not move.** The likely cause is `assoc`, and it is worth finding
before three more tasks are built on top.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/CanvasOverlay.tsx
git commit -m "feat(web): a drawing follows the code it describes

A committed stroke stores a relative position into its file's text and is
placed by resolving that locally on every content change — no write-back,
so no race, and no extra document operations.

Deleting the anchored code dims the stroke rather than moving it onto
whatever now occupies those pixels.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Two real clients agree on where an anchor points

**Files:**
- Create: `apps/ws-server/test/anchor.test.ts`

**Interfaces:**
- Consumes: `createSandboxServer`, `resetRooms`; `createAnchor`, `resolveAnchor`, `getFileText` from `@sandbox/shared`.

- [ ] **Step 1: Write the test**

Create `apps/ws-server/test/anchor.test.ts` — the harness matches `test/multifile.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, createAnchor, getFileText, resolveAnchor } from '@sandbox/shared';
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

const lineOf = (doc: Y.Doc, index: number) =>
  getFileText(doc, DEFAULT_FILE.id).toString().slice(0, index).split('\n').length;

test("an anchor made by one client resolves to the same line on the other", async () => {
  const alice = connect('anchor-basic');
  const bob = connect('anchor-basic');
  await waitFor(() => getFileText(alice.doc, DEFAULT_FILE.id).length > 0);
  await waitFor(() => getFileText(bob.doc, DEFAULT_FILE.id).length > 0);

  const text = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = text.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(text, index, 4);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  const onAlice = resolveAnchor(alice.doc, anchor);
  const onBob = resolveAnchor(bob.doc, anchor);
  expect(onBob).toEqual(onAlice);
  expect(lineOf(bob.doc, (onBob as { index: number }).index)).toBe(lineOf(alice.doc, index));
});

test('ten lines inserted above by the other client move the anchor down ten lines', async () => {
  const alice = connect('anchor-insert');
  const bob = connect('anchor-insert');
  await waitFor(() => getFileText(alice.doc, DEFAULT_FILE.id).length > 0);
  await waitFor(() => getFileText(bob.doc, DEFAULT_FILE.id).length > 0);

  const aliceText = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = aliceText.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(aliceText, index, 0);
  const lineBefore = lineOf(alice.doc, index);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  // Bob edits, Alice never touches the anchor again — this is the whole claim.
  getFileText(bob.doc, DEFAULT_FILE.id).insert(0, '# padding\n'.repeat(10));

  await waitFor(() => {
    const here = resolveAnchor(alice.doc, anchor);
    return here.kind === 'anchored' && lineOf(alice.doc, here.index) === lineBefore + 10;
  });

  const onAlice = resolveAnchor(alice.doc, anchor);
  const onBob = resolveAnchor(bob.doc, anchor);
  expect(onAlice).toEqual(onBob);
});

test('when one client deletes the anchored text, both call it orphaned', async () => {
  const alice = connect('anchor-orphan');
  const bob = connect('anchor-orphan');
  await waitFor(() => getFileText(alice.doc, DEFAULT_FILE.id).length > 0);
  await waitFor(() => getFileText(bob.doc, DEFAULT_FILE.id).length > 0);

  const text = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = text.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(text, index, 0);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  getFileText(bob.doc, DEFAULT_FILE.id).delete(index, 'def fizzbuzz'.length);

  await waitFor(() => resolveAnchor(alice.doc, anchor).kind === 'orphaned');
  expect(resolveAnchor(bob.doc, anchor).kind).toBe('orphaned');
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @sandbox/ws-server test anchor`
Expected: PASS — 3 tests. These exercise Task 1 over a real socket; they should pass first run. A
failure here means the doc operations are wrong, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/ws-server/test/anchor.test.ts
git commit -m "test(sync): two clients agree where an anchor points

The load-bearing case is the second one: Bob inserts, Alice never touches
the anchor, and Alice's resolution moves ten lines on its own. That is
the no-write-back claim, asserted rather than assumed.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: The roadmap's proof, in a browser

**Files:**
- Create: `e2e/anchor.spec.ts`

**Interfaces:**
- Consumes: `join` from `./helpers`.

- [ ] **Step 1: Write the spec**

Create `e2e/anchor.spec.ts`:

```ts
import { type Page, expect, test } from '@playwright/test';
import { join } from './helpers';

/** The rendered top edge of the only stroke, in viewport pixels. */
const strokeTop = async (page: Page) => {
  const box = await page.getByTestId('stroke').first().boundingBox();
  return box!.y;
};

const drawBox = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const canvas = page.getByTestId('canvas');
  const area = (await canvas.boundingBox())!;
  await page.mouse.move(area.x + from.x, area.y + from.y);
  await page.mouse.down();
  await page.mouse.move(area.x + to.x, area.y + to.y, { steps: 8 });
  await page.mouse.up();
};

test('an annotation follows its code when lines are inserted above it', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await page.getByTestId('mode-toggle').click();
  await page.getByTestId('tool-rect').click();
  await drawBox(page, { x: 60, y: 120 }, { x: 260, y: 170 });
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  const before = await strokeTop(page);

  // Back to Code mode and insert ten lines at the very top.
  await page.getByTestId('mode-toggle').click();
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');

  // The annotation travelled down with the code it describes.
  await expect
    .poll(async () => (await strokeTop(page)) - before, { timeout: 10_000 })
    .toBeGreaterThan(100);

  await expect(page.getByTestId('stroke')).not.toHaveAttribute('data-orphaned', 'true');
});

test('deleting the annotated code dims the annotation instead of moving it somewhere wrong', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await page.getByTestId('mode-toggle').click();
  await page.getByTestId('tool-rect').click();
  await drawBox(page, { x: 60, y: 120 }, { x: 260, y: 170 });
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  await page.getByTestId('mode-toggle').click();
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  // Still there, and visibly not attached to anything any more.
  await expect(page.getByTestId('stroke')).toHaveCount(1);
  await expect(page.getByTestId('stroke')).toHaveAttribute('data-orphaned', 'true', { timeout: 10_000 });
});

test('a second person sees the annotation move without touching it', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click();
  await alice.getByTestId('tool-rect').click();
  await drawBox(alice, { x: 60, y: 120 }, { x: 260, y: 170 });
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  const bobBefore = await strokeTop(bob);

  // Bob types; Alice's drawing is the thing that moves on Bob's screen.
  await bob.locator('.monaco-editor').click();
  await bob.keyboard.press('Control+Home');
  for (let i = 0; i < 10; i++) await bob.keyboard.press('Enter');

  await expect
    .poll(async () => (await strokeTop(bob)) - bobBefore, { timeout: 10_000 })
    .toBeGreaterThan(100);

  await aliceCtx.close();
  await bobCtx.close();
});
```

- [ ] **Step 2: Confirm the tool test id exists**

Run: `grep -n "tool-rect\|data-testid" apps/web/components/Toolbar.tsx`
Expected: a `tool-rect` test id. **If the toolbar uses different ids, use the real ones** rather
than adding new ones — the drawing e2e in `e2e/drawing.spec.ts` already selects these buttons, so
copy its selectors.

- [ ] **Step 3: Run the spec**

Run: `pnpm db:up && pnpm test:e2e anchor`
Expected: PASS — 3 tests.

- [ ] **Step 4: Commit**

```bash
git add e2e/anchor.spec.ts
git commit -m "test(e2e): insert lines above an annotated block, in a browser

The roadmap's stated proof for this phase, plus the case that makes it
honest: deleting the annotated code dims the drawing rather than leaving
it over whatever moved into those pixels.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: The offline toggle

**Files:**
- Modify: `apps/web/lib/yjs/RoomContext.tsx`, `apps/web/components/ConnectionPill.tsx`, `apps/web/components/RunBar.tsx`

**Interfaces:**
- Produces: `useRoomContext()` gains `isOffline: boolean`, `setOffline(next: boolean): void`, `pendingUpdates: number`.

- [ ] **Step 1: Add offline state to `RoomContext`**

The context value today **is** the `RoomHandle` (`{ doc, provider, awareness }` — see
`lib/yjs/room.ts`), so widen it rather than adding a second context: every existing consumer
(`CanvasOverlay`, `RunBar`, `FileTabs`, `CodeEditor`) then keeps working untouched.

Replace the top of `apps/web/lib/yjs/RoomContext.tsx`:

```tsx
'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User } from '@sandbox/shared';
import type { RoomHandle } from './room';
import { type ConnectionStatus, useRoom } from './useRoom';

type RoomContextValue = RoomHandle & {
  isOffline: boolean;
  setOffline: (next: boolean) => void;
  pendingUpdates: number;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export const useRoomContext = (): RoomContextValue => {
  const value = useContext(RoomContext);
  if (!value) throw new Error('useRoomContext must be used inside <RoomProvider>');
  return value;
};
```

Then, in the provider body **above** the existing `if (!handle) return null` — hooks cannot run
after a conditional return, and that line is why:

```tsx
  const [isOffline, setIsOffline] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState(0);

  /**
   * A deliberate disconnect, so convergence can be demonstrated on purpose rather than by pulling
   * a network cable. Client-local and never a doc write — the rule activeFileId follows, for the
   * same reason: one person's demo must not disconnect the room.
   */
  const setOffline = useCallback(
    (next: boolean) => {
      if (!handle) return;
      setIsOffline(next);
      if (next) {
        handle.provider.disconnect();
      } else {
        setPendingUpdates(0);
        handle.provider.connect();
      }
    },
    [handle],
  );

  // Count local edits made while disconnected. Without a number, a successful merge on reconnect
  // is indistinguishable from nothing having happened. Updates carrying the provider as their
  // origin came from the network, so they are not local and are not counted.
  useEffect(() => {
    if (!handle || !isOffline) return;

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== handle.provider) setPendingUpdates((count) => count + 1);
    };
    handle.doc.on('update', onUpdate);
    return () => handle.doc.off('update', onUpdate);
  }, [handle, isOffline]);

  const value = useMemo(
    () => (handle ? { ...handle, isOffline, setOffline, pendingUpdates } : null),
    [handle, isOffline, setOffline, pendingUpdates],
  );

  if (!value) return null;

  return <RoomContext.Provider value={value}>{children(status)}</RoomContext.Provider>;
```

The existing effect that publishes `user` into awareness stays exactly as it is.

**Note on `status`:** `provider.disconnect()` fires the provider's `status` event, so `useRoom`
will report `disconnected`. That is correct and not a bug — `ConnectionPill` distinguishes the two
cases with `isOffline` in Step 2.

- [ ] **Step 2: Make the pill the control**

In `apps/web/components/ConnectionPill.tsx`, read the current status rendering, then render a
button when the room context is available:

```tsx
'use client';

import { useRoomContext } from '@/lib/yjs/RoomContext';

export function ConnectionPill({ status }: { status: 'connected' | 'connecting' | 'disconnected' }) {
  const { isOffline, setOffline, pendingUpdates } = useRoomContext();

  // A manual disconnect and a real one must not look the same, or a genuine outage mid-demo reads
  // as the toggle and the demo quietly lies.
  const label = isOffline
    ? pendingUpdates > 0
      ? `Offline (you) — ${pendingUpdates} local edit${pendingUpdates === 1 ? '' : 's'}`
      : 'Offline (you)'
    : status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Reconnecting…'
        : 'Offline';

  const dot = isOffline ? 'bg-amber-400' : status === 'connected' ? 'bg-emerald-400' : 'bg-neutral-500';

  return (
    <button
      type="button"
      data-testid="connection-pill"
      data-offline={isOffline ? 'true' : undefined}
      onClick={() => setOffline(!isOffline)}
      title={isOffline ? 'Reconnect and merge' : 'Go offline — keep editing, merge on reconnect'}
      className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-500"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Run follows offline**

In `apps/web/components/RunBar.tsx`, add `useRoomContext`'s `isOffline` to the existing predicate —
`doc` is already destructured from it:

```tsx
  const { doc, isOffline } = useRoomContext();
```

```tsx
  const offline = status !== 'connected' || isOffline;
```

A pill claiming offline while Run still works would undercut the thing being demonstrated.

- [ ] **Step 4: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/yjs/RoomContext.tsx apps/web/components/ConnectionPill.tsx apps/web/components/RunBar.tsx
git commit -m "feat(web): go offline on purpose, and watch it merge

Convergence is the thesis, so it gets a control rather than a cable pull.
The pending-edit count is the part that makes the merge visible: without
a number, a successful merge looks like nothing happened.

Manual offline reads differently from a real drop, so an outage during a
demo cannot be mistaken for the toggle.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Offline, in two browsers

**Files:**
- Create: `e2e/offline.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/offline.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('edits made offline merge with the room on reconnect', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('connection-pill').click();
  await expect(alice.getByTestId('connection-pill')).toHaveAttribute('data-offline', 'true');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# written while offline');
  await expect(alice.getByTestId('connection-pill')).toContainText(/local edit/);

  // Bob is still connected and must not see it yet.
  await expect(bob.locator('.monaco-editor')).not.toContainText('written while offline');

  // Bob edits meanwhile, so the reconnect is a real merge of two divergent docs.
  await bob.locator('.monaco-editor').click();
  await bob.keyboard.press('Control+End');
  await bob.keyboard.type('# written while Alice was away');

  await alice.getByTestId('connection-pill').click();

  await expect(alice.locator('.monaco-editor')).toContainText('written while Alice was away', { timeout: 10_000 });
  await expect(bob.locator('.monaco-editor')).toContainText('written while offline', { timeout: 10_000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test('Run is disabled while you are offline', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await page.getByTestId('connection-pill').click();
  await expect(page.getByTestId('run')).toBeDisabled();

  await page.getByTestId('connection-pill').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 10_000 });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm test:e2e offline`
Expected: PASS — 2 tests.

- [ ] **Step 3: Commit**

```bash
git add e2e/offline.spec.ts
git commit -m "test(e2e): two divergent docs, one merge

Both sides edit while one is disconnected, so the reconnect is a real
merge rather than a replay in one direction.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: The server says whether execution is available

**Files:**
- Modify: `packages/shared/src/exec.ts`, `apps/ws-server/src/env.ts`, `apps/ws-server/src/exec/connection.ts`, `apps/ws-server/src/server.ts`, `apps/web/lib/exec/ExecContext.tsx`, `apps/web/components/RunBar.tsx`

**Interfaces:**
- Produces: `ServerMessage` gains `{ type: 'exec:hello'; executionEnabled: boolean }`; `useExecContext()` gains `executionEnabled: boolean`.

- [ ] **Step 1: Add the message to the protocol**

In `packages/shared/src/exec.ts`, add to the `ServerMessage` union, above `run:history`:

```ts
  // Sent once, first, on every /exec connection. The hosted demo has no executor, and a Run button
  // that fails on click is worse than one that says why it cannot.
  | { type: 'exec:hello'; executionEnabled: boolean }
```

- [ ] **Step 2: Add the flag to the server environment**

In `apps/ws-server/src/env.ts`, add:

```ts
  /**
   * Explicit, and deliberately not inferred from PISTON_URL — that has a localhost default, so an
   * absent value means "try localhost", not "no executor". The hosted demo sets this false.
   */
  executionEnabled: process.env.EXECUTION_ENABLED !== 'false',
```

- [ ] **Step 3: Send it on connect**

In `apps/ws-server/src/exec/connection.ts`, add `executionEnabled: boolean` to `ExecDeps`, and send
it as the first message — before the history, so the client knows what it is looking at:

```ts
  // First, always: the client renders Run from this.
  send(conn, encode({ type: 'exec:hello', executionEnabled: deps.executionEnabled }));

  // Always sent, even when empty: the terminal must be able to tell "nothing has run here" from
  // "still loading".
  send(conn, encode({ type: 'run:history', runs: deps.store.list(room.id) }));
```

In `apps/ws-server/src/server.ts`, pass `executionEnabled: env.executionEnabled` where the other
`ExecDeps` fields are constructed.

- [ ] **Step 4: Receive it on the client**

In `apps/web/lib/exec/ExecContext.tsx`, add `executionEnabled` to the context value (defaulting to
`true`, so nothing regresses before the first message arrives), and handle the message where the
other server messages are handled:

```tsx
      case 'exec:hello':
        setExecutionEnabled(message.executionEnabled);
        break;
```

- [ ] **Step 5: Say so on the button**

In `apps/web/components/RunBar.tsx`:

```tsx
  const { runActiveFile, isRunning, status, stdin, setStdin, executionEnabled } = useExecContext();
```

```tsx
  const disabled = offline || isRunning || !file || !language || !executionEnabled;

  const title = !executionEnabled
    ? 'Execution is local-only — run pnpm piston:up'
    : file && !language
      ? `No runtime for ${file.name}`
      : 'Ctrl/Cmd + Enter';
```

- [ ] **Step 6: Verify both states**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

Then run the server with the flag off and confirm the button explains itself:

```bash
EXECUTION_ENABLED=false pnpm --filter @sandbox/ws-server dev
```

Open a room in another terminal's `pnpm --filter @sandbox/web dev` and hover Run. Expected: disabled,
titled `Execution is local-only — run pnpm piston:up`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/exec.ts apps/ws-server/src apps/web/lib/exec/ExecContext.tsx apps/web/components/RunBar.tsx
git commit -m "feat: the server says whether it can execute, and Run explains itself

The hosted demo has no executor. A Run button that fails on click is
worse than one that says why it cannot, and the server is the only
component that actually knows.

The flag is explicit rather than inferred from an absent PISTON_URL,
because that variable already defaults to localhost — absent means 'try
localhost', not 'no executor'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Cold start and empty states

**Files:**
- Modify: `apps/web/components/ConnectionPill.tsx`, `apps/web/components/Terminal.tsx`

- [ ] **Step 1: Say when the sandbox is waking**

Render's free tier sleeps, so the first connection can take 30–50 seconds. In
`ConnectionPill.tsx`, add a threshold so a normal fast connect never flashes the message:

```tsx
  // Render's free tier sleeps; the first connect can take 30-50s. A spinner that says nothing for
  // that long reads as broken. The 3s threshold keeps a healthy connect from ever showing this.
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    if (status === 'connected' || isOffline) {
      setWaking(false);
      return;
    }
    const timer = setTimeout(() => setWaking(true), 3_000);
    return () => clearTimeout(timer);
  }, [status, isOffline]);
```

and use it in the label, above the `status === 'connecting'` branch:

```tsx
      : waking && status !== 'connected'
        ? 'Waking the sandbox…'
```

- [ ] **Step 2: Say when nothing has run**

`Terminal` is an xterm canvas, not JSX — its content comes from `renderRuns`, which already returns
`''` for an empty room. The hint belongs there, where it is also unit-testable.

Add to `apps/web/lib/exec/render.test.ts`:

```ts
test('an empty terminal says how to run something, rather than nothing at all', () => {
  const out = renderRuns([], null);
  expect(out).toContain('No runs yet');
  expect(out).toContain('Ctrl/Cmd + Enter');
});

test('a notice still renders on its own', () => {
  expect(renderRuns([], 'rate limited')).toContain('rate limited');
  expect(renderRuns([], 'rate limited')).not.toContain('No runs yet');
});
```

Run: `pnpm --filter @sandbox/web test render`
Expected: FAIL — the first test gets `''`.

Then in `apps/web/lib/exec/render.ts`, replace the empty return:

```ts
  // An empty console that says nothing cannot be told from one that is still loading. run:history
  // is always sent precisely so this state is knowable.
  if (blocks.length === 0) return `${DIM}No runs yet — press Ctrl/Cmd + Enter${RESET}\r\n`;
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ConnectionPill.tsx apps/web/lib/exec/render.ts apps/web/lib/exec/render.test.ts
git commit -m "feat(web): say 'waking the sandbox', and say when nothing has run

A free-tier cold start takes 30-50s. A spinner that says nothing for that
long reads as broken, so after 3s the pill says what is happening — and
the threshold means a healthy connect never shows it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Keyboard shortcuts

**Files:**
- Create: `apps/web/components/Shortcuts.tsx`
- Modify: `apps/web/components/Workspace.tsx`

**Interfaces:**
- Consumes: `useCanvas()` from `@/lib/canvas/CanvasContext`, which **already** exposes `mode`,
  `setMode`, `tool`, `setTool` and exports the `Tool` union. No change is needed there.

- [ ] **Step 1: Write the component**

Create `apps/web/components/Shortcuts.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { type Tool, useCanvas } from '@/lib/canvas/CanvasContext';

const TOOL_KEYS: Record<string, Tool> = {
  p: 'freehand',
  a: 'arrow',
  r: 'rect',
  t: 'text',
  e: 'eraser',
};

/**
 * Single-letter keys must never fire while focus is in a text field, or typing `probe.py` into the
 * rename box would trigger pen, then rect, then text.
 */
const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
};

export function Shortcuts() {
  const { mode, setMode, setTool } = useCanvas();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setMode(mode === 'draw' ? 'code' : 'draw');
        return;
      }

      if (event.key === '?') {
        setShowHelp((open) => !open);
        return;
      }

      if (event.key === 'Escape') {
        if (showHelp) setShowHelp(false);
        else if (mode === 'draw') setMode('code');
        return;
      }

      // Tool keys belong to Draw mode alone; in Code mode they are just letters.
      if (mode === 'draw' && !event.ctrlKey && !event.metaKey) {
        const tool = TOOL_KEYS[event.key.toLowerCase()];
        if (tool) {
          event.preventDefault();
          setTool(tool);
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode, setMode, setTool, showHelp]);

  if (!showHelp) return null;

  return (
    <div
      data-testid="shortcuts"
      className="absolute right-4 top-16 z-50 rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-300 shadow-xl"
    >
      <p className="mb-2 font-semibold text-white">Shortcuts</p>
      <ul className="space-y-1">
        <li><kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> — Run</li>
        <li><kbd>Ctrl/Cmd</kbd> + <kbd>B</kbd> — Code / Draw</li>
        <li><kbd>P</kbd> <kbd>A</kbd> <kbd>R</kbd> <kbd>T</kbd> <kbd>E</kbd> — pen, arrow, box, text, erase</li>
        <li><kbd>Esc</kbd> — leave Draw mode</li>
        <li><kbd>?</kbd> — this list</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Mount it**

In `apps/web/components/Workspace.tsx`, add the import and render it inside `CanvasProvider`,
beside `<RemoteCursorStyles />`:

```tsx
import { Shortcuts } from './Shortcuts';
```

```tsx
                    <RemoteCursorStyles />
                    <Shortcuts />
```

- [ ] **Step 3: Verify by hand**

Run `pnpm dev`, open a room, and check each one: `Ctrl/Cmd+B` toggles the mode; `R` then a drag
draws a box; `Esc` returns to Code; `?` opens and closes the list. Then click `+` in the tab strip
and type `probe.py` — **the tool keys must not fire**, and the name must arrive intact.

- [ ] **Step 4: Run the suite**

Run: `pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS. The drawing e2e clicks toolbar buttons, so shortcuts must not have changed it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Shortcuts.tsx apps/web/components/Workspace.tsx
git commit -m "feat(web): keyboard shortcuts, and a ? that lists them

Single-letter tool keys are suppressed while focus is in a text field.
Without that guard, typing a filename into the rename box fires pen, then
box, then text.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Deployment manifests and the runbook

No application code. Nothing here can be verified by the test suite, which is exactly why the
runbook carries a check after every step.

**Files:**
- Create: `netlify.toml`, `render.yaml`, `Docs/deploy-runbook.md`
- Modify: `.env.example`

- [ ] **Step 1: Netlify**

Create `netlify.toml` **at the repository root** — Netlify reads it from the base directory:

```toml
[build]
  command = "pnpm --filter @sandbox/shared build && pnpm --filter @sandbox/web build"
  publish = "apps/web/.next"

[build.environment]
  NODE_VERSION = "20"
  # Netlify defaults to npm; this repo is pnpm-only.
  NETLIFY_USE_PNPM = "true"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

- [ ] **Step 2: Render**

Create `render.yaml` **at the repository root** — Render only discovers Blueprints there:

```yaml
services:
  - type: web
    name: crdt-sandbox-ws
    runtime: node
    plan: free
    buildCommand: pnpm install --frozen-lockfile && pnpm --filter @sandbox/shared build
    startCommand: pnpm --filter @sandbox/ws-server start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "20"
      # The hosted demo has no executor. See the Phase 5 design section 6.5.
      - key: EXECUTION_ENABLED
        value: "false"
      - key: ROOM_GRACE_MS
        value: "30000"
      - key: ROOM_TTL_DAYS
        value: "30"
      # Set in the dashboard, never in this file.
      - key: DATABASE_URL
        sync: false
```

- [ ] **Step 3: Document the new variable**

In `.env.example`, below the `PISTON_URL` block:

```bash
# Set false to advertise that this server cannot execute code, so Run explains itself instead of
# failing on click. The hosted demo sets false; local development leaves it unset.
EXECUTION_ENABLED=true
```

- [ ] **Step 4: Write the runbook**

Create `Docs/deploy-runbook.md`:

````markdown
# Deploying the sandbox

Three services: **Supabase** holds the rooms, **Render** runs the WebSocket server, **Netlify**
serves the web app. Do them in that order — each needs the one before it.

No secret belongs in this repository. Everything below is pasted into a dashboard.

## 1. Supabase

1. Create a project. Wait for it to finish provisioning.
2. Copy the **Session pooler** connection string (port **5432**, not 6543) from
   *Project settings → Database → Connection string → Session pooler*.
3. Run the migration from your machine:

   ```bash
   DATABASE_URL='<the pooler string>' pnpm db:migrate
   ```

**Check:** the command prints the `sandbox.rooms` columns. If it hangs, you copied the transaction
pooler (6543) — that one does not support the session-level statements the migration uses.

> There is no RLS to configure, and that is deliberate. The ws-server is the only database client
> and connects as a Postgres role; there is no browser-side Supabase client and no anon key. RLS
> guards tables reached through PostgREST with a user JWT, which nothing here does. The security
> boundary is the connection string — treat it like a password.

## 2. Render

1. *New → Blueprint*, point it at this repository. Render reads `render.yaml`.
2. Set `DATABASE_URL` in the dashboard to the Supabase pooler string. It is marked `sync: false`
   precisely so it never lives in git.
3. Deploy, and copy the service host — `crdt-sandbox-ws.onrender.com` or similar.

**Check:**

```bash
curl https://<your-render-host>/health
```

Expected: a 200. If it 502s, read the logs — a missing `DATABASE_URL` is the usual cause, and the
server says so.

> The free plan sleeps after idling, so the first visit takes 30–50 seconds. The app shows
> "waking the sandbox…" rather than a spinner that lies. A paid instance removes the wait.

## 3. Netlify

1. *Add new site → Import an existing project*, point it at this repository. Netlify reads
   `netlify.toml`.
2. Set both variables, using **`wss://`** and your Render host:

   ```
   NEXT_PUBLIC_SYNC_URL = wss://<your-render-host>/sync
   NEXT_PUBLIC_EXEC_URL = wss://<your-render-host>/exec
   ```

3. Deploy.

> **`NEXT_PUBLIC_*` is inlined into the bundle at build time.** Changing either value in the
> Netlify UI does nothing until you trigger a **rebuild**. The failure this produces — a redeployed
> site still talking to the old server — looks exactly like a caching bug and is not one.

> **The scheme must be `wss://`.** Render terminates TLS, and an `ws://` URL from an HTTPS page is
> blocked as mixed content, with a console error that does not obviously blame the scheme.

**Check:** open the site in two browser windows, join the same room, and type in one. The other
updates, and the connection pill reads *Connected*.

## 4. Confirm persistence survives a restart

1. Type something into a room and close every tab.
2. Restart the Render service from the dashboard.
3. Reopen the same room URL.

**Check:** your text is still there. If the room is empty, `DATABASE_URL` is not reaching the
server — the room lived in memory and died with the process.

## What is deliberately not deployed

**Code execution.** The public Piston instance became whitelist-only on 2026-02-15, and
self-hosting Piston needs privileged containers for its `isolate` sandbox, which Render's free plan
does not provide. `EXECUTION_ENABLED=false` makes the server advertise this, and Run explains
itself rather than failing on click.

Exposing a public executor would also mean anyone who found the URL could run arbitrary code on it.
Run the sandbox locally with `pnpm piston:up` to execute code.
````

- [ ] **Step 5: Verify the manifests parse**

Run: `node -e "require('fs').readFileSync('netlify.toml','utf8')" && node -e "const y=require('fs').readFileSync('render.yaml','utf8'); if(!y.includes('healthCheckPath')) process.exit(1)"`
Expected: no output, exit 0.

There is no way to fully verify a deployment manifest without deploying. That is the honest reason
the runbook has a check after every step rather than one at the end.

- [ ] **Step 6: Commit**

```bash
git add netlify.toml render.yaml Docs/deploy-runbook.md .env.example
git commit -m "chore(deploy): manifests and a runbook for Netlify, Render, and Supabase

Both manifests sit at the repo root because that is the only place their
services look for them.

The runbook checks after every step rather than once at the end, because
nothing here is covered by the test suite. It calls out the two failures
that do not look like their cause: NEXT_PUBLIC_* is inlined at build
time, so changing it without a rebuild looks like a caching bug, and an
ws:// URL from an HTTPS page is blocked as mixed content.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: The README and a recorded demo

**Files:**
- Create: `scripts/record-demo.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the recorder**

Create `scripts/record-demo.mjs`:

```js
/**
 * Records the Phase 5 proof: draw over a block, insert lines above it, watch the annotation follow.
 *
 * Playwright emits .webm. GIF conversion needs ffmpeg, which may not be installed — so the video is
 * written unconditionally and the conversion is attempted separately. A missing ffmpeg costs you
 * the GIF, not the recording.
 *
 * Usage: pnpm dev, then `node scripts/record-demo.mjs`
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = 'Docs/media';
const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();

await page.goto(BASE);
await page.getByTestId('create-room').click();
await page.getByLabel('Your name').fill('Ada');
await page.getByRole('button', { name: 'Join' }).click();
await page.waitForSelector('.monaco-editor');
await page.waitForTimeout(1500);

// Draw a box over the function.
await page.getByTestId('mode-toggle').click();
await page.getByTestId('tool-rect').click();
const canvas = await page.getByTestId('canvas').boundingBox();
await page.mouse.move(canvas.x + 60, canvas.y + 120);
await page.mouse.down();
await page.mouse.move(canvas.x + 300, canvas.y + 180, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(1200);

// Insert lines above it — the annotation travels down with its code.
await page.getByTestId('mode-toggle').click();
await page.locator('.monaco-editor').click();
await page.keyboard.press('Control+Home');
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(2000);

await context.close();
await browser.close();

const video = readdirSync(OUT).filter((f) => f.endsWith('.webm')).sort().pop();
renameSync(join(OUT, video), join(OUT, 'anchor-demo.webm'));
console.log(`✓ ${OUT}/anchor-demo.webm`);

try {
  execFileSync('ffmpeg', [
    '-y', '-i', join(OUT, 'anchor-demo.webm'),
    '-vf', 'fps=12,scale=960:-1:flags=lanczos',
    join(OUT, 'anchor-demo.gif'),
  ], { stdio: 'ignore' });
  console.log(`✓ ${OUT}/anchor-demo.gif`);
} catch {
  console.log('! ffmpeg not found — keeping the .webm. Install ffmpeg and rerun for a GIF.');
}
```

- [ ] **Step 2: Record it**

Run: `pnpm db:up && pnpm dev` in one terminal, then `node scripts/record-demo.mjs`.
Expected: `Docs/media/anchor-demo.webm`, and the GIF when ffmpeg is present.

**Watch the recording before committing it.** If the box does not visibly travel down the screen,
the recording is not the proof and the timings need adjusting.

- [ ] **Step 3: Update the README**

- Status: `Phase 5 of 5` — collaborative editing, shared execution, a drawing overlay, durable
  rooms, multi-file tabs, and line-anchored annotations.
- Under **What works today**, add: annotations anchored to the code they describe, which follow it
  through edits on every client; and an offline toggle that demonstrates convergence on demand.
- Add the demo (`Docs/media/anchor-demo.gif`, or the `.webm` if that is what exists).
- Add the shortcut table from Task 10.
- Add a **Deployment** section linking `Docs/deploy-runbook.md`, with the live URL, and stating
  plainly that **execution is local-only in the hosted demo** — everything else is live. Explain
  why in one line: the public Piston is whitelist-only and self-hosting it needs privileged
  containers.
- Under **Not built yet**, remove line-anchored annotations and deployment. Keep running more than
  one file at a time.
- Under **Tests**, update the counts to the real numbers from `pnpm test` and `pnpm test:e2e`. Run
  them and read the output — do not guess.

- [ ] **Step 4: Verify the counts you wrote**

Run: `pnpm test && pnpm test:e2e`
Expected: the numbers in the README match the output exactly.

- [ ] **Step 5: Commit**

```bash
git add scripts/record-demo.mjs README.md Docs/media
git commit -m "docs: anchors, shortcuts, and how to deploy it

The demo recording is generated by a script rather than captured by hand,
so it can be regenerated when the UI moves. ffmpeg is optional: without
it you get the webm instead of the gif, not a failure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of done

- `pnpm test` green, including the 4 gated Postgres tests with `DATABASE_URL` set — **not skipped**.
- `pnpm test:e2e` green, including the gated persistence specs and the new anchor and offline specs.
- `pnpm typecheck` clean.
- `grep -rn "lineHeight" apps/web/lib/canvas` returns nothing — the binary search is the only mapping.
- Draw over a block, insert ten lines above it, and watch the annotation follow — **by hand, in a browser, on two clients**, not inferred from a passing test.
- Delete the annotated code and watch the annotation dim rather than vanish or drift.
- The runbook has been read end to end by someone who has not deployed this before.
