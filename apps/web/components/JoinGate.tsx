'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { MAX_NAME_LENGTH, type User, sanitizeName } from '@sandbox/shared';
import { USER_COLORS, loadIdentity, randomColor, saveIdentity } from '@/lib/identity';

export function JoinGate({ children }: { children: (user: User) => ReactNode }) {
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
    <div className="grid h-full place-items-center p-8">
      <form
        onSubmit={join}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h2 className="text-lg font-semibold">Join the sandbox</h2>

        <label htmlFor="name" className="mt-4 block text-sm text-neutral-400">
          Display name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoFocus
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2"
        />

        <fieldset className="mt-4">
          <legend className="text-sm text-neutral-400">Cursor colour</legend>
          <div className="mt-2 flex gap-2">
            {USER_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Choose ${option}`}
                aria-pressed={option === color}
                onClick={() => setColor(option)}
                style={{ backgroundColor: option }}
                className={`h-7 w-7 rounded-full ${
                  option === color ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900' : ''
                }`}
              />
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!sanitizeName(name)}
          className="mt-6 w-full rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
        >
          Join sandbox
        </button>
      </form>
    </div>
  );
}
