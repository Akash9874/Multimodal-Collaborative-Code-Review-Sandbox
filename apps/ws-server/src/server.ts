import { type Server, createServer } from 'node:http';
import { IP_RATE, ROOM_RATE, isValidRoomId } from '@sandbox/shared';
import { WebSocketServer } from 'ws';
import { env } from './env';
import { type ExecDeps, setupExecConnection } from './exec/connection';
import type { CodeExecutor } from './exec/executor';
import { TokenBuckets } from './exec/limiter';
import { PistonExecutor } from './exec/piston';
import { getOrCreateExecRoom } from './exec/rooms';
import { MemoryRunStore, type RunStore } from './exec/runs';
import { MemoryRoomStore, type RoomStore } from './persistence/store';
import { setupSyncConnection } from './sync/connection';
import { configureRooms, getOrCreateRoom, roomCount } from './sync/rooms';

/** The injection seam the integration tests need: a stub executor, a fake clock, a fresh store. */
export type SandboxServerOptions = {
  executor?: CodeExecutor;
  store?: RunStore;
  roomStore?: RoomStore;
  graceMs?: number;
  saveDebounceMs?: number;
  now?: () => number;
};

export const createSandboxServer = (options: SandboxServerOptions = {}): Server => {
  const now = options.now ?? Date.now;

  configureRooms({
    store: options.roomStore ?? new MemoryRoomStore(),
    graceMs: options.graceMs,
    saveDebounceMs: options.saveDebounceMs,
  });

  const deps: ExecDeps = {
    executor: options.executor ?? new PistonExecutor(env.pistonUrl),
    store: options.store ?? new MemoryRunStore(),
    roomLimiter: new TokenBuckets(ROOM_RATE, now),
    ipLimiter: new TokenBuckets(IP_RATE, now),
    now,
  };

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: roomCount() }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [prefix, roomId] = url.pathname.split('/').filter(Boolean);

    // An unvalidated room id lets anyone allocate unbounded server rooms.
    if ((prefix !== 'sync' && prefix !== 'exec') || !isValidRoomId(roomId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const ip = req.socket.remoteAddress ?? 'unknown';

    // Two sockets, on purpose. /sync is a pure relay that never parses document semantics;
    // /exec is the single execution authority.
    if (prefix === 'exec') {
      wss.handleUpgrade(req, socket, head, (conn) => {
        setupExecConnection(conn, getOrCreateExecRoom(roomId), ip, deps);
      });
      return;
    }

    // The room is resolved BEFORE the handshake, never inside the upgrade callback. A client
    // sends sync step 1 the instant the 101 response lands;;a handler attached after an awaited
    // load would miss it, and the client would then hold an empty document forever, waiting for a
    // reply to a message nobody heard. Awaiting out here means the socket is not open yet, so
    // there is no window to lose a message in. (With an in-memory store the load settles on the
    // microtask queue and the window is zero — which is why only a real database shows this.)
    void getOrCreateRoom(roomId).then(
      (room) => {
        if (socket.destroyed) return; // gave up while we were loading
        wss.handleUpgrade(req, socket, head, (conn) => setupSyncConnection(conn, room));
      },
      (error) => {
        console.error(`[sync] could not open room ${roomId}:`, error);
        socket.destroy();
      },
    );
  });

  return http;
};
