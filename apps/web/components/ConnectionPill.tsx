'use client';

import type { ConnectionStatus } from '@/lib/yjs/useRoom';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Offline',
};

const DOTS: Record<ConnectionStatus, string> = {
  connecting: 'bg-amber-400',
  connected: 'bg-emerald-400',
  disconnected: 'bg-rose-500',
};

export function ConnectionPill({ status }: { status: ConnectionStatus }) {
  return (
    <span
      data-testid="connection-pill"
      className="flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-300"
    >
      <span className={`h-2 w-2 rounded-full ${DOTS[status]}`} />
      {LABELS[status]}
    </span>
  );
}
