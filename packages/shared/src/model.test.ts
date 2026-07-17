import { describe, expect, test } from 'vitest';
import {
  MAX_FILE_NAME_LENGTH,
  MAX_NAME_LENGTH,
  isValidRoomId,
  languageForName,
  renameExtension,
  sanitizeName,
  validateFileName,
} from './model.js';

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

describe('languageForName', () => {
  test('derives the language from the extension', () => {
    expect(languageForName('main.py')).toBe('python');
    expect(languageForName('main.js')).toBe('javascript');
    expect(languageForName('main.ts')).toBe('typescript');
  });

  test('is case-insensitive, and only the last dot counts', () => {
    expect(languageForName('MAIN.PY')).toBe('python');
    expect(languageForName('a.b.py')).toBe('python');
  });

  test('returns undefined when there is no runtime for the file', () => {
    // Not an error state: the file still edits, syncs, and is drawn on. Only Run is disabled.
    expect(languageForName('notes.txt')).toBeUndefined();
    expect(languageForName('Makefile')).toBeUndefined();
    // A dotfile named .py, not a Python file with an empty name — same rule as renameExtension.
    expect(languageForName('.py')).toBeUndefined();
  });
});

describe('validateFileName', () => {
  test('accepts a plain, free name', () => {
    expect(validateFileName('utils.py', ['main.py'])).toBeNull();
  });

  test('rejects empty and oversized names', () => {
    expect(validateFileName('', [])).toMatch(/empty/i);
    expect(validateFileName('   ', [])).toMatch(/empty/i);
    expect(validateFileName(`${'a'.repeat(MAX_FILE_NAME_LENGTH)}.py`, [])).toMatch(/too long/i);
  });

  test('rejects path-ish names — the namespace is flat', () => {
    // A slash would be a lie about what Piston does with the name.
    expect(validateFileName('src/utils.py', [])).toMatch(/\//);
    expect(validateFileName('src\\utils.py', [])).toMatch(/\\/);
    expect(validateFileName('../secrets.py', [])).toMatch(/\//);
  });

  test('rejects a name already taken, case-insensitively', () => {
    expect(validateFileName('main.py', ['main.py'])).toMatch(/already/i);
    // Two tabs reading main.py and MAIN.PY is the same confusion.
    expect(validateFileName('MAIN.PY', ['main.py'])).toMatch(/already/i);
  });
});
