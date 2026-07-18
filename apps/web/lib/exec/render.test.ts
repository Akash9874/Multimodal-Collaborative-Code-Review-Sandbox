import { expect, test } from 'vitest';
import type { RunRecord } from '@sandbox/shared';
import { renderRuns } from './render';

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'r1',
  roomId: 'room',
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

/** Strip the ANSI colour codes: we assert on what the reader sees, not how it is painted. */
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

test('a run is attributed to the person who pressed Run', () => {
  expect(plain(renderRuns([run()], null))).toContain('Ada ran main.py');
});

test('stdin is echoed, so the output is intelligible to everyone else', () => {
  expect(plain(renderRuns([run({ stdin: '5' })], null))).toContain('stdin: 5');
});

test('the stdin clause is omitted when there is no stdin', () => {
  expect(plain(renderRuns([run()], null))).not.toContain('stdin:');
});

test('every newline is a CRLF — a bare LF staircases in xterm', () => {
  const rendered = renderRuns([run({ stdout: 'a\nb\n', exitCode: 0, durationMs: 5 })], null);

  expect(rendered).not.toMatch(/[^\r]\n/);
});

test('a clean exit is reported with its exit code and duration', () => {
  const rendered = plain(renderRuns([run({ stdout: '42\n', exitCode: 0, durationMs: 12 })], null));

  expect(rendered).toContain('42');
  expect(rendered).toContain('exited 0 in 12ms');
});

test('a failing exit is still reported, not hidden', () => {
  const rendered = plain(renderRuns([run({ stderr: 'boom', exitCode: 1, durationMs: 9 })], null));

  expect(rendered).toContain('boom');
  expect(rendered).toContain('exited 1 in 9ms');
});

test('an in-flight run says so, rather than looking finished', () => {
  expect(plain(renderRuns([run()], null))).toContain('running');
});

test('an executor error replaces the exit line', () => {
  const rendered = plain(renderRuns([run({ error: 'Piston is down.' })], null));

  expect(rendered).toContain('Piston is down.');
  expect(rendered).not.toContain('exited');
});

test('a notice is rendered even when nothing has run', () => {
  expect(plain(renderRuns([], 'One run every 2 seconds.'))).toContain('One run every 2 seconds.');
});

test('an empty terminal says how to run something, rather than nothing at all', () => {
  // An empty console that says nothing cannot be told from one that is still loading.
  const out = plain(renderRuns([], null));

  expect(out).toContain('No runs yet');
  expect(out).toContain('Ctrl/Cmd + Enter');
});

test('once something has run, the hint is gone', () => {
  expect(plain(renderRuns([run()], null))).not.toContain('No runs yet');
});

test('a notice replaces the hint rather than stacking with it', () => {
  const out = plain(renderRuns([], 'One run every 2 seconds.'));

  expect(out).toContain('One run every 2 seconds.');
  expect(out).not.toContain('No runs yet');
});
