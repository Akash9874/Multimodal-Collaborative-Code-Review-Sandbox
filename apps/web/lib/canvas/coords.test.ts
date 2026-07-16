import { expect, test } from 'vitest';
import { toContentPoint } from './coords';

test('a click maps to content space by subtracting the rect and adding the scroll', () => {
  // Editor top-left at (100, 50) on screen, scrolled 200px down and 10px right.
  const rect = { left: 100, top: 50 };
  const scroll = { left: 10, top: 200 };

  // A click at screen (150, 90) is 50px right and 40px down inside the editor, plus the scroll.
  expect(toContentPoint(150, 90, rect, scroll)).toEqual({ x: 60, y: 240 });
});

test('the same screen click at two scroll positions yields two different content points', () => {
  const rect = { left: 0, top: 0 };

  const top = toContentPoint(20, 20, rect, { left: 0, top: 0 });
  const scrolled = toContentPoint(20, 20, rect, { left: 0, top: 500 });

  // This is the whole point: content space moves with the scroll, screen space does not.
  expect(top.y).toBe(20);
  expect(scrolled.y).toBe(520);
});
