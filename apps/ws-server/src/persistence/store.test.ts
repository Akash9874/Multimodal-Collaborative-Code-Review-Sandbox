import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE, appendStroke, getFileText, getStrokes, seedDoc } from '@sandbox/shared';
import { MemoryRoomStore } from './store';

test('save then load returns the same bytes; a missing room is null', async () => {
  const store = new MemoryRoomStore();
  expect(await store.load('nope')).toBeNull();

  const bytes = new Uint8Array([1, 2, 3, 4]);
  await store.save('r1', bytes);
  expect(await store.load('r1')).toEqual(bytes);
});

test('a Y.Doc survives an encode → save → load → apply round-trip, strokes and all', async () => {
  const store = new MemoryRoomStore();

  const source = new Y.Doc();
  seedDoc(source);
  getFileText(source, DEFAULT_FILE.id).insert(0, 'PERSIST ME\n');
  appendStroke(source, {
    id: 's1',
    fileId: DEFAULT_FILE.id,
    authorId: 'ada',
    color: '#f97316',
    width: 3,
    shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    createdAt: 0,
  });

  await store.save('r1', Y.encodeStateAsUpdate(source));

  const restored = new Y.Doc();
  Y.applyUpdate(restored, (await store.load('r1'))!);

  expect(getFileText(restored, DEFAULT_FILE.id).toString()).toContain('PERSIST ME');
  expect(getStrokes(restored).toArray().map((s) => s.id)).toEqual(['s1']);
});

test('deleteStale removes only rooms older than the cutoff', async () => {
  let clock = 10_000;
  const store = new MemoryRoomStore(() => clock);

  await store.save('old', new Uint8Array([1])); // saved at t=10_000
  clock = 20_000;
  await store.save('new', new Uint8Array([2])); // saved at t=20_000

  clock = 25_000;
  const removed = await store.deleteStale(10_000); // cutoff = 15_000; 'old' is stale
  expect(removed).toBe(1);
  expect(await store.load('old')).toBeNull();
  expect(await store.load('new')).not.toBeNull();
});
