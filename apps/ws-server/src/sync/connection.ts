import type { RawData, WebSocket } from 'ws';
import { encodeAwarenessUpdate, encodeSyncStep1, handleMessage } from './protocol';
import { send, type Room } from './room';
import { releaseRoom } from './rooms';

const PING_INTERVAL_MS = 20_000;

export const setupSyncConnection = (conn: WebSocket, room: Room): void => {
  room.addConnection(conn);

  let alive = true;
  conn.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      conn.terminate();
      return;
    }
    alive = false;
    conn.ping();
  }, PING_INTERVAL_MS);

  conn.on('message', (data: RawData) => {
    try {
      // Copy element-wise. `data` is a pooled Buffer: reading its .buffer would hand us the
      // whole shared pool rather than this message.
      const message = new Uint8Array(data as Buffer);
      const { reply } = handleMessage(message, room.doc, room.awareness, conn);
      if (reply) send(conn, reply);
    } catch (error) {
      console.error(`[sync] bad message in room ${room.id}:`, error);
      conn.close(1003, 'protocol error');
    }
  });

  const teardown = (): void => {
    clearInterval(heartbeat);
    room.removeConnection(conn);
    releaseRoom(room);
  };
  conn.on('close', teardown);
  conn.on('error', teardown);

  send(conn, encodeSyncStep1(room.doc));
  const known = [...room.awareness.getStates().keys()];
  if (known.length > 0) send(conn, encodeAwarenessUpdate(room.awareness, known));
};
