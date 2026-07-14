import { expect, test } from 'vitest';
import { RUN_HISTORY_LIMIT, RUN_STORE_MAX_ROOMS, type RunRecord } from '@sandbox/shared';
import { MemoryRunStore } from './runs';

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room-a',
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  stdout: '',
  stderr: '',
  exitCode: null,
  durationMs: null,
  createdAt: 0,
  ...over,
});

test('a run round-trips through the store', () => {
  const store = new MemoryRunStore();
  store.append(record());

  expect(store.list('room-a')).toEqual([record()]);
});

test('rooms are isolated from each other', () => {
  const store = new MemoryRunStore();
  store.append(record({ id: 'r1', roomId: 'room-a' }));
  store.append(record({ id: 'r2', roomId: 'room-b' }));

  expect(store.list('room-a').map((run) => run.id)).toEqual(['r1']);
  expect(store.list('room-b').map((run) => run.id)).toEqual(['r2']);
});

test('an unknown room has no runs, rather than throwing', () => {
  expect(new MemoryRunStore().list('never-seen')).toEqual([]);
});

test('update patches a run in place', () => {
  const store = new MemoryRunStore();
  store.append(record({ id: 'r1' }));

  store.update('room-a', 'r1', { stdout: '42\n', exitCode: 0, durationMs: 120 });

  expect(store.list('room-a')[0]).toMatchObject({ stdout: '42\n', exitCode: 0, durationMs: 120 });
});

test('update ignores a run it does not have', () => {
  const store = new MemoryRunStore();

  expect(() => store.update('room-a', 'ghost', { exitCode: 0 })).not.toThrow();
});

test('the oldest runs fall out of the ring buffer', () => {
  const store = new MemoryRunStore();
  for (let i = 0; i < RUN_HISTORY_LIMIT + 5; i++) {
    store.append(record({ id: `r${i}`, createdAt: i }));
  }

  const runs = store.list('room-a');
  expect(runs).toHaveLength(RUN_HISTORY_LIMIT);
  expect(runs[0]?.id).toBe('r5'); // r0–r4 were evicted
});

test('the least recently used room falls out, so the store cannot grow forever', () => {
  const store = new MemoryRunStore();
  for (let i = 0; i < RUN_STORE_MAX_ROOMS + 1; i++) {
    store.append(record({ id: `r${i}`, roomId: `room-${i}` }));
  }

  expect(store.list('room-0')).toEqual([]); // evicted
  expect(store.list(`room-${RUN_STORE_MAX_ROOMS}`)).toHaveLength(1);
});
