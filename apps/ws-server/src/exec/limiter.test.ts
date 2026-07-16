import { beforeEach, expect, test } from 'vitest';
import { TokenBuckets } from './limiter';

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 0;
});

test('the first take succeeds and the next is refused', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);

  expect(buckets.take('room')).toBe(true);
  expect(buckets.take('room')).toBe(false);
});

test('a token comes back after refillMs', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);
  buckets.take('room');

  clock += 1_999;
  expect(buckets.take('room')).toBe(false);

  clock += 1;
  expect(buckets.take('room')).toBe(true);
});

test('tokens accumulate up to capacity and no further', () => {
  const buckets = new TokenBuckets({ capacity: 3, refillMs: 1_000 }, now);

  clock += 60_000; // idle for a minute: it must not bank 60 tokens

  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(true);
  expect(buckets.take('ip')).toBe(false);
});

test('keys are independent — one room cannot exhaust another', () => {
  const buckets = new TokenBuckets({ capacity: 1, refillMs: 2_000 }, now);

  expect(buckets.take('room-a')).toBe(true);
  expect(buckets.take('room-b')).toBe(true);
  expect(buckets.take('room-a')).toBe(false);
});
