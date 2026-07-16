import { expect, test } from 'vitest';
import { freehandPath } from './freehand';

test('a multi-point path produces a non-empty SVG path string', () => {
  const d = freehandPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], 3);

  expect(d.startsWith('M')).toBe(true);
  expect(d).toContain('Z');
});

test('an empty path produces an empty string, not a crash', () => {
  expect(freehandPath([], 3)).toBe('');
});
