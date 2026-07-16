import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, getFileText, listFiles } from '@sandbox/shared';
import { createSandboxServer } from '../src/server';
import { resetRooms, roomCount } from '../src/sync/rooms';

let server: ReturnType<typeof createSandboxServer>;
let syncUrl: string;
const open: WebsocketProvider[] = [];

beforeEach(async () => {
  server = createSandboxServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  syncUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/sync`;
});

afterEach(async () => {
  open.splice(0).forEach((provider) => provider.destroy());
  resetRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connect = (room: string) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(syncUrl, room, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Node has BroadcastChannel: leaving it on would sync the two docs *around* the server.
    disableBc: true,
  });
  open.push(provider);
  return { doc, provider };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

test('a new room is seeded with the default file', async () => {
  const alice = connect('room-seed-a');
  await waitFor(() => listFiles(alice.doc).length === 1);

  expect(listFiles(alice.doc)[0]?.name).toBe('main.py');
  expect(getFileText(alice.doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
});

test('two clients converge on concurrent edits', async () => {
  const alice = connect('room-converge-a');
  const bob = connect('room-converge-a');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  getFileText(alice.doc, DEFAULT_FILE.id).insert(0, 'ALICE\n');
  getFileText(bob.doc, DEFAULT_FILE.id).insert(0, 'BOB\n');

  await waitFor(() => {
    const a = getFileText(alice.doc, DEFAULT_FILE.id).toString();
    const b = getFileText(bob.doc, DEFAULT_FILE.id).toString();
    return a === b && a.includes('ALICE') && a.includes('BOB');
  });

  expect(getFileText(alice.doc, DEFAULT_FILE.id).toString()).toBe(
    getFileText(bob.doc, DEFAULT_FILE.id).toString(),
  );
});

test('awareness propagates from one client to another', async () => {
  const alice = connect('room-aware-a');
  const bob = connect('room-aware-a');
  await waitFor(() => alice.provider.wsconnected && bob.provider.wsconnected);

  alice.provider.awareness.setLocalStateField('user', {
    id: 'u1',
    name: 'Ada',
    color: '#f97316',
  });

  await waitFor(() =>
    [...bob.provider.awareness.getStates().values()].some(
      (state) => (state as { user?: { name: string } }).user?.name === 'Ada',
    ),
  );
});

test('a room stays in the registry while a client is connected', async () => {
  const alice = connect('room-evict-a');
  await waitFor(() => alice.provider.wsconnected);

  expect(roomCount()).toBe(1);
});
