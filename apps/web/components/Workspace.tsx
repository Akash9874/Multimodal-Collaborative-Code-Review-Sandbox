'use client';

import dynamic from 'next/dynamic';
import { ExecProvider } from '@/lib/exec/ExecContext';
import { RoomProvider } from '@/lib/yjs/RoomContext';
import { ConnectionPill } from './ConnectionPill';
import { JoinGate } from './JoinGate';
import { PresenceBar } from './PresenceBar';
import { RemoteCursorStyles } from './RemoteCursorStyles';
import { RunBar } from './RunBar';

// Monaco and xterm both touch `window` at module scope and cannot be server-rendered.
const CodeEditor = dynamic(() => import('./CodeEditor').then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-neutral-500">Loading editor…</div>
  ),
});

const Terminal = dynamic(() => import('./Terminal').then((m) => m.Terminal), {
  ssr: false,
  loading: () => <div className="h-full bg-neutral-950" />,
});

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <JoinGate>
      {(user) => (
        <RoomProvider roomId={roomId} user={user}>
          {(status) => (
            <ExecProvider roomId={roomId} user={user}>
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

                <main className="min-h-0 flex-1">
                  <CodeEditor />
                </main>

                <section className="h-64 shrink-0 border-t border-neutral-800 bg-neutral-950 p-2">
                  <Terminal />
                </section>
              </div>
            </ExecProvider>
          )}
        </RoomProvider>
      )}
    </JoinGate>
  );
}
