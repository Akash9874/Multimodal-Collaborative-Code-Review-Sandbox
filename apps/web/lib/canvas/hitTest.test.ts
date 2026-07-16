import { expect, test } from 'vitest';
import type { Stroke } from '@sandbox/shared';
import { hits } from './hitTest';

const base = { id: 's', fileId: 'main', authorId: 'u', color: '#fff', width: 3, createdAt: 0 };

const freehand: Stroke = { ...base, shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } };
const arrow: Stroke = { ...base, shape: { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } } };
const rect: Stroke = { ...base, shape: { kind: 'rect', from: { x: 10, y: 10 }, to: { x: 110, y: 60 } } };
const text: Stroke = { ...base, shape: { kind: 'text', at: { x: 50, y: 50 }, text: 'bug' } };

test('a point on a freehand segment hits; a point far from it does not', () => {
  expect(hits(freehand, { x: 50, y: 1 }, 5)).toBe(true);
  expect(hits(freehand, { x: 50, y: 40 }, 5)).toBe(false);
});

test('a point on the arrow line hits', () => {
  expect(hits(arrow, { x: 50, y: 50 }, 5)).toBe(true);
  expect(hits(arrow, { x: 50, y: 90 }, 5)).toBe(false);
});

test('a point on a rect edge hits; the hollow centre does not', () => {
  expect(hits(rect, { x: 10, y: 35 }, 5)).toBe(true); // on the left edge
  expect(hits(rect, { x: 60, y: 35 }, 5)).toBe(false); // inside, away from any edge
});

test('a point inside the text box hits', () => {
  expect(hits(text, { x: 55, y: 48 }, 5)).toBe(true);
  expect(hits(text, { x: 300, y: 300 }, 5)).toBe(false);
});
