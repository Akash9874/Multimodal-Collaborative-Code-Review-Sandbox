import type { User } from '@sandbox/shared';

export const USER_COLORS = [
  '#f97316',
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#60a5fa',
  '#fb7185',
] as const;

const STORAGE_KEY = 'sandbox:identity';

export const randomColor = (rand: () => number = Math.random): string =>
  USER_COLORS[Math.floor(rand() * USER_COLORS.length)] ?? USER_COLORS[0];

export const loadIdentity = (storage: Storage): User | null => {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed.id || !parsed.name || !parsed.color) return null;
    return { id: parsed.id, name: parsed.name, color: parsed.color };
  } catch {
    return null;
  }
};

export const saveIdentity = (storage: Storage, user: User): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify(user));
};
