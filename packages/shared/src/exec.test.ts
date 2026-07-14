import { expect, test } from 'vitest';
import { LANGUAGES, type LanguageId } from './model.js';
import {
  MAX_OUTPUT_BYTES,
  PISTON_RUNTIMES,
  TRUNCATION_NOTICE,
  byteLength,
  truncateOutput,
} from './exec.js';

test('byteLength counts bytes, not UTF-16 code units', () => {
  expect(byteLength('abc')).toBe(3);
  // The size caps are a security boundary; a 4-byte emoji must not count as 2.
  expect(byteLength('😀')).toBe(4);
});

test('truncateOutput leaves output under the limit untouched', () => {
  expect(truncateOutput('hello', 10)).toBe('hello');
});

test('truncateOutput marks what it cut, rather than silently dropping it', () => {
  const truncated = truncateOutput('x'.repeat(20), 10);

  expect(truncated).toBe('x'.repeat(10) + TRUNCATION_NOTICE);
  expect(truncated).toContain('truncated');
});

test('truncateOutput defaults to MAX_OUTPUT_BYTES', () => {
  expect(truncateOutput('x'.repeat(MAX_OUTPUT_BYTES + 1))).toContain(TRUNCATION_NOTICE);
});

test('every language we offer has a pinned Piston runtime', () => {
  for (const id of Object.keys(LANGUAGES) as LanguageId[]) {
    // Piston lists two TypeScript runtimes (Node and Deno). An unpinned version is ambiguous.
    expect(PISTON_RUNTIMES[id].version).toMatch(/^\d+\.\d+\.\d+$/);
  }
});
