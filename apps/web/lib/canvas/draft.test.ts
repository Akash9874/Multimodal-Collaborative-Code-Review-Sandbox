import { expect, test } from 'vitest';
import { buildShape } from './draft';

const path = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 2 }];

test('freehand keeps every point', () => {
  expect(buildShape('freehand', path)).toEqual({ kind: 'freehand', points: path });
});

test('freehand with a single point is degenerate and discarded', () => {
  expect(buildShape('freehand', [{ x: 0, y: 0 }])).toBeNull();
});

test('arrow uses the first and last point', () => {
  expect(buildShape('arrow', path)).toEqual({
    kind: 'arrow',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 2 },
  });
});

test('rect uses the first and last point as opposite corners', () => {
  expect(buildShape('rect', path)).toEqual({
    kind: 'rect',
    from: { x: 0, y: 0 },
    to: { x: 10, y: 2 },
  });
});

test('a zero-length arrow or rect is degenerate and discarded', () => {
  const dot = [{ x: 3, y: 3 }, { x: 3, y: 3 }];
  expect(buildShape('arrow', dot)).toBeNull();
  expect(buildShape('rect', dot)).toBeNull();
});
