import { describe, expect, test } from 'vitest';
import { MAX_NAME_LENGTH, isValidRoomId, renameExtension, sanitizeName } from './model.js';

describe('isValidRoomId', () => {
  test('accepts a nanoid-shaped id', () => {
    expect(isValidRoomId('V1StGXR8_Z')).toBe(true);
  });

  test('rejects ids that are too short, too long, missing, or contain path characters', () => {
    expect(isValidRoomId('abc')).toBe(false);
    expect(isValidRoomId('a'.repeat(33))).toBe(false);
    expect(isValidRoomId('../../etc/passwd')).toBe(false);
    expect(isValidRoomId(undefined)).toBe(false);
  });
});

describe('sanitizeName', () => {
  test('keeps letters, digits, spaces and simple punctuation', () => {
    expect(sanitizeName('Ada Lovelace-1')).toBe('Ada Lovelace-1');
  });

  test('strips characters that could break out of a CSS string', () => {
    // Names are interpolated into a <style> rule for remote cursors.
    const clean = sanitizeName("Bob'; } body { display: none } /*");
    expect(clean).not.toMatch(/['{}();*\/\\]/);
  });

  test('truncates to MAX_NAME_LENGTH', () => {
    expect(sanitizeName('x'.repeat(100))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('renameExtension', () => {
  test('swaps the extension', () => {
    expect(renameExtension('main.py', '.js')).toBe('main.js');
  });

  test('adds one to a name that has none', () => {
    expect(renameExtension('main', '.py')).toBe('main.py');
  });

  test('leaves a dotfile its leading dot', () => {
    expect(renameExtension('.env', '.py')).toBe('.env.py');
  });
});
