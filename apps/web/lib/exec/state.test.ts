import { expect, test } from 'vitest';
import type { ExecMessage, RunRecord } from '@sandbox/shared';
import { EMPTY_EXEC_STATE, applyExecMessage } from './state';

const ADA = { id: 'u1', name: 'Ada', color: '#f97316' };

const started = (runId: string, at = 0): ExecMessage => ({
  type: 'run:started',
  runId,
  byUser: ADA,
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  at,
});

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room',
  byUser: ADA,
  fileName: 'main.py',
  language: 'python',
  stdin: '',
  stdout: '42\n',
  stderr: '',
  exitCode: 0,
  durationMs: 12,
  createdAt: 0,
  ...over,
});

const reduce = (messages: ExecMessage[]) =>
  messages.reduce(applyExecMessage, EMPTY_EXEC_STATE);

test('a run accumulates from started, through output, to done', () => {
  const state = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: '42\n' },
    { type: 'run:done', runId: 'r1', exitCode: 0, durationMs: 12 },
  ]);

  expect(state.runs).toHaveLength(1);
  expect(state.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0, durationMs: 12 });
});

test('stdout and stderr accumulate independently', () => {
  const state = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: 'out' },
    { type: 'run:output', runId: 'r1', stream: 'stderr', chunk: 'err' },
  ]);

  expect(state.runs[0]).toMatchObject({ stdout: 'out', stderr: 'err' });
});

test('history replayed after a reconnect does not duplicate the scrollback', () => {
  // The server re-sends run:history on every connect. An append-only list would render twice.
  const live = reduce([
    started('r1'),
    { type: 'run:output', runId: 'r1', stream: 'stdout', chunk: '42\n' },
    { type: 'run:done', runId: 'r1', exitCode: 0, durationMs: 12 },
  ]);

  const reconnected = applyExecMessage(live, { type: 'run:history', runs: [record({ id: 'r1' })] });

  expect(reconnected.runs).toHaveLength(1);
  expect(reconnected.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0 });
});

test('a run we half-saw before dropping is completed by the replayed history', () => {
  // We saw the header, then the socket died mid-run. The server's copy is the authoritative one.
  const partial = reduce([started('r1')]);

  const reconnected = applyExecMessage(partial, {
    type: 'run:history',
    runs: [record({ id: 'r1', stdout: '42\n', exitCode: 0 })],
  });

  expect(reconnected.runs[0]).toMatchObject({ stdout: '42\n', exitCode: 0 });
});

test('an error on a known run attaches to that run', () => {
  const state = reduce([started('r1'), { type: 'run:error', runId: 'r1', message: 'Piston is down.' }]);

  expect(state.runs[0]?.error).toBe('Piston is down.');
  expect(state.notice).toBeNull();
});

test('an error on a run we never saw start is a notice, not a phantom run', () => {
  // A rate-limit rejection: no run:started was ever broadcast, because no run ever started.
  const state = reduce([{ type: 'run:error', runId: 'ghost', message: 'One run every 2 seconds.' }]);

  expect(state.runs).toEqual([]);
  expect(state.notice).toBe('One run every 2 seconds.');
});

test('starting a run clears the last notice', () => {
  const state = reduce([
    { type: 'run:error', runId: 'ghost', message: 'One run every 2 seconds.' },
    started('r1'),
  ]);

  expect(state.notice).toBeNull();
});

test('runs stay ordered by start time', () => {
  const state = reduce([started('r2', 200), started('r1', 100)]);

  expect(state.runs.map((run) => run.id)).toEqual(['r1', 'r2']);
});
