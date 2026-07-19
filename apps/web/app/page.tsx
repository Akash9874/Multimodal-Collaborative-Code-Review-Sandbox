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
