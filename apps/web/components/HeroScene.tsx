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
