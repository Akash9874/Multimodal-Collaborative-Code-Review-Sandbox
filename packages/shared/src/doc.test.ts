import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE } from './model.js';
import { getFileText, getFilesMap, listFiles, seedDoc, setFileLanguage } from './doc.js';

test('seedDoc creates exactly one default file, with content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(listFiles(doc).map((f) => f.name)).toEqual(['main.py']);
  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toContain('fizzbuzz');
});

test('seedDoc is idempotent — a second call cannot duplicate the content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const first = getFileText(doc, DEFAULT_FILE.id).toString();

  seedDoc(doc);

  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toBe(first);
  expect(listFiles(doc)).toHaveLength(1);
});

test('listFiles is ordered by creation time', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  doc.getMap('files').set('later', {
    id: 'later',
    name: 'notes.js',
    language: 'javascript',
    createdAt: 10,
  });

  expect(listFiles(doc).map((f) => f.id)).toEqual(['main', 'later']);
});

test('setFileLanguage moves the extension with the language', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  setFileLanguage(doc, DEFAULT_FILE.id, 'javascript');

  const file = getFilesMap(doc).get(DEFAULT_FILE.id);
  // Piston keys off the filename for JS/TS: a file called main.py holding JavaScript will not run.
  expect(file?.name).toBe('main.js');
  expect(file?.language).toBe('javascript');
});

test('setFileLanguage does not touch the file content', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const before = getFileText(doc, DEFAULT_FILE.id).toString();

  setFileLanguage(doc, DEFAULT_FILE.id, 'typescript');

  expect(getFileText(doc, DEFAULT_FILE.id).toString()).toBe(before);
});

test('setFileLanguage ignores an unknown file', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(() => setFileLanguage(doc, 'nope', 'javascript')).not.toThrow();
  expect(listFiles(doc)).toHaveLength(1);
});
