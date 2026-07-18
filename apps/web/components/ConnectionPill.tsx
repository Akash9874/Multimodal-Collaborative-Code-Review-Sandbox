'use client';

import { useRoomContext } from '@/lib/yjs/RoomContext';
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
  const { isOffline, setOffline, pendingUpdates } = useRoomContext();

  // A manual disconnect and a real one must not read the same, or a genuine outage mid-demo looks
  // like the toggle and the demo quietly lies. The pending count is what makes the merge visible
  // on reconnect: without a number, a successful merge looks like nothing happened.
  const label = isOffline
    ? pendingUpdates > 0
      ? `Offline (you) — ${pendingUpdates} local edit${pendingUpdates === 1 ? '' : 's'}`
      : 'Offline (you)'
    : LABELS[status];

  return (
    <button
      type="button"
      data-testid="connection-pill"
      data-offline={isOffline ? 'true' : undefined}
      onClick={() => setOffline(!isOffline)}
      title={isOffline ? 'Reconnect and merge' : 'Go offline — keep editing, merge on reconnect'}
      className="flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:border-neutral-600"
    >
      <span className={`h-2 w-2 rounded-full ${isOffline ? 'bg-amber-400' : DOTS[status]}`} />
      {label}
    </button>
  );
}
