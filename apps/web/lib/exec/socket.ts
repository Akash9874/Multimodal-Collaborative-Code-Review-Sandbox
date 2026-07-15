import type { ExecMessage, RunRequest } from '@sandbox/shared';
import { EXEC_URL } from '@/lib/env';

export type ExecStatus = 'connecting' | 'connected' | 'disconnected';

const MAX_BACKOFF_MS = 10_000;

export class ExecSocket {
  private socket: WebSocket | null = null;
  private readonly onMessage = new Set<(message: ExecMessage) => void>();
  private readonly onStatusChange = new Set<(status: ExecStatus) => void>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private destroyed = false;

  status: ExecStatus = 'connecting';

  constructor(private readonly roomId: string) {
    this.connect();
  }

  private setStatus(next: ExecStatus): void {
    this.status = next;
    for (const listener of this.onStatusChange) listener(next);
  }

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');

    const socket = new WebSocket(`${EXEC_URL}/${this.roomId}`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ExecMessage;
        for (const listener of this.onMessage) listener(message);
      } catch {
        // The server only ever sends JSON. A frame we cannot read is not worth taking the app down.
      }
    };

    socket.onerror = () => socket.close();

    socket.onclose = () => {
      this.setStatus('disconnected');
      if (this.destroyed) return;

      const delay = Math.min(1_000 * 2 ** this.attempt++, MAX_BACKOFF_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  send(request: RunRequest): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(request));
  }

  subscribe(listener: (message: ExecMessage) => void): () => void {
    this.onMessage.add(listener);
    return () => this.onMessage.delete(listener);
  }

  watchStatus(listener: (status: ExecStatus) => void): () => void {
    this.onStatusChange.add(listener);
    return () => this.onStatusChange.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

type Entry = { socket: ExecSocket; refs: number; teardown?: ReturnType<typeof setTimeout> };

/**
 * One socket per room id, cached outside React — the same guard as lib/yjs/room.ts, for the same
 * reason. StrictMode double-invokes every effect in development; without this cache each mount
 * opens its own exec socket and every run is rendered twice.
 */
const entries = new Map<string, Entry>();

/** Long enough to survive StrictMode's unmount/remount, short enough to free a real leave. */
const TEARDOWN_DELAY_MS = 1_000;

export const acquireExec = (roomId: string): ExecSocket => {
  const existing = entries.get(roomId);
  if (existing) {
    if (existing.teardown) {
      clearTimeout(existing.teardown);
      existing.teardown = undefined;
    }
    existing.refs += 1;
    return existing.socket;
  }

  const socket = new ExecSocket(roomId);
  entries.set(roomId, { socket, refs: 1 });
  return socket;
};

export const releaseExec = (roomId: string): void => {
  const entry = entries.get(roomId);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  entry.teardown = setTimeout(() => {
    const current = entries.get(roomId);
    if (!current || current.refs > 0) return;
    entries.delete(roomId);
    current.socket.destroy();
  }, TEARDOWN_DELAY_MS);
};
