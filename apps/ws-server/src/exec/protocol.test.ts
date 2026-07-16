import { expect, test } from 'vitest';
import { MAX_CODE_BYTES, MAX_STDIN_BYTES } from '@sandbox/shared';
import { parseRunRequest } from './protocol';

const valid = {
  type: 'run',
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python',
  code: 'print(1)',
  stdin: '',
};

const parse = (over: Record<string, unknown> = {}) =>
  parseRunRequest(JSON.stringify({ ...valid, ...over }));

test('a well-formed run request parses', () => {
  expect(parse()).toMatchObject({ type: 'run', language: 'python', code: 'print(1)' });
});

test('a hostile display name is sanitized, not trusted', () => {
  // The name reaches every other client. The boundary is the only place that can vouch for it:
  // the server is the one participant every client has to trust.
  const parsed = parse({
    byUser: { id: 'u1', name: "Bob'; } body { display: none } /*", color: '#f97316' },
  });

  expect(parsed.byUser.name).not.toMatch(/['{}();*/\\]/);
});

test('a colour that is not a hex colour is refused', () => {
  expect(() => parse({ byUser: { id: 'u1', name: 'Ada', color: 'red; } body {}' } })).toThrow();
});

test('an unknown language is refused before we ever call Piston', () => {
  expect(() => parse({ language: 'brainfuck' })).toThrow();
});

test('oversized code is refused', () => {
  expect(() => parse({ code: 'x'.repeat(MAX_CODE_BYTES + 1) })).toThrow(/code/i);
});

test('oversized stdin is refused', () => {
  expect(() => parse({ stdin: 'x'.repeat(MAX_STDIN_BYTES + 1) })).toThrow(/stdin/i);
});

test('a size cap counts bytes, so multibyte characters cannot smuggle past it', () => {
  // Every emoji is 4 bytes but only 2 UTF-16 code units: a .length check would let this through
  // at nearly double the cap.
  const code = '😀'.repeat(MAX_CODE_BYTES / 4 + 1);

  expect(code.length).toBeLessThan(MAX_CODE_BYTES);
  expect(() => parse({ code })).toThrow(/code/i);
});

test('a missing field is refused rather than defaulted', () => {
  expect(() => parseRunRequest(JSON.stringify({ type: 'run' }))).toThrow();
});

test('a message that is not JSON is refused rather than coerced', () => {
  expect(() => parseRunRequest('not json')).toThrow();
});
