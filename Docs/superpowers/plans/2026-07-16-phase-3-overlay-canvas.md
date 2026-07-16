# Phase 3 — Overlay Drawing Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone in the room draws over the code — freehand, arrows, boxes, short text labels — and everyone sees the drawing pinned to the same code, even when scrolled to different places.

**Architecture:** An absolutely-positioned SVG layer above Monaco. A Code/Draw mode toggle flips a single `pointer-events` switch. Points are stored in Monaco *content space* and the SVG is transformed by `translate(−scrollLeft, −scrollTop)`, so a stroke lands on the same code for every viewer regardless of scroll. Committed strokes live in the existing `strokes` `Y.Array<Stroke>` and sync through the Phase 1 `/sync` relay untouched; the live in-progress pen rides on awareness. **No ws-server code changes.**

**Tech Stack:** Everything from Phases 1–2, plus `perfect-freehand` (freehand outline paths, web only). Stroke ids come from `crypto.randomUUID` — no new dependency.

Spec: `Docs/superpowers/specs/2026-07-16-phase-3-overlay-canvas-design.md`.
Master spec: `Docs/superpowers/specs/2026-07-13-multimodal-sandbox-design.md` (§4.3, §5.3, §11 row 3).

## Global Constraints

- Node **>= 20**. Package manager is **pnpm** — never `npm install` in this repo.
- The `/sync` server stays a **pure relay**. Phase 3 adds **no** ws-server code. Strokes are collaborative state that syncs through the existing socket; the server never learns what a stroke is.
- **Exactly one Yjs instance in the dependency graph** (`@sandbox/shared` declares `yjs` as a peerDependency). Do not add `yjs` to `apps/web`'s dependencies a second time.
- **Points are stored in Monaco content space, never screen space.** `contentX = clientX − editorRect.left + editor.getScrollLeft()`, and the strokes group is transformed by `translate(−scrollLeft, −scrollTop)`. Screen space breaks the moment two people scroll differently.
- **The mode toggle is a hard `pointer-events` switch, not a heuristic.** Code mode → overlay `pointer-events: none`; Draw mode → overlay `pointer-events: auto` and Monaco `readOnly`.
- **Monaco and xterm touch `window` at module scope.** The overlay renders *inside* the already-client-only editor tree; do not add it to a server-rendered path.
- **The draft is ephemeral.** The in-progress stroke lives only in awareness and is cleared on pointer-up (when the real `Stroke` commits) or on cancel. Never persist it.
- **Eraser deletes any stroke; undo removes only your own last stroke.** It is a shared canvas.
- Stroke `width` is a fixed constant from `@sandbox/shared` (no width UI in Phase 3). Draw colour is the user's identity colour (no colour picker).
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- No persistence until Phase 4. Strokes die with the room's grace period. That is expected, not a bug.

## File Structure

```text
packages/shared/
  src/model.ts                 MOD  + STROKE_WIDTH, DraftStroke, AwarenessState.draft
  src/doc.ts                   MOD  + appendStroke, eraseStroke, undoLastStrokeBy
  src/doc.test.ts              MOD  + accessor tests + two-doc convergence

apps/web/
  package.json                 MOD  + perfect-freehand
  lib/canvas/coords.ts         NEW  toContentPoint — pure
  lib/canvas/coords.test.ts    NEW
  lib/canvas/hitTest.ts        NEW  hits(stroke, point, tolerance) — pure
  lib/canvas/hitTest.test.ts   NEW
  lib/canvas/draft.ts          NEW  buildShape(tool, points) — pure
  lib/canvas/draft.test.ts     NEW
  lib/canvas/freehand.ts       NEW  freehandPath(points, width) — perfect-freehand wrapper
  lib/canvas/freehand.test.ts  NEW
  lib/canvas/CanvasContext.tsx NEW  mode/tool/user state + useCanvas()
  lib/yjs/useStrokes.ts        NEW  subscribe to the strokes Y.Array
  components/CanvasOverlay.tsx NEW  the SVG layer
  components/Toolbar.tsx       NEW  mode toggle, tools, undo
  components/CodeEditor.tsx    MOD  wrap Editor + CanvasOverlay in a relative container
  components/Workspace.tsx     MOD  CanvasProvider + Toolbar

e2e/
  drawing.spec.ts              NEW  acceptance + mode toggle + live pen + undo/eraser
README.md                      MOD
```

---

### Task 1: The shared schema — width, draft, and the stroke accessors

Everything that crosses the wire or mutates the doc lives in `@sandbox/shared`, as in Phases 1–2. `Stroke`, `Shape`, `Point`, and `getStrokes` already exist; this task adds the width constant, the live-pen `draft` type, and the three accessors the canvas mutates the `Y.Array` through.

**Files:**
- Modify: `packages/shared/src/model.ts`, `packages/shared/src/doc.ts`
- Test: `packages/shared/src/doc.test.ts`

**Interfaces:**
- Consumes: `Stroke`, `Shape`, `getStrokes`, `getFilesMap` from the existing package.
- Produces: constant `STROKE_WIDTH: number`; type `DraftStroke = { fileId: string; color: string; width: number; shape: Shape }`; `AwarenessState.draft?: DraftStroke`; functions `appendStroke(doc: Y.Doc, stroke: Stroke): void`, `eraseStroke(doc: Y.Doc, id: string): void`, `undoLastStrokeBy(doc: Y.Doc, authorId: string): void`.

- [ ] **Step 1: Add the width constant and the draft type to `model.ts`**

Append to `packages/shared/src/model.ts` (after the `Stroke` type):

```ts
/** The one stroke width. There is no width UI in Phase 3 — a width picker is a later additive change. */
export const STROKE_WIDTH = 3;

/** The in-progress stroke, broadcast over awareness while drawing and cleared on pointer-up. */
export type DraftStroke = {
  fileId: string;
  color: string;
  width: number;
  shape: Shape;
};
```

Then extend the existing `AwarenessState` type — add the `draft` field:

```ts
export type AwarenessState = {
  user: User;
  activeFileId: string;
  pointer?: { fileId: string; x: number; y: number };
  draft?: DraftStroke;
};
```

- [ ] **Step 2: Write the failing tests for the accessors**

Append to `packages/shared/src/doc.test.ts`:

```ts
import { appendStroke, eraseStroke, getStrokes, undoLastStrokeBy } from './doc.js';
import type { Stroke } from './model.js';

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  id: 's1',
  fileId: 'main',
  authorId: 'u1',
  color: '#f97316',
  width: 3,
  shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  createdAt: 0,
  ...over,
});

test('appendStroke adds a stroke to the array', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke());

  expect(getStrokes(doc).toArray()).toEqual([stroke()]);
});

test('eraseStroke removes a stroke by id, and is a no-op for an id that is gone', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1' }));
  appendStroke(doc, stroke({ id: 's2' }));

  eraseStroke(doc, 's1');
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s2']);

  // Idempotent: erasing something already gone must not throw or delete a neighbour.
  eraseStroke(doc, 's1');
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s2']);
});

test('undoLastStrokeBy removes only the author\'s most recent stroke', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1', authorId: 'ada' }));
  appendStroke(doc, stroke({ id: 's2', authorId: 'bob' }));
  appendStroke(doc, stroke({ id: 's3', authorId: 'ada' }));

  undoLastStrokeBy(doc, 'ada');

  // s3 was Ada's most recent; s2 (Bob's) and s1 (Ada's older) survive.
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s1', 's2']);
});

test('undoLastStrokeBy is a no-op when the author has no strokes', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1', authorId: 'bob' }));

  expect(() => undoLastStrokeBy(doc, 'ada')).not.toThrow();
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s1']);
});

test('strokes converge across two docs, and concurrent erases resolve', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };

  appendStroke(a, stroke({ id: 's1' }));
  appendStroke(b, stroke({ id: 's2' }));
  sync();

  expect(getStrokes(a).toArray().map((s) => s.id).sort()).toEqual(['s1', 's2']);
  expect(getStrokes(b).toArray().map((s) => s.id).sort()).toEqual(['s1', 's2']);

  // Both erase s1 concurrently — the CRDT must not double-delete or throw.
  eraseStroke(a, 's1');
  eraseStroke(b, 's1');
  sync();

  expect(getStrokes(a).toArray().map((s) => s.id)).toEqual(['s2']);
  expect(getStrokes(b).toArray().map((s) => s.id)).toEqual(['s2']);
});
```

(The existing `doc.test.ts` already imports `* as Y from 'yjs'` and uses `test`/`expect` from vitest; reuse those imports.)

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter @sandbox/shared test
```

Expected: FAIL — `appendStroke`, `eraseStroke`, `undoLastStrokeBy` are not exported.

- [ ] **Step 4: Write the accessors in `doc.ts`**

Append to `packages/shared/src/doc.ts`:

```ts
import type { Stroke } from './model.js';

/** Commit a finished stroke. Called on pointer-up; the draft in awareness is cleared separately. */
export const appendStroke = (doc: Y.Doc, stroke: Stroke): void => {
  getStrokes(doc).push([stroke]);
};

/** Delete a stroke by id. A no-op if it is already gone, so concurrent erases are safe. */
export const eraseStroke = (doc: Y.Doc, id: string): void => {
  const strokes = getStrokes(doc);
  const index = strokes.toArray().findIndex((s) => s.id === id);
  if (index !== -1) strokes.delete(index, 1);
};

/** Undo: remove the author's most recent surviving stroke. Own strokes only. */
export const undoLastStrokeBy = (doc: Y.Doc, authorId: string): void => {
  const strokes = getStrokes(doc);
  const list = strokes.toArray();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.authorId === authorId) {
      strokes.delete(i, 1);
      return;
    }
  }
};
```

Ensure `Stroke` is imported (add it to the existing `./model.js` import block if that is tidier than a second import line).

- [ ] **Step 5: Run the tests and the build**

```bash
pnpm --filter @sandbox/shared test
pnpm --filter @sandbox/shared build
```

Expected: PASS — 5 new tests. `dist/doc.js` and `dist/doc.d.ts` rebuilt so the web app sees the new exports.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): stroke accessors, width constant, and the live-pen draft type" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure geometry — coordinates and hit-testing

Two pure functions, no React, exhaustively unit-tested. `toContentPoint` is the formula the whole acceptance test rests on; `hits` drives the eraser.

**Files:**
- Create: `apps/web/lib/canvas/coords.ts`, `apps/web/lib/canvas/hitTest.ts`
- Test: `apps/web/lib/canvas/coords.test.ts`, `apps/web/lib/canvas/hitTest.test.ts`

**Interfaces:**
- Consumes: `Point`, `Stroke` from `@sandbox/shared`.
- Produces: `type Scroll = { left: number; top: number }`; `type Rect = { left: number; top: number }`; `toContentPoint(clientX: number, clientY: number, rect: Rect, scroll: Scroll): Point`; `hits(stroke: Stroke, point: Point, tolerance: number): boolean`.

- [ ] **Step 1: Write the failing test for `toContentPoint`**

`apps/web/lib/canvas/coords.test.ts`:

```ts
import { expect, test } from 'vitest';
import { toContentPoint } from './coords';

test('a click maps to content space by subtracting the rect and adding the scroll', () => {
  // Editor top-left at (100, 50) on screen, scrolled 200px down and 10px right.
  const rect = { left: 100, top: 50 };
  const scroll = { left: 10, top: 200 };

  // A click at screen (150, 90) is 50px right and 40px down inside the editor, plus the scroll.
  expect(toContentPoint(150, 90, rect, scroll)).toEqual({ x: 60, y: 240 });
});

test('the same screen click at two scroll positions yields two different content points', () => {
  const rect = { left: 0, top: 0 };

  const top = toContentPoint(20, 20, rect, { left: 0, top: 0 });
  const scrolled = toContentPoint(20, 20, rect, { left: 0, top: 500 });

  // This is the whole point: content space moves with the scroll, screen space does not.
  expect(top.y).toBe(20);
  expect(scrolled.y).toBe(520);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test coords
```

Expected: FAIL — cannot resolve `./coords`.

- [ ] **Step 3: Write `coords.ts`**

`apps/web/lib/canvas/coords.ts`:

```ts
import type { Point } from '@sandbox/shared';

export type Scroll = { left: number; top: number };
export type Rect = { left: number; top: number };

/**
 * Screen coordinates → Monaco content space. The SVG strokes group is then transformed by
 * translate(−scrollLeft, −scrollTop), so a point stored here lands on the same code for every
 * viewer, whatever their scroll offset. Screen-space storage breaks the moment two people scroll
 * differently — which is most of the time.
 */
export const toContentPoint = (
  clientX: number,
  clientY: number,
  rect: Rect,
  scroll: Scroll,
): Point => ({
  x: clientX - rect.left + scroll.left,
  y: clientY - rect.top + scroll.top,
});
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm --filter @sandbox/web test coords
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Write the failing test for `hits`**

`apps/web/lib/canvas/hitTest.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { Stroke } from '@sandbox/shared';
import { hits } from './hitTest';

const base = { id: 's', fileId: 'main', authorId: 'u', color: '#fff', width: 3, createdAt: 0 };

const freehand: Stroke = { ...base, shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } };
const arrow: Stroke = { ...base, shape: { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } } };
const rect: Stroke = { ...base, shape: { kind: 'rect', from: { x: 10, y: 10 }, to: { x: 110, y: 60 } } };
const text: Stroke = { ...base, shape: { kind: 'text', at: { x: 50, y: 50 }, text: 'bug' } };

test('a point on a freehand segment hits; a point far from it does not', () => {
  expect(hits(freehand, { x: 50, y: 1 }, 5)).toBe(true);
  expect(hits(freehand, { x: 50, y: 40 }, 5)).toBe(false);
});

test('a point on the arrow line hits', () => {
  expect(hits(arrow, { x: 50, y: 50 }, 5)).toBe(true);
  expect(hits(arrow, { x: 50, y: 90 }, 5)).toBe(false);
});

test('a point on a rect edge hits; the hollow centre does not', () => {
  expect(hits(rect, { x: 10, y: 35 }, 5)).toBe(true);   // on the left edge
  expect(hits(rect, { x: 60, y: 35 }, 5)).toBe(false);  // inside, away from any edge
});

test('a point inside the text box hits', () => {
  expect(hits(text, { x: 55, y: 48 }, 5)).toBe(true);
  expect(hits(text, { x: 300, y: 300 }, 5)).toBe(false);
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test hitTest
```

Expected: FAIL — cannot resolve `./hitTest`.

- [ ] **Step 7: Write `hitTest.ts`**

`apps/web/lib/canvas/hitTest.ts`:

```ts
import type { Point, Stroke } from '@sandbox/shared';

/** Approx glyph metrics for the text hit-box — good enough for an eraser, not for layout. */
const TEXT_CHAR_WIDTH = 8;
const TEXT_HEIGHT = 16;

const distToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const nearPolyline = (points: Point[], p: Point, tolerance: number): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(p, points[i]!, points[i + 1]!) <= tolerance) return true;
  }
  return false;
};

/** True if `point` is within `tolerance` of the stroke (its outline, for a rect). */
export const hits = (stroke: Stroke, point: Point, tolerance: number): boolean => {
  const shape = stroke.shape;
  switch (shape.kind) {
    case 'freehand':
      return nearPolyline(shape.points, point, tolerance);
    case 'arrow':
      return distToSegment(point, shape.from, shape.to) <= tolerance;
    case 'rect': {
      const { from, to } = shape;
      const corners = [
        { x: from.x, y: from.y },
        { x: to.x, y: from.y },
        { x: to.x, y: to.y },
        { x: from.x, y: to.y },
        { x: from.x, y: from.y },
      ];
      return nearPolyline(corners, point, tolerance);
    }
    case 'text': {
      const width = Math.max(1, shape.text.length) * TEXT_CHAR_WIDTH;
      const top = shape.at.y - TEXT_HEIGHT;
      return (
        point.x >= shape.at.x - tolerance &&
        point.x <= shape.at.x + width + tolerance &&
        point.y >= top - tolerance &&
        point.y <= shape.at.y + tolerance
      );
    }
  }
};
```

- [ ] **Step 8: Run and watch it pass, and commit**

```bash
pnpm --filter @sandbox/web test coords hitTest
```

Expected: PASS — 6 tests total across the two files.

```bash
git add apps/web/lib/canvas/coords.ts apps/web/lib/canvas/coords.test.ts apps/web/lib/canvas/hitTest.ts apps/web/lib/canvas/hitTest.test.ts
git commit -m "feat(web): content-space coordinate mapping and stroke hit-testing" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The draft builder and the freehand path

`buildShape` turns a pointer path into an in-progress `Shape` (or `null` for a degenerate one). `freehandPath` wraps `perfect-freehand`. Both are pure and unit-tested.

**Files:**
- Create: `apps/web/lib/canvas/draft.ts`, `apps/web/lib/canvas/freehand.ts`
- Modify: `apps/web/package.json`
- Test: `apps/web/lib/canvas/draft.test.ts`, `apps/web/lib/canvas/freehand.test.ts`

**Interfaces:**
- Consumes: `Point`, `Shape` from `@sandbox/shared`.
- Produces: `type DrawTool = 'freehand' | 'arrow' | 'rect'`; `buildShape(tool: DrawTool, points: Point[]): Shape | null`; `freehandPath(points: Point[], width: number): string`.

- [ ] **Step 1: Add `perfect-freehand`**

`apps/web/package.json` — add to `dependencies`:

```json
"perfect-freehand": "^1.2.2"
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test for `buildShape`**

`apps/web/lib/canvas/draft.test.ts`:

```ts
import { expect, test } from 'vitest';
import { buildShape } from './draft';

const path = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 2 }];

test('freehand keeps every point', () => {
  expect(buildShape('freehand', path)).toEqual({ kind: 'freehand', points: path });
});

test('freehand with a single point is degenerate and discarded', () => {
  expect(buildShape('freehand', [{ x: 0, y: 0 }])).toBeNull();
});

test('arrow uses the first and last point', () => {
  expect(buildShape('arrow', path)).toEqual({
    kind: 'arrow',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 2 },
  });
});

test('rect uses the first and last point as opposite corners', () => {
  expect(buildShape('rect', path)).toEqual({
    kind: 'rect',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 2 },
  });
});

test('a zero-length arrow or rect is degenerate and discarded', () => {
  const dot = [{ x: 3, y: 3 }, { x: 3, y: 3 }];
  expect(buildShape('arrow', dot)).toBeNull();
  expect(buildShape('rect', dot)).toBeNull();
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test draft
```

Expected: FAIL — cannot resolve `./draft`.

- [ ] **Step 4: Write `draft.ts`**

`apps/web/lib/canvas/draft.ts`:

```ts
import type { Point, Shape } from '@sandbox/shared';

export type DrawTool = 'freehand' | 'arrow' | 'rect';

/**
 * Turn a pointer path into an in-progress shape, or null if it is degenerate (a stray click, a
 * single point). The overlay calls this on every move to render the live draft, and once more on
 * pointer-up to decide whether there is anything worth committing.
 */
export const buildShape = (tool: DrawTool, points: Point[]): Shape | null => {
  if (points.length < 2) return null;

  const from = points[0]!;
  const to = points[points.length - 1]!;

  if (tool === 'freehand') return { kind: 'freehand', points };

  // A drag that never moved is a click, not a shape.
  if (from.x === to.x && from.y === to.y) return null;

  return tool === 'arrow' ? { kind: 'arrow', from, to } : { kind: 'rect', from, to };
};
```

- [ ] **Step 5: Run and watch it pass**

```bash
pnpm --filter @sandbox/web test draft
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Write the failing test for `freehandPath`**

`apps/web/lib/canvas/freehand.test.ts`:

```ts
import { expect, test } from 'vitest';
import { freehandPath } from './freehand';

test('a multi-point path produces a non-empty SVG path string', () => {
  const d = freehandPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], 3);

  expect(d.startsWith('M')).toBe(true);
  expect(d).toContain('Z');
});

test('an empty path produces an empty string, not a crash', () => {
  expect(freehandPath([], 3)).toBe('');
});
```

- [ ] **Step 7: Run and watch it fail**

```bash
pnpm --filter @sandbox/web test freehand
```

Expected: FAIL — cannot resolve `./freehand`.

- [ ] **Step 8: Write `freehand.ts`**

`apps/web/lib/canvas/freehand.ts`:

```ts
import getStroke from 'perfect-freehand';
import type { Point } from '@sandbox/shared';

const average = (a: number, b: number): number => (a + b) / 2;

/** Outline points → a smooth SVG path, the standard perfect-freehand recipe. */
const toSvgPath = (points: number[][]): string => {
  if (points.length === 0) return '';

  const first = points[0]!;
  let d = `M ${first[0]!.toFixed(2)} ${first[1]!.toFixed(2)} Q`;

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]! as [number, number];
    const [x1, y1] = points[i + 1]! as [number, number];
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${average(x0, x1).toFixed(2)} ${average(y0, y1).toFixed(2)}`;
  }

  return `${d} Z`;
};

/** A freehand stroke as a filled SVG outline path. `width` scales the pen. */
export const freehandPath = (points: Point[], width: number): string => {
  if (points.length === 0) return '';

  const outline = getStroke(
    points.map((p) => [p.x, p.y, p.p ?? 0.5]),
    { size: width * 2, thinning: 0.5, smoothing: 0.5, streamline: 0.5 },
  );

  return toSvgPath(outline);
};
```

- [ ] **Step 9: Run and watch it pass, and commit**

```bash
pnpm --filter @sandbox/web test draft freehand
pnpm --filter @sandbox/web typecheck
```

Expected: PASS — 7 tests across the two files, no type errors.

```bash
git add apps/web/package.json apps/web/lib/canvas/draft.ts apps/web/lib/canvas/draft.test.ts apps/web/lib/canvas/freehand.ts apps/web/lib/canvas/freehand.test.ts ../../pnpm-lock.yaml
git commit -m "feat(web): the draft-shape builder and the perfect-freehand path" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(If the `git add` path to the lockfile errors, add it from the repo root: `git add pnpm-lock.yaml`.)

---

### Task 4: Canvas state and the strokes subscription

Two small React pieces. No unit tests — the codebase tests pure logic and verifies React through Playwright (Phase 2's `ExecContext`, `RunBar`, and `Terminal` had no unit tests either). These are exercised by the e2e tests in Task 7.

**Files:**
- Create: `apps/web/lib/canvas/CanvasContext.tsx`, `apps/web/lib/yjs/useStrokes.ts`

**Interfaces:**
- Consumes: `User`, `Stroke`, `getStrokes` from `@sandbox/shared`; `useRoomContext` from `@/lib/yjs/RoomContext`.
- Produces: `type Mode = 'code' | 'draw'`; `type Tool = 'freehand' | 'arrow' | 'rect' | 'text' | 'eraser'`; `<CanvasProvider user>`; `useCanvas(): { mode; setMode; tool; setTool; user }`; `useStrokes(fileId: string): Stroke[]`.

- [ ] **Step 1: Write `CanvasContext.tsx`**

`apps/web/lib/canvas/CanvasContext.tsx`:

```tsx
'use client';

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import type { User } from '@sandbox/shared';

export type Mode = 'code' | 'draw';
export type Tool = 'freehand' | 'arrow' | 'rect' | 'text' | 'eraser';

type CanvasContextValue = {
  mode: Mode;
  setMode: (mode: Mode) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  user: User;
};

const CanvasContext = createContext<CanvasContextValue | null>(null);

export const useCanvas = (): CanvasContextValue => {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('useCanvas must be used inside <CanvasProvider>');
  return value;
};

export function CanvasProvider({ user, children }: { user: User; children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('code');
  const [tool, setTool] = useState<Tool>('freehand');

  const value = useMemo(() => ({ mode, setMode, tool, setTool, user }), [mode, tool, user]);

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
```

- [ ] **Step 2: Write `useStrokes.ts`**

`apps/web/lib/yjs/useStrokes.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { type Stroke, getStrokes } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** The strokes for one file, re-read whenever anyone draws, erases, or undoes. */
export const useStrokes = (fileId: string): Stroke[] => {
  const { doc } = useRoomContext();
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    getStrokes(doc).toArray().filter((s) => s.fileId === fileId),
  );

  useEffect(() => {
    const array = getStrokes(doc);
    const read = () => setStrokes(array.toArray().filter((s) => s.fileId === fileId));

    read();
    array.observe(read);
    return () => array.unobserve(read);
  }, [doc, fileId]);

  return strokes;
};
```

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @sandbox/web typecheck
```

Expected: no type errors.

```bash
git add apps/web/lib/canvas/CanvasContext.tsx apps/web/lib/yjs/useStrokes.ts
git commit -m "feat(web): canvas mode/tool context and the strokes subscription" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: The overlay

The SVG layer: it renders committed strokes and remote drafts, captures the pen in Draw mode, broadcasts the live draft over awareness, commits on pointer-up, keeps the transform in step with Monaco's scroll, and toggles Monaco `readOnly` with the mode. It is the biggest single file in the phase and has no unit test; it is proven by Task 7.

**Files:**
- Create: `apps/web/components/CanvasOverlay.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–4; `DEFAULT_FILE`, `STROKE_WIDTH`, `type Stroke`, `type DraftStroke`, `type Shape`, `appendStroke`, `eraseStroke` from `@sandbox/shared`; `useRoomContext`; `useCanvas`; `useStrokes`; `toContentPoint`; `buildShape`; `freehandPath`; `hits`.
- Produces: `<CanvasOverlay instance={editor.IStandaloneCodeEditor} />`.

- [ ] **Step 1: Write `CanvasOverlay.tsx`**

`apps/web/components/CanvasOverlay.tsx`:

```tsx
'use client';

import {
  DEFAULT_FILE,
  type DraftStroke,
  STROKE_WIDTH,
  type Shape,
  type Stroke,
  appendStroke,
  eraseStroke,
} from '@sandbox/shared';
import type { editor } from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { useCanvas } from '@/lib/canvas/CanvasContext';
import { type DrawTool, buildShape } from '@/lib/canvas/draft';
import { freehandPath } from '@/lib/canvas/freehand';
import { hits } from '@/lib/canvas/hitTest';
import { toContentPoint } from '@/lib/canvas/coords';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useStrokes } from '@/lib/yjs/useStrokes';

const ERASER_TOLERANCE = 8;
const DRAFT_THROTTLE_MS = 40;
const DRAW_TOOLS: DrawTool[] = ['freehand', 'arrow', 'rect'];

/** One shape → its SVG element. Used for committed strokes, live drafts, and remote drafts. */
function ShapeView({ shape, color, opacity = 1 }: { shape: Shape; color: string; opacity?: number }) {
  switch (shape.kind) {
    case 'freehand':
      return <path d={freehandPath(shape.points, STROKE_WIDTH)} fill={color} opacity={opacity} />;
    case 'arrow': {
      const { from, to } = shape;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = 10;
      const left = { x: to.x - head * Math.cos(angle - Math.PI / 6), y: to.y - head * Math.sin(angle - Math.PI / 6) };
      const right = { x: to.x - head * Math.cos(angle + Math.PI / 6), y: to.y - head * Math.sin(angle + Math.PI / 6) };
      return (
        <g stroke={color} strokeWidth={STROKE_WIDTH} fill={color} opacity={opacity}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          <polygon points={`${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`} />
        </g>
      );
    }
    case 'rect': {
      const { from, to } = shape;
      return (
        <rect
          x={Math.min(from.x, to.x)}
          y={Math.min(from.y, to.y)}
          width={Math.abs(to.x - from.x)}
          height={Math.abs(to.y - from.y)}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          opacity={opacity}
        />
      );
    }
    case 'text':
      return (
        <text x={shape.at.x} y={shape.at.y} fill={color} fontSize={14} opacity={opacity}>
          {shape.text}
        </text>
      );
  }
}

export function CanvasOverlay({ instance }: { instance: editor.IStandaloneCodeEditor }) {
  const { doc, awareness } = useRoomContext();
  const { mode, tool, user } = useCanvas();
  const strokes = useStrokes(DEFAULT_FILE.id);

  const [scroll, setScroll] = useState({ left: instance.getScrollLeft(), top: instance.getScrollTop() });
  const [drafts, setDrafts] = useState<DraftStroke[]>([]); // remote, from awareness
  const [localDraft, setLocalDraft] = useState<Shape | null>(null);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');

  const drawing = useRef<{ points: { x: number; y: number }[] } | null>(null);
  const lastBroadcast = useRef(0);
  const svg = useRef<SVGSVGElement>(null);

  // Keep the strokes group in step with Monaco's scroll. This is what pins a stroke to its code.
  useEffect(() => {
    const sub = instance.onDidScrollChange(() =>
      setScroll({ left: instance.getScrollLeft(), top: instance.getScrollTop() }),
    );
    return () => sub.dispose();
  }, [instance]);

  // Draw mode makes the editor read-only, so a stray keystroke cannot edit code while you draw.
  useEffect(() => {
    instance.updateOptions({ readOnly: mode === 'draw' });
  }, [instance, mode]);

  // Collect every peer's in-progress draft from awareness (mine is rendered from localDraft).
  useEffect(() => {
    const read = () => {
      const mine = awareness.clientID;
      const next: DraftStroke[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== mine && state?.draft?.fileId === DEFAULT_FILE.id) next.push(state.draft);
      });
      setDrafts(next);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);

  const pointFromEvent = (event: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return toContentPoint(event.clientX, event.clientY, rect, {
      left: instance.getScrollLeft(),
      top: instance.getScrollTop(),
    });
  };

  const broadcastDraft = (shape: Shape) => {
    const now = Date.now();
    if (now - lastBroadcast.current < DRAFT_THROTTLE_MS) return;
    lastBroadcast.current = now;
    awareness.setLocalStateField('draft', {
      fileId: DEFAULT_FILE.id,
      color: user.color,
      width: STROKE_WIDTH,
      shape,
    } satisfies DraftStroke);
  };

  const clearDraft = () => {
    drawing.current = null;
    setLocalDraft(null);
    awareness.setLocalStateField('draft', undefined);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (mode !== 'draw') return;
    const point = pointFromEvent(event);

    if (tool === 'text') {
      setTextAt(point);
      setTextValue('');
      return;
    }
    if (tool === 'eraser') {
      for (const stroke of strokes) if (hits(stroke, point, ERASER_TOLERANCE)) eraseStroke(doc, stroke.id);
      drawing.current = { points: [point] };
      return;
    }

    (event.target as Element).setPointerCapture(event.pointerId);
    drawing.current = { points: [point] };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (mode !== 'draw' || !drawing.current) return;
    const point = pointFromEvent(event);
    drawing.current.points.push(point);

    if (tool === 'eraser') {
      for (const stroke of strokes) if (hits(stroke, point, ERASER_TOLERANCE)) eraseStroke(doc, stroke.id);
      return;
    }

    const shape = buildShape(tool as DrawTool, drawing.current.points);
    if (shape) {
      setLocalDraft(shape);
      broadcastDraft(shape);
    }
  };

  const onPointerUp = () => {
    if (mode !== 'draw' || !drawing.current) return;
    if (tool === 'eraser') {
      drawing.current = null;
      return;
    }

    const shape = DRAW_TOOLS.includes(tool as DrawTool)
      ? buildShape(tool as DrawTool, drawing.current.points)
      : null;

    if (shape) {
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: DEFAULT_FILE.id,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape,
        createdAt: Date.now(),
      });
    }
    clearDraft();
  };

  const commitText = () => {
    const text = textValue.trim();
    if (textAt && text) {
      appendStroke(doc, {
        id: crypto.randomUUID(),
        fileId: DEFAULT_FILE.id,
        authorId: user.id,
        color: user.color,
        width: STROKE_WIDTH,
        shape: { kind: 'text', at: textAt, text },
        createdAt: Date.now(),
      });
    }
    setTextAt(null);
    setTextValue('');
  };

  return (
    <svg
      ref={svg}
      data-testid="canvas"
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: mode === 'draw' ? 'auto' : 'none', cursor: mode === 'draw' ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <g transform={`translate(${-scroll.left}, ${-scroll.top})`}>
        {strokes.map((stroke: Stroke) => (
          <g key={stroke.id} data-testid="stroke">
            <ShapeView shape={stroke.shape} color={stroke.color} />
          </g>
        ))}
        {drafts.map((draft, i) => (
          <ShapeView key={`remote-${i}`} shape={draft.shape} color={draft.color} opacity={0.6} />
        ))}
        {localDraft && <ShapeView shape={localDraft} color={user.color} opacity={0.8} />}
        {textAt && (
          <foreignObject x={textAt.x} y={textAt.y - 18} width={200} height={28}>
            <input
              aria-label="Text annotation"
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
                if (e.key === 'Escape') {
                  setTextAt(null);
                  setTextValue('');
                }
              }}
              className="w-full rounded border border-neutral-600 bg-neutral-900 px-1 text-sm text-white"
            />
          </foreignObject>
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm --filter @sandbox/web typecheck
```

Expected: no type errors. (`ShapeView`'s switch is exhaustive over `Shape['kind']`; if TypeScript complains about a missing return, every case already returns, so the error would be a real omission — fix it.)

```bash
git add apps/web/components/CanvasOverlay.tsx
git commit -m "feat(web): the SVG overlay — draw, erase, live pen, scroll-synced transform" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: The toolbar and wiring it all together

The toolbar drives mode/tool/undo. `CodeEditor` mounts the overlay over Monaco; `Workspace` provides the canvas context and places the toolbar. After this task the feature is usable by hand.

**Files:**
- Create: `apps/web/components/Toolbar.tsx`
- Modify: `apps/web/components/CodeEditor.tsx`, `apps/web/components/Workspace.tsx`

**Interfaces:**
- Consumes: `useCanvas`, `undoLastStrokeBy`, `useRoomContext`, `CanvasProvider`.
- Produces: `<Toolbar />`; `CodeEditor` renders `<CanvasOverlay>`; `Workspace` wraps the tree in `<CanvasProvider>`.

- [ ] **Step 1: Write `Toolbar.tsx`**

`apps/web/components/Toolbar.tsx`:

```tsx
'use client';

import { undoLastStrokeBy } from '@sandbox/shared';
import { type Tool, useCanvas } from '@/lib/canvas/CanvasContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'freehand', label: '✎ Pen' },
  { id: 'arrow', label: '↗ Arrow' },
  { id: 'rect', label: '▭ Box' },
  { id: 'text', label: 'T Text' },
  { id: 'eraser', label: '⌫ Erase' },
];

export function Toolbar() {
  const { doc } = useRoomContext();
  const { mode, setMode, tool, setTool, user } = useCanvas();

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
      <button
        type="button"
        data-testid="mode-toggle"
        onClick={() => setMode(mode === 'draw' ? 'code' : 'draw')}
        className={`rounded-md px-3 py-1 text-sm font-medium ${
          mode === 'draw' ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-200'
        }`}
      >
        {mode === 'draw' ? '✎ Drawing' : '✎ Draw'}
      </button>

      <div className="flex items-center gap-1" aria-disabled={mode !== 'draw'}>
        {TOOLS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-testid={`tool-${id}`}
            disabled={mode !== 'draw'}
            onClick={() => setTool(id)}
            className={`rounded-md px-2 py-1 text-sm ${
              tool === id ? 'bg-neutral-700 text-white' : 'text-neutral-400'
            } disabled:opacity-40`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="undo"
        disabled={mode !== 'draw'}
        onClick={() => undoLastStrokeBy(doc, user.id)}
        className="rounded-md px-2 py-1 text-sm text-neutral-400 disabled:opacity-40"
      >
        ↶ Undo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount the overlay in `CodeEditor.tsx`**

`apps/web/components/CodeEditor.tsx` — replace the returned JSX so the editor and overlay share a relative container. Add the import and wrap `<Editor>`:

Add to the imports:

```tsx
import { CanvasOverlay } from './CanvasOverlay';
```

Replace the `return (…)` block with:

```tsx
  return (
    <div className="relative h-full">
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
      {instance && <CanvasOverlay instance={instance} />}
    </div>
  );
```

Everything above the `return` (the bindings, the `Ctrl`/`Cmd`+Enter command, the language effect) is unchanged.

- [ ] **Step 3: Provide the context and place the toolbar in `Workspace.tsx`**

`apps/web/components/Workspace.tsx` — add the imports:

```tsx
import { CanvasProvider } from '@/lib/canvas/CanvasContext';
import { Toolbar } from './Toolbar';
```

Wrap the existing tree in `<CanvasProvider user={user}>` (just inside `<ExecProvider>`), and add `<Toolbar />` directly below `<RunBar />`:

```tsx
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
```

- [ ] **Step 4: Look at it with your own eyes**

```bash
pnpm piston:up   # only if you also want the Run button; not needed for drawing
pnpm dev
# open http://localhost:3000, create a sandbox, join
```

Expected: a **Draw** button in the toolbar. Click it — the button lights up and the editor stops accepting typing. Draw with the pen; release; the stroke stays. Switch to Box/Arrow/Text and draw each. Erase one with the eraser. Undo removes your last stroke. Click **Draw** again (back to Code mode) — typing works again and the strokes stay put. Scroll the editor — the strokes move *with the code*, not with the viewport. Open a second browser window in the same room and confirm a stroke drawn in one appears in the other.

If drawing does nothing, the overlay is not receiving pointer events — check that Draw mode sets `pointer-events: auto`. If strokes drift away from the code as you scroll, the `translate(−scroll)` transform is not tracking `onDidScrollChange`.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @sandbox/web typecheck
```

Expected: no type errors.

```bash
git add apps/web/components/Toolbar.tsx apps/web/components/CodeEditor.tsx apps/web/components/Workspace.tsx
git commit -m "feat(web): the drawing toolbar, wired over Monaco in the workspace" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: The two-person drawing test, and the README

The acceptance criterion for the phase: A draws over the code; B sees it on the same code. Everything else exists to make this test pass.

**Files:**
- Create: `e2e/drawing.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the tests**

Two **browser contexts**, not two tabs — as in Phases 1–2, contexts are isolated, so nothing syncs behind the server's back and hands us a false pass. Strokes are real SVG elements, so we assert on the DOM directly (no xterm-style viewport quirks).

`e2e/drawing.spec.ts`:

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

test('one person draws over the code, and the other sees the same stroke', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click(); // enter Draw mode
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });

  // Bob drew nothing, and Bob sees the stroke.
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  // Content space, not screen space: the committed path is byte-identical for both viewers.
  const alicePath = await alice.getByTestId('stroke').locator('path').getAttribute('d');
  const bobPath = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  expect(bobPath).toBe(alicePath);

  await aliceCtx.close();
  await bobCtx.close();
});

test('the stroke stays pinned to its code when the reader scrolls', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click();
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  const before = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  // Bob scrolls the editor. The stroke's content-space path must not change — only the group's transform.
  await bob.mouse.move(400, 300);
  await bob.mouse.wheel(0, 200);
  const after = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  expect(after).toBe(before);

  await aliceCtx.close();
  await bobCtx.close();
});

test('in Code mode the canvas does not eat keystrokes', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  // Default is Code mode. Type into the editor with the overlay present.
  await page.locator('.monaco-editor').click();
  await page.keyboard.type('# hello from a test');

  await expect(page.locator('.monaco-editor')).toContainText('hello from a test');
});

test('the live pen shows a peer\'s stroke before they release', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click();

  // Alice presses and moves but does NOT release.
  const canvas = alice.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await alice.mouse.move(box.x + 80, box.y + 60);
  await alice.mouse.down();
  await alice.mouse.move(box.x + 180, box.y + 90, { steps: 8 });

  // Bob sees a live draft path even though nothing has committed yet (no data-testid=stroke).
  await expect(bob.getByTestId('canvas').locator('path')).toHaveCount(1, { timeout: 10_000 });
  await expect(bob.getByTestId('stroke')).toHaveCount(0);

  await alice.mouse.up();
  // On release it commits and becomes a real stroke for both.
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test('undo removes your own last stroke; the eraser removes by hit-test', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');
  await page.getByTestId('mode-toggle').click();

  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 60 });
  await drawStroke(page, { x: 80, y: 120 }, { x: 200, y: 120 });
  await expect(page.getByTestId('stroke')).toHaveCount(2);

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  // Erase the survivor by dragging the eraser across it.
  await page.getByTestId('tool-eraser').click();
  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 60 });
  await expect(page.getByTestId('stroke')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test:e2e e2e/drawing.spec.ts
```

Expected: PASS — 5 tests. If the "same stroke" test fails because Bob's path differs from Alice's, strokes are being stored in screen space rather than content space. If the scroll test fails, the transform is baked into the path rather than the group.

- [ ] **Step 3: Run the whole suite**

```bash
pnpm test
pnpm typecheck
pnpm test:e2e
```

Expected: all green. Unit/integration count rises by the Task 1–3 additions (5 doc + 2 coords + 4 hitTest + 5 draft + 2 freehand = 18 new). Playwright rises by 5. Fix anything red before the README — a README that describes software whose tests fail is a lie.

- [ ] **Step 4: Update the README**

`README.md` — update the "Status", "What works today", "Architecture", "Tests", and "Not built yet" sections.

Status line:

```markdown
**Status:** Phase 3 of 5 complete — collaborative editing, shared execution, and a drawing overlay.
```

Add to "What works today":

```markdown
- Toggle **Draw** and mark up the code — freehand, arrows, boxes, and short text labels, in your own
  colour. Everyone sees your drawing pinned to the same code, even when they are scrolled elsewhere,
  and watches your pen move live as you draw.
- The eraser removes any stroke by hit-test; undo removes your own last stroke.
```

Add to "Architecture":

```markdown
- **The canvas is an SVG layer over Monaco**, and drawings are stored in *content* space, not screen
  space — so a stroke over line 12 is on line 12 for everyone, whatever their scroll. A hard Code/Draw
  `pointer-events` switch keeps the canvas and editor from fighting over the pointer. Strokes are
  ordinary Y.Doc state and sync through the same pure relay; the live in-progress pen rides on awareness.
```

Update "Tests" (use the real totals printed by `pnpm test` and `pnpm test:e2e`):

```markdown
pnpm test         # 107 unit + integration tests (Vitest)
pnpm test:e2e     # 13 browser tests (Playwright), incl. two browsers drawing over one document
```

Update "Not built yet":

```markdown
Postgres persistence and multi-file support (Phase 4), line-anchored annotations and deployment (Phase 5).
```

- [ ] **Step 5: Commit**

```bash
git add e2e/drawing.spec.ts README.md
git commit -m "test(e2e): two-person drawing over shared code, and the README" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** Every section of the Phase 3 spec maps to a task. Overlay + mode toggle → Task 5 (`CanvasOverlay`), Task 6 (`Toolbar`, wiring). Content-space coordinates → Task 2 (`coords.ts`), and the transform in Task 5. Transport, no server changes → Tasks 1 and 5 (strokes in the `Y.Array`, draft on awareness). Data model — width, `DraftStroke`, accessors → Task 1. Tools (freehand/arrow/rect/text) → Task 3 (`buildShape`), Task 5 (rendering + text input). Eraser/undo → Task 1 (accessors), Task 5 (eraser), Task 6 (undo button). Live pen → Task 5 (awareness broadcast + remote-draft render). Error handling — degenerate discard (Task 3), idempotent erase (Task 1), disconnect (awareness, inherent), code-mode pointer-events (Task 7 test). Testing → every task, acceptance in Task 7. Nothing in the spec is unassigned.

**Type consistency.** `Tool` is defined once in `CanvasContext.tsx` and re-used by `Toolbar`; `DrawTool` (`'freehand' | 'arrow' | 'rect'`) is defined once in `draft.ts` and re-used by the overlay. `buildShape(tool, points)`, `hits(stroke, point, tolerance)`, `toContentPoint(clientX, clientY, rect, scroll)`, `freehandPath(points, width)`, and the three doc accessors keep the same signatures everywhere they appear. `DraftStroke` is the shared type used by the awareness field, the broadcast, and the remote-draft render.

**Placeholder scan.** No step defers content; every code step shows complete code and every command names its expected result.

**One judgement call worth flagging for review.** The overlay (`CanvasOverlay.tsx`) is a large component with no unit test, verified only end-to-end — consistent with how Phase 2's `Terminal`/`RunBar` were handled, but it is the riskiest file in the phase. Its pure dependencies (`coords`, `hitTest`, `draft`, `freehand`) are all unit-tested in isolation, so a failure in Task 7 points at the wiring, not the geometry.

**Test-count line in the README.** The plan writes concrete totals (107 / 13). If the real numbers differ when the suite runs, use the actual output — the README must not state a count the suite does not produce.
