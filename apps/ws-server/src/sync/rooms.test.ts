import { afterEach, expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE, getFileText } from '@sandbox/shared';
import { MemoryRoomStore } from '../persistence/store';
import { configureRooms, getOrCreateRoom, releaseRoom, resetRooms, roomCount } from './rooms';

afterEach(() => resetRooms());

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a brand-new room is seeded and the seed is persisted immediately', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store });

  const room = await getOrCreateRoom('r-seed');

  expect(getFileText(room.doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
  // The seed was saved on create, so a row exists before any edit.
  expect(await store.load('r-seed')).not.toBeNull();
});

test('an edit is debounce-saved to the store', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store, saveDebounceMs: 20 });

  const room = await getOrCreateRoom('r-edit');
  getFileText(room.doc, DEFAULT_FILE.id).insert(0, 'HELLO\n');

  await settle(60);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, (await store.load('r-edit'))!);
  expect(getFileText(restored, DEFAULT_FILE.id).toString()).toContain('HELLO');
});

test('concurrent first-connections share one load-and-seed', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store });

  const [a, b] = await Promise.all([getOrCreateRoom('r-race'), getOrCreateRoom('r-race')]);

  expect(a).toBe(b); // the same Room instance, not two
  expect(roomCount()).toBe(1);
});

test('an edit survives eviction and is reloaded from the store', async () => {
  const store = new MemoryRoomStore();
  configureRooms({ store, saveDebounceMs: 20, graceMs: 20 });

  const first = await getOrCreateRoom('r-reload');
  getFileText(first.doc, DEFAULT_FILE.id).insert(0, 'REMEMBER\n');
  await settle(60); // let the debounced save land

  releaseRoom(first); // no connections → flush + schedule eviction
  await settle(60); // let the grace eviction run
  expect(roomCount()).toBe(0);

  const second = await getOrCreateRoom('r-reload'); // cold: must reload from the store
  expect(getFileText(second.doc, DEFAULT_FILE.id).toString()).toContain('REMEMBER');
});
