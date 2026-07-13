'use client';

import { JoinGate } from './JoinGate';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
            <span className="font-semibold">Sandbox</span>
            <code data-testid="room-id" className="rounded bg-neutral-800 px-2 py-0.5 text-sm">
              {roomId}
            </code>
            <span className="ml-auto text-sm text-neutral-400">{user.name}</span>
          </header>
          <main className="min-h-0 flex-1" />
        </div>
      )}
    </JoinGate>
  );
}
