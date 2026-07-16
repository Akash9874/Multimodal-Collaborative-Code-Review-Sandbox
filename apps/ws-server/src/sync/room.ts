import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { seedDoc } from '@sandbox/shared';
import { encodeAwarenessUpdate, encodeSyncUpdate } from './protocol';

export const send = (conn: WebSocket, message: Uint8Array): void => {
  if (conn.readyState !== WebSocket.OPEN) return;
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
};

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  /** connection → the awareness clientIDs it announced, so we can clear them when it closes */
  private readonly connections = new Map<WebSocket, Set<number>>();

  constructor(readonly id: string) {
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState(null); // the server is a relay, not a peer

    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  seed(): void {
    seedDoc(this.doc);
  }

  get size(): number {
    return this.connections.size;
  }

  addConnection(conn: WebSocket): void {
    this.connections.set(conn, new Set());
  }

  removeConnection(conn: WebSocket): void {
    const announced = this.connections.get(conn);
    this.connections.delete(conn);
    if (announced && announced.size > 0) {
      removeAwarenessStates(this.awareness, [...announced], null);
    }
  }

  broadcast(message: Uint8Array): void {
    for (const conn of this.connections.keys()) send(conn, message);
  }

  destroy(): void {
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
  }

  private onDocUpdate = (update: Uint8Array): void => {
    this.broadcast(encodeSyncUpdate(update));
  };

  private onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const { added, updated, removed } = changes;

    const announced = this.connections.get(origin as WebSocket);
    if (announced) {
      [...added, ...updated].forEach((id) => announced.add(id));
      removed.forEach((id) => announced.delete(id));
    }

    // Every connection, including the originator: y-websocket's client drops a socket after
    // 30s with no inbound message, and this echo is the heartbeat that prevents it.
    this.broadcast(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
  };
}
