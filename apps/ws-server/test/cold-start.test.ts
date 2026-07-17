import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, getFileText, seedDoc } from '@sandbox/shared';
import { MemoryRoomStore, type RoomStore } from '../src/persistence/store';
import { createSandboxServer } from '../src/server';
import { resetRooms } from '../src/sync/rooms';

/**
 * A store whose load spans real I/O, the way a database does.
 *
 * This is the whole point of the file. `MemoryRoomStore.load` is async but never yields to the
 * event loop — its promise settles on the microtask queue, which drains before Node can deliver a
 * single socket message. Any race between "the client is talking" and "the server is still
 * loading" is therefore invisible to a memory-backed test, and shows up only against Postgres.
 */
class SlowRoomStore implements RoomStore {
  constructor(
    private readonly inner: RoomStore,
    private readonly delayMs: number,
  ) {}

  async load(roomId: string): Promise<Uint8Array | null> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.inner.load(roomId);
  }

  save(roomId: string, state: Uint8Array): Promise<void> {
    return this.inner.save(roomId, state);
  }

  deleteStale(olderThanMs: number): Promise<number> {
    return this.inner.deleteStale(olderThanMs);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

let server: ReturnType<typeof createSandboxServer>;
let syncUrl: string;
let store: MemoryRoomStore;
const open: WebsocketProvider[] = [];

beforeEach(async () => {
  store = new MemoryRoomStore();
  server = createSandboxServer({ roomStore: new SlowRoomStore(store, 50) });
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

const poll = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

test('a client gets the stored doc even though the room load is slow', async () => {
  // A room that already exists in the store, so connecting to it takes the slow load path.
  const source = new Y.Doc();
  seedDoc(source);
  getFileText(source, DEFAULT_FILE.id).insert(0, 'FROM THE STORE\n');
  await store.save('r-cold', Y.encodeStateAsUpdate(source));

  const client = connect('r-cold');

  // The client sends sync step 1 the moment the handshake completes. If the server only attaches
  // its message handler after awaiting the load, that message lands in the gap and is dropped —
  // the client then waits forever for a reply that will never come, holding an empty document.
  await poll(() => getFileText(client.doc, DEFAULT_FILE.id).toString().includes('FROM THE STORE'));
  expect(getFileText(client.doc, DEFAULT_FILE.id).toString()).toContain('FROM THE STORE');
});

test('a client gets the seed even though a brand-new room is slow to create', async () => {
  const client = connect('r-cold-new');

  await poll(() => getFileText(client.doc, DEFAULT_FILE.id).toString().includes('fizzbuzz'));
  expect(getFileText(client.doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
});
