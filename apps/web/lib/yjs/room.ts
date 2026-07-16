import type { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { SYNC_URL } from '@/lib/env';

export type RoomHandle = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
};

type Entry = { handle: RoomHandle; refs: number; teardown?: ReturnType<typeof setTimeout> };

/**
 * One handle per room id, cached outside React. StrictMode mounts every effect twice in
 * development; without this cache each mount would open its own socket and every user would
 * see a phantom duplicate of themselves in the presence bar.
 */
const entries = new Map<string, Entry>();

/** Long enough to survive StrictMode's unmount/remount, short enough to free a real leave. */
const TEARDOWN_DELAY_MS = 1_000;

export const acquireRoom = (roomId: string): RoomHandle => {
  const existing = entries.get(roomId);
  if (existing) {
    if (existing.teardown) {
      clearTimeout(existing.teardown);
      existing.teardown = undefined;
    }
    existing.refs += 1;
    return existing.handle;
  }

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(SYNC_URL, roomId, doc);
  const handle: RoomHandle = { doc, provider, awareness: provider.awareness };
  entries.set(roomId, { handle, refs: 1 });
  return handle;
};

export const releaseRoom = (roomId: string): void => {
  const entry = entries.get(roomId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.teardown = setTimeout(() => {
    const current = entries.get(roomId);
    if (!current || current.refs > 0) return;
    entries.delete(roomId);
    current.handle.provider.destroy();
    current.handle.doc.destroy();
  }, TEARDOWN_DELAY_MS);
};
