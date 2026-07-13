import { beforeEach, expect, test } from 'vitest';
import { USER_COLORS, loadIdentity, randomColor, saveIdentity } from './identity';

const memoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
};

let storage: Storage;
beforeEach(() => {
  storage = memoryStorage();
});

test('an identity round-trips through storage', () => {
  const user = { id: 'u1', name: 'Ada', color: '#f97316' };
  saveIdentity(storage, user);

  expect(loadIdentity(storage)).toEqual(user);
});

test('no stored identity yields null', () => {
  expect(loadIdentity(storage)).toBeNull();
});

test('corrupt or incomplete stored identities yield null rather than throwing', () => {
  storage.setItem('sandbox:identity', 'not json');
  expect(loadIdentity(storage)).toBeNull();

  storage.setItem('sandbox:identity', JSON.stringify({ name: 'Ada' }));
  expect(loadIdentity(storage)).toBeNull();
});

test('randomColor always returns a colour from the palette', () => {
  expect(USER_COLORS).toContain(randomColor(() => 0));
  expect(USER_COLORS).toContain(randomColor(() => 0.999));
});
