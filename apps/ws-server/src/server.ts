import { type Server, createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { isValidRoomId } from '@sandbox/shared';
import { setupSyncConnection } from './sync/connection';
import { getOrCreateRoom, roomCount } from './sync/rooms';

export const createSandboxServer = (): Server => {
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

    if (prefix !== 'sync' || !isValidRoomId(roomId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (conn) => {
      setupSyncConnection(conn, getOrCreateRoom(roomId));
    });
  });

  return http;
};
