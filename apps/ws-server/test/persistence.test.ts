import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, getFileText, listFiles } from '@sandbox/shared';
import { MemoryRoomStore } from '../src/persistence/store';
import { createSandboxServer } from '../src/server';
import { resetRooms, roomCount } from '../src/sync/rooms';

let server: ReturnType<typeof createSandboxServer>;
let syncUrl: string;
const store = new MemoryRoomStore(); // one store across both connections, so eviction can reload from it
const open: WebsocketProvider[] = [];

beforeEach(async () => {
  // A short grace + debounce so the room flushes and evicts within the test.
  server = createSandboxServer({ roomStore: store, graceMs: 40, saveDebounceMs: 20 });
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
    disableBc: true,
  });
  open.push(provider);
  return { doc, provider };
};

const poll = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** True once the store holds a doc whose default file contains `needle`. */
const storedHas = async (roomId: string, needle: string): Promise<boolean> => {
  const bytes = await store.load(roomId);
  if (!bytes) return false;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return getFileText(doc, DEFAULT_FILE.id).toString().includes(needle);
};

test('an edit made by one client is restored for a later client after the room evicts', async () => {
  const roomId = `test-reload-${Date.now().toString(36)}`;

  const alice = connect(roomId);
  await poll(() => listFiles(alice.doc).length === 1);
  getFileText(alice.doc, DEFAULT_FILE.id).insert(0, 'SURVIVES\n');

  // Wait until the debounced save has reached the store, then drop the connection.
  await poll(() => storedHas(roomId, 'SURVIVES'));

  alice.provider.destroy();
  open.splice(open.indexOf(alice.provider), 1);
  await poll(() => roomCount() === 0); // flushed and evicted from memory

  const bob = connect(roomId); // cold room: the server must reload from the store
  await poll(() => getFileText(bob.doc, DEFAULT_FILE.id).toString().includes('SURVIVES'));
  expect(getFileText(bob.doc, DEFAULT_FILE.id).toString()).toContain('SURVIVES');
});
