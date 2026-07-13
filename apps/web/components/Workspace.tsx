'use client';

import { ConnectionPill } from './ConnectionPill';
import { JoinGate } from './JoinGate';
import { PresenceBar } from './PresenceBar';
import { RoomProvider } from '@/lib/yjs/RoomContext';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
            <div className="flex h-full flex-col">
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
              <main className="min-h-0 flex-1" />
            </div>
          )}
        </RoomProvider>
      )}
    </JoinGate>
  );
}
