# Landing and Join Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The landing page demos the product with an ambient fake-editor scene, and the join gate previews the identity you are picking — with zero behaviour change visible to the e2e suite.

**Architecture:** All motion is CSS keyframes in `globals.css`, shared by both pages. A new presentational `HeroScene` component renders the fake editor; `page.tsx` is rebuilt around it; `JoinGate` is restyled in place and gains an optional `roomId` prop. Nothing else in the workspace changes.

**Tech Stack:** Next.js 15 + Tailwind 4 (already present). No new dependencies of any kind.

Spec: `Docs/superpowers/specs/2026-07-19-landing-join-redesign-design.md`.

## Global Constraints

- **Zero new dependencies.** Nothing added to any `package.json`.
- **Frozen selectors** — the e2e suite depends on them, verbatim: `data-testid="create-room"` on the landing CTA; the `Display name` label; the `Join sandbox` button text.
- **Frozen behaviour**: CTA still does `router.push('/s/' + nanoid(ROOM_ID_LENGTH))`; JoinGate's identity logic (`loadIdentity`, `sanitizeName`, `saveIdentity`, `USER_COLORS`, `MAX_NAME_LENGTH`) is untouched.
- **Only `transform`, `opacity`, and `clip-path` animate.** No property that causes layout.
- **`prefers-reduced-motion: reduce` disables every animation and transition globally**, and the headline underline must render already-drawn under it.
- **Hydration-safe**: no `Math.random`, no `Date.now()`, no `window` reads at render. Every animation parameter is a literal.
- **The workspace is untouched** except one line in `Workspace.tsx` passing `roomId` to `JoinGate`.
- Package manager is **pnpm**. Never `npm install`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

```text
apps/web/app/globals.css              MOD  keyframes, ambience utilities, scene classes, reduced-motion guard
apps/web/components/HeroScene.tsx     NEW  the ambient editor window; pure presentation, no props
apps/web/app/page.tsx                 MOD  rebuilt: nav, split hero, feature row
apps/web/components/JoinGate.tsx      MOD  restyled; live identity preview; optional roomId prop
apps/web/components/Workspace.tsx     MOD  one line: <JoinGate roomId={roomId}>
```

**Task order rationale.** Task 1 is pure CSS that nothing uses yet, so the suite stays green. Task 2 builds the landing on top of it. Task 3 is independent of Task 2 but shares Task 1's utilities. Task 4 is verification only.

---

### Task 1: The motion foundation in `globals.css`

Keyframes and ambience utilities both pages share. Nothing references them yet, so this lands invisibly.

**Files:**
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces (class names Tasks 2–3 rely on): `bg-dots`, `glow-hero`, `glow-join`, `anim-fade-up`, `anim-fade-in`, `anim-scene-in`, `anim-card-in`, `anim-underline`, `draw-underline-path`, `hero-caret`, `hero-anno`, `rc`, `rc-tag`, `rc-ada`, `rc-bob`, `preview-bob`, `pill-dot`, and syntax colours `c-com c-kw c-fn c-str c-num c-op c-tx`.

- [ ] **Step 1: Append the motion system to `globals.css`**

Replace the entire file content of `apps/web/app/globals.css` with:

```css
@import "tailwindcss";

html,
body {
  height: 100%;
}

/* ------------------------------------------------------------------ */
/* Landing & join motion system — spec 2026-07-19.                     */
/* Only transform, opacity, and clip-path ever animate: compositor-    */
/* friendly, and no layout shift by construction.                      */
/* ------------------------------------------------------------------ */

/* Page ambience, shared by the landing and the join gate. */
.bg-dots {
  background-image: radial-gradient(circle 1px at 1px 1px, #18181b 98%, transparent);
  background-size: 26px 26px;
}
.glow-hero {
  background:
    radial-gradient(ellipse 55% 45% at 68% 42%, rgba(99, 102, 241, 0.13), transparent 70%),
    radial-gradient(ellipse 40% 35% at 20% 80%, rgba(236, 72, 153, 0.05), transparent 70%);
}
.glow-join {
  background: radial-gradient(ellipse 50% 40% at 50% 38%, rgba(99, 102, 241, 0.1), transparent 70%);
}

/* Entrances — run once on load. */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes scene-in {
  from { opacity: 0; transform: translateY(18px) scale(0.975); }
  to { opacity: 1; transform: none; }
}
.anim-fade-up { animation: fade-up 0.7s ease both; }
.anim-fade-in { animation: fade-in 0.7s ease both; }
.anim-scene-in { animation: scene-in 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.25s both; }
.anim-card-in { animation: scene-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }

/* The headline's hand-drawn underline draws itself once. */
@keyframes draw-underline {
  to { stroke-dashoffset: 0; }
}
.anim-underline { animation: draw-underline 0.7s ease 0.9s forwards; }

/* Ambient loops — slow, few, forever. */
@keyframes caret-blink {
  50% { opacity: 0; }
}
@keyframes breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes preview-float {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(6px, -4px); }
}
@keyframes anno-cycle {
  0%, 8% { clip-path: inset(0 100% 100% 0); opacity: 0; }
  12% { opacity: 1; }
  30%, 78% { clip-path: inset(0 0 0 0); opacity: 1; }
  90%, 100% { clip-path: inset(0 0 0 0); opacity: 0; }
}
/* 13s vs 16s: coprime-ish periods so the two cursors' phases never visibly sync. */
@keyframes path-ada {
  0% { transform: translate(300px, 210px); }
  22% { transform: translate(70px, 100px); }
  45% { transform: translate(260px, 150px); }
  70% { transform: translate(150px, 250px); }
  100% { transform: translate(300px, 210px); }
}
@keyframes path-bob {
  0% { transform: translate(120px, 60px); }
  28% { transform: translate(340px, 190px); }
  55% { transform: translate(210px, 90px); }
  80% { transform: translate(90px, 200px); }
  100% { transform: translate(120px, 60px); }
}

.pill-dot { animation: breathe 2.6s ease-in-out infinite; }
.preview-bob { animation: preview-float 3.2s ease-in-out infinite; }
.hero-caret {
  display: inline-block;
  width: 2px;
  height: 15px;
  vertical-align: -2px;
  background: #a5b4fc;
  animation: caret-blink 1.1s steps(1) infinite;
}
.hero-anno {
  position: absolute;
  border: 2.5px solid #f472b6;
  border-radius: 6px;
  box-shadow: 0 0 20px rgba(244, 114, 182, 0.25);
  animation: anno-cycle 9s ease-in-out infinite;
  pointer-events: none;
}

/* Remote cursors in the hero scene. --c is set per cursor. */
.rc {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
}
.rc-tag {
  position: absolute;
  left: 11px;
  top: 13px;
  padding: 2.5px 7px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 650;
  color: #09090b;
  white-space: nowrap;
  background: var(--c);
}
.rc-ada { --c: #f472b6; animation: path-ada 13s ease-in-out infinite; }
.rc-bob { --c: #34d399; animation: path-bob 16s ease-in-out infinite; }

/* Hand-rolled syntax colours for the HeroScene code. */
.c-com { color: #52525b; }
.c-kw { color: #c084fc; }
.c-fn { color: #60a5fa; }
.c-str { color: #34d399; }
.c-num { color: #fbbf24; }
.c-op { color: #a1a1aa; }
.c-tx { color: #e4e4e7; }

/* The whole page goes static for users who ask for it. The underline
   must end up drawn, not invisible — hence the dashoffset override. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
  .draw-underline-path {
    stroke-dashoffset: 0 !important;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean — CSS only, nothing imports it differently.

- [ ] **Step 3: Prove the suite does not notice**

Run: `pnpm test:e2e smoke`
Expected: 2 passed. The classes exist but nothing uses them yet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): a motion system for the first-impression pages

Keyframes and ambience utilities shared by the landing and join pages.
Only transform, opacity, and clip-path ever animate, and
prefers-reduced-motion disables all of it globally - with the headline
underline forced to its drawn state rather than left invisible.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `HeroScene` and the rebuilt landing page

**Files:**
- Create: `apps/web/components/HeroScene.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: Task 1's class names; `nanoid`, `ROOM_ID_LENGTH` (already imported by `page.tsx` today).
- Produces: `HeroScene` — a no-props client component; `page.tsx` keeps `data-testid="create-room"`.

- [ ] **Step 1: Create `apps/web/components/HeroScene.tsx`**

```tsx
'use client';

import type { ReactNode } from 'react';

/**
 * The ambient editor scene: a truthful miniature of the product. The code is the app's real
 * seeded file (DEFAULT_FILE_CONTENT in packages/shared/src/doc.ts — update this by hand if that
 * ever changes), the cursor colours are from USER_COLORS, and the annotation quietly demos the
 * anchoring feature. Purely decorative: aria-hidden, no pointer events, no props.
 */

const Row = ({ n, children }: { n: number; children?: ReactNode }) => (
  <div className="flex whitespace-pre px-4 leading-[1.75]">
    <span className="mr-4 w-6 flex-none select-none text-right text-xs leading-[1.75] text-neutral-700">
      {n}
    </span>
    <span>{children ?? ' '}</span>
  </div>
);

const Cursor = ({ who, className }: { who: string; className: string }) => (
  <div className={`rc ${className}`}>
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <path d="M1 1 L13 8 L7 9.5 L4.5 15 Z" fill="var(--c)" />
    </svg>
    <span className="rc-tag">{who}</span>
  </div>
);

export function HeroScene() {
  return (
    <div aria-hidden="true" className="anim-scene-in pointer-events-none relative select-none">
      <div className="relative overflow-hidden rounded-xl border border-neutral-700/70 bg-[#0c0c10] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_30px_80px_rgba(0,0,0,0.6)]">
        {/* chrome */}
        <div className="flex items-center gap-2 border-b border-neutral-700/50 bg-neutral-900/50 px-3.5 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-[11px] w-[11px] rounded-full bg-neutral-700" />
            <span className="h-[11px] w-[11px] rounded-full bg-neutral-700" />
            <span className="h-[11px] w-[11px] rounded-full bg-neutral-700" />
          </div>
          <div className="ml-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1 font-mono text-xs text-neutral-300">
            main.py
          </div>
          <div className="ml-auto flex">
            <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-[#0c0c10] bg-[#f472b6] text-[9px] font-bold text-neutral-950">
              A
            </span>
            <span className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full border-2 border-[#0c0c10] bg-[#34d399] text-[9px] font-bold text-neutral-950">
              B
            </span>
          </div>
        </div>

        {/* code — the real DEFAULT_FILE_CONTENT, coloured by hand */}
        <div className="relative py-4 font-mono text-[13.5px]">
          <Row n={1}>
            <span className="c-com"># Two people, one file. Try typing while someone else does.</span>
          </Row>
          <Row n={2} />
          <Row n={3}>
            <span className="c-kw">def</span>
            <span className="c-tx"> </span>
            <span className="c-fn">fizzbuzz</span>
            <span className="c-tx">(n: </span>
            <span className="c-kw">int</span>
            <span className="c-tx">) -&gt; </span>
            <span className="c-kw">str</span>
            <span className="c-tx">:</span>
          </Row>
          <Row n={4}>
            <span className="c-tx">    </span>
            <span className="c-kw">if</span>
            <span className="c-tx"> n </span>
            <span className="c-op">%</span>
            <span className="c-tx"> </span>
            <span className="c-num">15</span>
            <span className="c-tx"> </span>
            <span className="c-op">==</span>
            <span className="c-tx"> </span>
            <span className="c-num">0</span>
            <span className="c-tx">:</span>
          </Row>
          <Row n={5}>
            <span className="c-tx">        </span>
            <span className="c-kw">return</span>
            <span className="c-tx"> </span>
            <span className="c-str">&quot;FizzBuzz&quot;</span>
          </Row>
          <Row n={6}>
            <span className="c-tx">    </span>
            <span className="c-kw">if</span>
            <span className="c-tx"> n </span>
            <span className="c-op">%</span>
            <span className="c-tx"> </span>
            <span className="c-num">3</span>
            <span className="c-tx"> </span>
            <span className="c-op">==</span>
            <span className="c-tx"> </span>
            <span className="c-num">0</span>
            <span className="c-tx">:</span>
          </Row>
          <Row n={7}>
            <span className="c-tx">        </span>
            <span className="c-kw">return</span>
            <span className="c-tx"> </span>
            <span className="c-str">&quot;Fizz&quot;</span>
            <span className="hero-caret" />
          </Row>
          <Row n={8}>
            <span className="c-tx">    </span>
            <span className="c-kw">if</span>
            <span className="c-tx"> n </span>
            <span className="c-op">%</span>
            <span className="c-tx"> </span>
            <span className="c-num">5</span>
            <span className="c-tx"> </span>
            <span className="c-op">==</span>
            <span className="c-tx"> </span>
            <span className="c-num">0</span>
            <span className="c-tx">:</span>
          </Row>
          <Row n={9}>
            <span className="c-tx">        </span>
            <span className="c-kw">return</span>
            <span className="c-tx"> </span>
            <span className="c-str">&quot;Buzz&quot;</span>
          </Row>
          <Row n={10}>
            <span className="c-tx">    </span>
            <span className="c-kw">return</span>
            <span className="c-tx"> </span>
            <span className="c-fn">str</span>
            <span className="c-tx">(n)</span>
          </Row>
          <Row n={11} />
          <Row n={12}>
            <span className="c-kw">for</span>
            <span className="c-tx"> i </span>
            <span className="c-kw">in</span>
            <span className="c-tx"> </span>
            <span className="c-fn">range</span>
            <span className="c-tx">(</span>
            <span className="c-num">1</span>
            <span className="c-tx">, </span>
            <span className="c-num">16</span>
            <span className="c-tx">):</span>
          </Row>
          <Row n={13}>
            <span className="c-tx">    </span>
            <span className="c-fn">print</span>
            <span className="c-tx">(</span>
            <span className="c-fn">fizzbuzz</span>
            <span className="c-tx">(i))</span>
          </Row>

          {/* the ambient annotation over the def block */}
          <div className="hero-anno left-[46px] top-[62px] h-[100px] w-[58%]" />
        </div>

        <Cursor who="Ada" className="rc-ada" />
        <Cursor who="Bob" className="rc-bob" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rebuild `apps/web/app/page.tsx`**

Replace the entire file with:

```tsx
'use client';

import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { ROOM_ID_LENGTH } from '@sandbox/shared';
import { HeroScene } from '@/components/HeroScene';

const REPO_URL = 'https://github.com/Akash9874/Multimodal-Collaborative-Code-Review-Sandbox';

const FEATURES = [
  {
    icon: '▚',
    title: 'Live cursors',
    body: "Everyone's caret and selection, coloured and named, as they type.",
  },
  {
    icon: '✎',
    title: 'Drawings that follow code',
    body: 'Annotations anchor to the line they describe — edit above, they travel with it.',
  },
  {
    icon: '▶',
    title: 'One shared Run',
    body: 'Anyone runs; the room sees the same output at the same moment.',
  },
] as const;

export default function Home() {
  const router = useRouter();

  return (
    <main className="bg-dots relative flex min-h-full flex-col overflow-x-hidden">
      <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-0" />

      <nav className="anim-fade-in relative z-10 flex items-center justify-between px-10 py-5">
        <div className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-gradient-to-br from-indigo-500 to-violet-500 text-[13px]">
            ▞
          </span>
          Sandbox
        </div>
        <a
          href={REPO_URL}
          className="text-[13px] text-neutral-400 transition-colors hover:text-neutral-50"
        >
          GitHub ↗
        </a>
      </nav>

      <div className="relative z-[1] mx-auto grid w-full max-w-[1140px] flex-1 items-center gap-12 px-10 pb-10 pt-6 max-[900px]:grid-cols-1 min-[901px]:grid-cols-[46fr_54fr]">
        <div>
          <div
            className="anim-fade-up inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-400"
            style={{ animationDelay: '0.05s' }}
          >
            <span className="pill-dot h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            no accounts — a room is just a URL
          </div>

          <h1
            className="anim-fade-up mt-5 text-[clamp(38px,4.6vw,54px)] font-bold leading-[1.06] tracking-[-0.03em]"
            style={{ animationDelay: '0.14s' }}
          >
            Code together.
            <br />
            <span className="relative whitespace-nowrap">
              Draw on it.
              <svg
                className="absolute -bottom-2.5 left-[-2%] w-[104%] overflow-visible"
                viewBox="0 0 200 14"
                aria-hidden="true"
              >
                <path
                  className="draw-underline-path anim-underline"
                  d="M4 10 C 55 3, 145 3, 196 8"
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="320"
                  strokeDashoffset="320"
                />
              </svg>
            </span>
          </h1>

          <p
            className="anim-fade-up mt-5 max-w-[44ch] text-[16.5px] leading-[1.65] text-neutral-400"
            style={{ animationDelay: '0.23s' }}
          >
            A multiplayer sandbox where annotations{' '}
            <strong className="font-medium text-neutral-200">
              stick to the code they describe
            </strong>{' '}
            — live cursors, drawings over real files, and one Run button whose output everyone sees
            at the same moment.
          </p>

          <div
            className="anim-fade-up mt-7 flex items-center gap-4"
            style={{ animationDelay: '0.32s' }}
          >
            <button
              type="button"
              data-testid="create-room"
              onClick={() => router.push(`/s/${nanoid(ROOM_ID_LENGTH)}`)}
              className="group inline-flex items-center gap-2 rounded-[10px] bg-indigo-500 px-5 py-3 text-[15px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(129,140,248,0.35),0_8px_28px_rgba(99,102,241,0.35)] transition-all hover:-translate-y-px hover:bg-indigo-400 hover:shadow-[inset_0_0_0_1px_rgba(129,140,248,0.5),0_10px_34px_rgba(99,102,241,0.5)] active:translate-y-0"
            >
              Create a sandbox
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </button>
            <a
              href={`${REPO_URL}#readme`}
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-50"
            >
              How it works
            </a>
          </div>

          <p
            className="anim-fade-up mt-4 font-mono text-xs text-neutral-600"
            style={{ animationDelay: '0.41s' }}
          >
            $ share the link — that&apos;s the whole setup
          </p>
        </div>

        <HeroScene />
      </div>

      <section className="relative z-[1] mx-auto grid w-full max-w-[1140px] grid-cols-3 gap-3.5 px-10 pb-11 max-[900px]:grid-cols-1">
        {FEATURES.map((feature, index) => (
          <div
            key={feature.title}
            className="anim-fade-up flex items-start gap-3 rounded-[10px] border border-neutral-800/80 bg-neutral-900/35 px-4 py-4"
            style={{ animationDelay: `${0.5 + index * 0.08}s` }}
          >
            <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-sm">
              {feature.icon}
            </span>
            <div>
              <h3 className="text-[13.5px] font-semibold">{feature.title}</h3>
              <p className="mt-0.5 text-[12.5px] leading-normal text-neutral-500">{feature.body}</p>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: The suite must not notice**

Run: `pnpm test:e2e smoke`
Expected: 2 passed — `create-room` still mints a room and routes to it.

- [ ] **Step 5: Look at it**

Create `tmp-shot.mjs` at the repo root:

```js
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tmp-landing.png' });
await browser.close();
console.log('tmp-landing.png written');
```

Run (dev servers must be up — `pnpm dev` if not): `node tmp-shot.mjs`, then open `tmp-landing.png` and check by eye:

- copy column, editor scene right, three feature cards below — nothing overlapping
- annotation box sits over the `def fizzbuzz` block (rows 3–6), not over the line numbers
- both cursor tags visible inside the window at their current loop position
- underline sits under "Draw on it." and does not clip

Then delete both temp files: `rm tmp-shot.mjs tmp-landing.png`.
**Stop and fix geometry before committing if the annotation misses the block** — the values to tune are `left/top/h/w` on the `.hero-anno` div in `HeroScene.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/HeroScene.tsx apps/web/app/page.tsx
git commit -m "feat(web): the landing page demos the product before a word is read

A fake editor shows the app's real seeded file with two named cursors
drifting and an annotation that draws itself over the function - the
anchoring feature demonstrated, not narrated. Copy, CTA behaviour, and
the create-room test id are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The join gate previews your identity

**Files:**
- Modify: `apps/web/components/JoinGate.tsx`, `apps/web/components/Workspace.tsx`

**Interfaces:**
- Consumes: Task 1's `bg-dots`, `glow-join`, `anim-card-in`, `preview-bob`.
- Produces: `JoinGate` accepts an optional `roomId?: string` prop. `Display name` label and `Join sandbox` button text unchanged — the e2e `join` helper depends on both.

- [ ] **Step 1: Rewrite `apps/web/components/JoinGate.tsx`**

Replace the entire file with:

```tsx
'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { MAX_NAME_LENGTH, type User, sanitizeName } from '@sandbox/shared';
import { USER_COLORS, loadIdentity, randomColor, saveIdentity } from '@/lib/identity';

export function JoinGate({
  roomId,
  children,
}: {
  roomId?: string;
  children: (user: User) => ReactNode;
}) {
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
    <div className="bg-dots relative grid h-full place-items-center p-8">
      <div aria-hidden="true" className="glow-join pointer-events-none absolute inset-0" />

      <form
        onSubmit={join}
        className="anim-card-in relative w-full max-w-[400px] rounded-2xl border border-neutral-700/70 bg-neutral-900/70 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      >
        {roomId && (
          <div className="mb-1.5 flex items-center gap-2 font-mono text-xs text-neutral-500">
            joining room
            <code className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-indigo-300">
              {roomId}
            </code>
          </div>
        )}
        <h2 className="text-xl font-bold tracking-tight">Pick how you&apos;ll appear</h2>

        {/* The artefact others will actually see: a cursor with your name tag. */}
        <div className="mt-4 flex h-16 items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-neutral-800 bg-neutral-950/50">
          <div className="preview-bob relative">
            <svg width="15" height="17" viewBox="0 0 14 16" aria-hidden="true">
              <path d="M1 1 L13 8 L7 9.5 L4.5 15 Z" fill={color} />
            </svg>
            <span
              className="absolute left-3 top-3.5 whitespace-nowrap rounded px-2 py-0.5 text-[11.5px] font-semibold text-neutral-950 transition-colors"
              style={{ backgroundColor: color }}
            >
              {sanitizeName(name) || 'your name'}
            </span>
          </div>
        </div>

        <label htmlFor="name" className="mt-4 block text-[13px] text-neutral-400">
          Display name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          autoComplete="off"
          placeholder="Ada"
          className="mt-1.5 w-full rounded-[9px] border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-[15px] outline-none transition-shadow focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.25)]"
        />

        <fieldset className="mt-4">
          <legend className="text-[13px] text-neutral-400">Cursor colour</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {USER_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Choose ${option}`}
                aria-pressed={option === color}
                onClick={() => setColor(option)}
                style={{
                  backgroundColor: option,
                  boxShadow:
                    option === color
                      ? `0 0 0 2.5px #09090b, 0 0 0 5px ${option}, 0 0 16px ${option}`
                      : undefined,
                }}
                className={`h-8 w-8 rounded-full transition-transform hover:-translate-y-0.5 hover:scale-110 ${
                  option === color ? 'scale-110' : ''
                }`}
              />
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!sanitizeName(name)}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-indigo-500 px-5 py-3 text-[15px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(129,140,248,0.35),0_8px_28px_rgba(99,102,241,0.3)] transition-all hover:-translate-y-px hover:bg-indigo-400 disabled:translate-y-0 disabled:opacity-40"
        >
          Join sandbox <span>→</span>
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Pass the room id from `Workspace.tsx`**

In `apps/web/components/Workspace.tsx`, change:

```tsx
    <JoinGate>
```

to:

```tsx
    <JoinGate roomId={roomId}>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: The join flow must not notice**

Run: `pnpm test:e2e smoke presence`
Expected: 3 passed — the presence spec drives the full join flow through the restyled form.

- [ ] **Step 5: Look at it**

Create `tmp-shot.mjs` at the repo root:

```js
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000/s/previewcheck1');
await page.getByLabel('Display name').fill('Ada');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tmp-join.png' });
await browser.close();
console.log('tmp-join.png written');
```

Run: `node tmp-shot.mjs`, open `tmp-join.png`, check by eye:

- the preview tag reads **Ada** in the selected colour, cursor arrow matches it
- `joining room previewcheck1` renders above the heading in monospace
- selected swatch has the gap-and-glow ring; card sits over dot grid with glow

Then delete both temp files: `rm tmp-shot.mjs tmp-join.png`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/JoinGate.tsx apps/web/components/Workspace.tsx
git commit -m "feat(web): the join gate shows you how the room will see you

Picking an identity was abstract - a name field and eight coloured dots.
Now the form contains the artefact itself: the cursor and name tag
others will actually see, updating as you type and as you pick. The
Display name label and Join sandbox button are unchanged, so the e2e
join helper is none the wiser.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

No new code. The spec's testing section, executed.

- [ ] **Step 1: Unit suites**

Run: `pnpm test`
Expected: all green (159 at last count). Nothing in this redesign touches tested code, so any failure is environmental — investigate before blaming the diff.

- [ ] **Step 2: Full e2e, nothing skipped**

`pnpm db:up` and `pnpm piston:up` first if not already running, then:

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/postgres' pnpm test:e2e`
Expected: 27 passed, 0 skipped. The whole suite funnels through the redesigned join gate, so this is the real regression net.

- [ ] **Step 3: Reduced motion renders static and drawn**

Create `tmp-rm.mjs` at the repo root:

```js
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.goto('http://localhost:3000');
await page.waitForTimeout(800);
await page.screenshot({ path: 'tmp-reduced.png' });
await browser.close();
console.log('tmp-reduced.png written');
```

Run: `node tmp-rm.mjs`, open `tmp-reduced.png`, check by eye:

- every element visible at full opacity (no half-faded entrances stuck mid-animation)
- the amber underline **is drawn** under "Draw on it." — if it is missing, the
  `.draw-underline-path` override in `globals.css` regressed

Then delete both temp files: `rm tmp-rm.mjs tmp-reduced.png`.

- [ ] **Step 4: Working tree is clean**

Run: `git status --short`
Expected: empty — no stray screenshots or temp scripts left behind.

---

## Definition of done

- `pnpm typecheck`, `pnpm test`, and the full `pnpm test:e2e` (with `DATABASE_URL`, Piston up) all green, nothing skipped.
- The landing page and join gate match the approved mockups **by eye, in a real browser** — not inferred from passing tests.
- `prefers-reduced-motion` renders both pages fully static with the underline drawn.
- `git diff main --stat` touches exactly five files: `globals.css`, `HeroScene.tsx`, `page.tsx`, `JoinGate.tsx`, `Workspace.tsx` (plus the spec, plan, and `.gitignore` docs commits).
- No `package.json` changed anywhere.
