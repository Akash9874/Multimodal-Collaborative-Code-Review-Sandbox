import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { DEFAULT_FILE, createAnchor, getFileText, resolveAnchor } from '@sandbox/shared';
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

/** 1-based line number of a character offset, read from the text itself. */
const lineOf = (doc: Y.Doc, index: number) =>
  getFileText(doc, DEFAULT_FILE.id).toString().slice(0, index).split('\n').length;

const seeded = (doc: Y.Doc) => getFileText(doc, DEFAULT_FILE.id).length > 0;

test('an anchor made by one client resolves to the same line on the other', async () => {
  const alice = connect('anchor-basic');
  const bob = connect('anchor-basic');
  await waitFor(() => seeded(alice.doc) && seeded(bob.doc));

  const text = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = text.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(text, index, 4);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  const onAlice = resolveAnchor(alice.doc, anchor);
  const onBob = resolveAnchor(bob.doc, anchor);

  expect(onBob).toEqual(onAlice);
  expect(onBob.kind).toBe('anchored');
  if (onBob.kind !== 'anchored') throw new Error('unreachable');
  expect(lineOf(bob.doc, onBob.index)).toBe(lineOf(alice.doc, index));
});

test('ten lines inserted above by the other client move the anchor down ten lines', async () => {
  const alice = connect('anchor-insert');
  const bob = connect('anchor-insert');
  await waitFor(() => seeded(alice.doc) && seeded(bob.doc));

  const aliceText = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = aliceText.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(aliceText, index, 0);
  const lineBefore = lineOf(alice.doc, index);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  // Bob edits; Alice never touches the anchor again. That is the whole no-write-back claim.
  getFileText(bob.doc, DEFAULT_FILE.id).insert(0, '# padding\n'.repeat(10));

  await waitFor(() => {
    const here = resolveAnchor(alice.doc, anchor);
    return here.kind === 'anchored' && lineOf(alice.doc, here.index) === lineBefore + 10;
  });

  expect(resolveAnchor(alice.doc, anchor)).toEqual(resolveAnchor(bob.doc, anchor));
});

test('when one client deletes the anchored text, both call it orphaned', async () => {
  const alice = connect('anchor-orphan');
  const bob = connect('anchor-orphan');
  await waitFor(() => seeded(alice.doc) && seeded(bob.doc));

  const text = getFileText(alice.doc, DEFAULT_FILE.id);
  const index = text.toString().indexOf('def fizzbuzz');
  const anchor = createAnchor(text, index, 0);

  await waitFor(() => resolveAnchor(bob.doc, anchor).kind === 'anchored');

  getFileText(bob.doc, DEFAULT_FILE.id).delete(index, 'def fizzbuzz'.length);

  await waitFor(() => resolveAnchor(alice.doc, anchor).kind === 'orphaned');
  expect(resolveAnchor(bob.doc, anchor).kind).toBe('orphaned');
});
