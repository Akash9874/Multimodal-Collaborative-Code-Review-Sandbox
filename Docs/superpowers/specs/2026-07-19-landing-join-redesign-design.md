# Landing and join redesign — Design

Date: 2026-07-19
Status: Approved
Builds on: Phases 1–5, all complete and merged.

## 1. Purpose

The product got five phases of engineering and none of design. The landing page is a title, one
sentence, and a button on a black void; the join form is an unstyled card. Nothing moves anywhere.
For an app whose entire pitch is *things happening live*, the first impression is static silence.

This redesign covers the two first-impression surfaces — the landing page and the join gate — and
deliberately nothing else. The direction, chosen from three animated mockups: **the product is the
hero**. A fake editor demos the app by itself, so the page shows what the product does before a
word is read.

## 2. What ships, and what does not

**Ships:**

- **A rebuilt landing page**: top bar, split hero (copy left, ambient editor scene right), and a
  three-item feature row. One viewport, no scrolling.
- **An ambient editor scene** — the centrepiece. A fake editor window showing the app's real
  default file, with two named remote cursors drifting on loops and an annotation that draws
  itself over the function, holds, and fades.
- **A restyled join gate** with a live identity preview: the cursor-plus-name-tag that others will
  see, updating as you type and as you pick a colour.
- **A small motion system** in `globals.css`: shared keyframes and the dot-grid/glow ambience used
  by both pages.

**Explicitly out of scope:**

- **The workspace.** Header, tabs, run bar, toolbar, terminal, Monaco, canvas — untouched.
- **A story loop.** The scene is ambient (presence, drawing, caret), not a choreographed
  edit→draw→insert→follow narrative. Considered and declined in brainstorming: simpler wins.
- **Any new dependency.** No framer-motion, no highlight library. All motion is CSS; the scene's
  syntax colouring is hand-written spans.
- **A light theme.** The app is dark; the landing follows it.

## 3. The landing page

### 3.1 Structure

```text
nav      wordmark ("▞ Sandbox")                              GitHub ↗
hero     copy (46fr)                          editor scene (54fr)
           pill: ● no accounts — a room is just a URL
           h1:   Code together. / Draw on it.
           sub:  A multiplayer sandbox where annotations stick
                 to the code they describe …
           CTA:  Create a sandbox →        ghost: How it works
           hint: $ share the link — that's the whole setup
features  Live cursors | Drawings that follow code | One shared Run
```

The page keeps `data-testid="create-room"` on the CTA and the same `router.push` to a fresh
`nanoid(ROOM_ID_LENGTH)` room — `smoke.spec.ts` must not notice the redesign. "How it works" and
"GitHub ↗" link to the repository.

"Draw on it." carries a hand-drawn amber underline (an SVG path) that draws itself on load via
`stroke-dashoffset`. It is the page's one playful stroke, borrowed from the canvas identity.

### 3.2 The ambient scene

A `HeroScene` client component, pure presentation, no props:

- **Window chrome**: traffic lights, a `main.py` tab, and two presence avatars (A, B) echoing the
  real app's presence bar.
- **Code**: the real `DEFAULT_FILE_CONTENT` fizzbuzz, syntax-coloured by hand-written spans.
  Using the actual seeded file is the point — the scene is a truthful screenshot of the product,
  not lorem ipsum. A caret blinks mid-file.
- **Cursors**: Ada (`#f472b6`) and Bob (`#34d399`) — colours from the app's real `USER_COLORS` —
  drift on slow `transform` loops (13s and 16s, so their phases never visibly repeat together).
- **Annotation**: a pink rounded rect over the `def fizzbuzz` block, on a 9s cycle: draws on via
  `clip-path: inset()`, holds, fades. It quietly demonstrates the anchoring feature without
  narrating it.

The scene is decorative: `aria-hidden="true"`, and every animated element is `pointer-events: none`.

### 3.3 Motion rules

- **Load, once**: copy elements stagger fade-up (delays 0.05–0.41s), the editor window fades and
  scales in (0.9s, `cubic-bezier(0.22, 1, 0.36, 1)`), feature cards trail last (0.5–0.66s).
- **Ambient, looping**: cursor drifts, the 9s annotation cycle, caret blink, pill-dot breathing.
  Slow, few, and only `transform`/`opacity`/`clip-path` — compositor-friendly properties, no
  layout shift.
- **`prefers-reduced-motion: reduce`**: every animation and transition is disabled globally. The
  page is fully legible static; the underline renders already-drawn.

### 3.4 Ambience

The page background is a subtle dot grid (`radial-gradient` circles at 26px spacing) with a soft
indigo glow behind the editor and a faint pink one lower-left. These become small utilities in
`globals.css` because the join page uses the same treatment — the two surfaces must feel like one
product.

## 4. The join gate

The gate's job is picking an identity, so the redesign makes identity visible:

- **Live preview**: a dashed panel containing the exact artefact others will see in the room — a
  cursor arrow with a name tag, floating on a gentle 3.2s bob. Typing updates the tag text
  (placeholder: `your name`); picking a swatch recolours arrow and tag. The preview reuses the
  visual language of `RemoteCursorStyles` without importing editor code.
- **Context line**: `joining room <code>{roomId}</code>` in monospace above the heading.
  `JoinGate` gains an **optional `roomId` prop**; `Workspace` passes it. Additive — no other
  consumer changes.
- **Card**: glass treatment (translucent `neutral-900`, `backdrop-blur`, hairline border, deep
  shadow), entering with a fade-up-and-scale, over the same dot-grid-and-glow page ambience as
  the landing.
- **Swatches**: 32px, hover lift, selected state ringed by a gap-and-glow (`box-shadow` rings in
  the swatch's own colour). Colour list unchanged from `USER_COLORS`.
- **Button**: the landing CTA style. Disabled state keeps today's opacity behaviour.

**Heading changes** from "Join the sandbox" to "Pick how you'll appear" — the truthful description
of what the form does. The `Display name` label and the `Join sandbox` button text are **frozen**:
the e2e `join` helper selects both, and the redesign must be invisible to it.

## 5. Implementation shape

```text
apps/web/app/page.tsx                 MOD  rebuilt landing (nav, hero, features)
apps/web/components/HeroScene.tsx     NEW  the ambient editor window, pure presentation
apps/web/components/JoinGate.tsx      MOD  restyled; live preview; optional roomId prop
apps/web/components/Workspace.tsx     MOD  one line: <JoinGate roomId={roomId}>
apps/web/app/globals.css              MOD  keyframes + dot-grid/glow utilities
```

Notes that keep this honest:

- **Zero new dependencies.** Checked against the constraint that bit Phase 5's deploy: nothing
  new to install anywhere.
- **Hydration-safe.** No randomness, no `Date.now()`, no `window` reads at render. Every
  animation parameter is a literal, so server and client markup agree.
- **Tailwind for layout, CSS for motion.** Keyframes and the few genuinely custom treatments
  (dot grid, glows, underline draw) live in `globals.css`; everything else stays utility classes
  in-line with the codebase's idiom.
- **The scene is spans, not a highlighter.** Thirteen lines of fizzbuzz coloured by hand once.
  If `DEFAULT_FILE_CONTENT` ever changes, the scene is one component to update, and a comment in
  `HeroScene` says so.

## 6. Testing

- `pnpm test:e2e smoke` — the landing mints a room exactly as before (`create-room` test id).
- The `join` helper path — `Display name` label, `Join sandbox` button — used by every e2e spec,
  keeps passing unmodified.
- `pnpm typecheck && pnpm test && pnpm test:e2e` — full gates, with `DATABASE_URL` set and Piston
  up so nothing is skipped.
- **Visual verification in a real browser**: both pages driven and screenshotted, checked by eye —
  load animations fire once, loops are smooth, reduced-motion renders static (emulated via
  Playwright's `reducedMotion: 'reduce'`).

## 7. Risks

- **`backdrop-filter` cost.** One blurred card on one page; trivial. If it ever shows up in a
  profile, the fallback is a solid `neutral-900` — the design survives without the glass.
- **Animation jank on weak machines.** Mitigated by construction: few loops, slow, and only
  compositor properties. No JS drives any frame.
- **Copy drift.** The scene hand-copies `DEFAULT_FILE_CONTENT`. Accepted for a marketing surface;
  the comment in `HeroScene` points at the source of truth.
- **CLS.** Load animations translate and fade; nothing resizes or reflows, so Lighthouse sees no
  layout shift.
