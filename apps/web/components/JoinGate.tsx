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
