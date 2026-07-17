import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import {
  DEFAULT_FILE,
  type Stroke,
  appendStroke,
  createFile,
  deleteFile,
  getFileText,
  getStrokes,
  listFiles,
  renameFile,
} from '@sandbox/shared';
import { createSandboxServer } from '../src/server';
import { resetRooms } from '../src/sync/rooms';

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

const stroke = (id: string, fileId: string): Stroke => ({
  id,
  fileId,
  authorId: 'u1',
  color: '#f97316',
  width: 3,
  shape: { kind: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
  createdAt: 1,
});

test('a file one person creates reaches the other, with its text', async () => {
  const alice = connect('mf-create');
  const bob = connect('mf-create');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  const id = createFile(alice.doc, 'utils.py', 'f-utils');
  getFileText(alice.doc, id).insert(0, 'def helper(): pass');

  await waitFor(() => listFiles(bob.doc).length === 2);
  expect(listFiles(bob.doc).map((f) => f.name)).toEqual(['main.py', 'utils.py']);
  await waitFor(() => getFileText(bob.doc, id).toString() === 'def helper(): pass');
});

test('two people creating at once both get their file — ids never collide', async () => {
  const alice = connect('mf-concurrent');
  const bob = connect('mf-concurrent');
  await waitFor(() => listFiles(alice.doc).length === 1 && listFiles(bob.doc).length === 1);

  // Real generated ids, as the web app passes — a literal here would make the claim vacuous.
  createFile(alice.doc, 'alice.py', randomUUID());
  createFile(bob.doc, 'bob.py', randomUUID());

  await waitFor(() => listFiles(alice.doc).length === 3 && listFiles(bob.doc).length === 3);
  expect(listFiles(bob.doc).map((f) => f.name).sort()).toEqual(['alice.py', 'bob.py', 'main.py']);
});

test('a concurrent rename to the same name converges, and the duplicate is cosmetic', async () => {
  const alice = connect('mf-dup');
  const bob = connect('mf-dup');
  await waitFor(() => listFiles(alice.doc).length === 1);

  const a = createFile(alice.doc, 'a.py', 'f-a');
  const b = createFile(alice.doc, 'b.py', 'f-b');
  getFileText(alice.doc, a).insert(0, 'I am A');
  getFileText(alice.doc, b).insert(0, 'I am B');
  await waitFor(() => listFiles(bob.doc).length === 3 && getFileText(bob.doc, b).toString() === 'I am B');

  // Both peers rename to the same name, each seeing it free. Neither is wrong, and a CRDT has
  // no coordinator to stop them.
  renameFile(alice.doc, a, 'utils.py');
  renameFile(bob.doc, b, 'utils.py');

  await waitFor(() => listFiles(bob.doc).filter((f) => f.name === 'utils.py').length === 2);
  await waitFor(() => listFiles(alice.doc).filter((f) => f.name === 'utils.py').length === 2);

  // The duplicate is a display collision only: distinct ids, distinct text, nothing lost. This
  // is why we never auto-rename to resolve one — that would be a write-back race.
  expect(getFileText(bob.doc, a).toString()).toBe('I am A');
  expect(getFileText(bob.doc, b).toString()).toBe('I am B');
});

test('deleting a file removes it and its strokes for everyone, and spares the others', async () => {
  const alice = connect('mf-delete');
  const bob = connect('mf-delete');
  await waitFor(() => listFiles(alice.doc).length === 1);

  const id = createFile(alice.doc, 'doomed.py', 'f-doomed');
  getFileText(alice.doc, id).insert(0, 'goodbye');
  appendStroke(alice.doc, stroke('s-doomed', id));
  appendStroke(alice.doc, stroke('s-main', DEFAULT_FILE.id));

  await waitFor(() => getStrokes(bob.doc).length === 2 && listFiles(bob.doc).length === 2);

  deleteFile(bob.doc, id);

  await waitFor(() => listFiles(alice.doc).length === 1);
  await waitFor(() => getStrokes(alice.doc).length === 1);
  expect(getStrokes(alice.doc).toArray()[0]!.id).toBe('s-main');
  expect(getFileText(alice.doc, id).toString()).toBe('');
});
