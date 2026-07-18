import { expect, test } from 'vitest';
import { lineAtContentY, topmostPoint } from './anchorLine';

/** Uniform 19px lines, as Monaco reports them for a default editor. */
const uniform = (line: number) => (line - 1) * 19;

/**
 * Line 3 wraps to double height, so lines below it are pushed down. This is the case the
 * `y / lineHeight` shortcut gets wrong, which is why the implementation binary-searches.
 */
const wrapped = (line: number) => [0, 19, 38, 76, 95][line - 1]!;

test('the top of a line maps to that line', () => {
  expect(lineAtContentY(0, 5, uniform)).toBe(1);
  expect(lineAtContentY(19, 5, uniform)).toBe(2);
  expect(lineAtContentY(76, 5, uniform)).toBe(5);
});

test('a y inside a line maps to that line, not the next', () => {
  expect(lineAtContentY(18, 5, uniform)).toBe(1);
  expect(lineAtContentY(37, 5, uniform)).toBe(2);
});

test('a y below every line clamps to the last line', () => {
  expect(lineAtContentY(10_000, 5, uniform)).toBe(5);
});

test('a y above the first line clamps to line 1', () => {
  expect(lineAtContentY(-50, 5, uniform)).toBe(1);
});

test('non-uniform line heights resolve correctly', () => {
  // y=70 sits inside wrapped line 3, which spans 38..75. Dividing by a 19px line height would
  // answer 4, and the annotation would anchor to the wrong code.
  expect(lineAtContentY(70, 5, wrapped)).toBe(3);
  expect(lineAtContentY(76, 5, wrapped)).toBe(4);
});

test('topmostPoint picks the highest point of each shape kind', () => {
  expect(
    topmostPoint({
      kind: 'freehand',
      points: [
        { x: 0, y: 50 },
        { x: 5, y: 20 },
        { x: 9, y: 90 },
      ],
    }),
  ).toEqual({ x: 5, y: 20 });

  expect(topmostPoint({ kind: 'rect', from: { x: 0, y: 90 }, to: { x: 10, y: 30 } })).toEqual({
    x: 10,
    y: 30,
  });
  expect(topmostPoint({ kind: 'arrow', from: { x: 0, y: 10 }, to: { x: 10, y: 80 } })).toEqual({
    x: 0,
    y: 10,
  });
  expect(topmostPoint({ kind: 'text', at: { x: 3, y: 7 }, text: 'hi' })).toEqual({ x: 3, y: 7 });
});
