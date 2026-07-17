import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { DEFAULT_FILE, type Stroke } from './model.js';
import {
  appendStroke,
  createFile,
  deleteFile,
  eraseStroke,
  getFileText,
  getFilesMap,
  getStrokes,
  listFiles,
  renameFile,
  seedDoc,
  setFileLanguage,
  undoLastStrokeBy,
} from './doc.js';

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

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  id: 's1',
  fileId: 'main',
  authorId: 'u1',
  color: '#f97316',
  width: 3,
  shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  createdAt: 0,
  ...over,
});

test('appendStroke adds a stroke to the array', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke());

  expect(getStrokes(doc).toArray()).toEqual([stroke()]);
});

test('eraseStroke removes a stroke by id, and is a no-op for an id that is gone', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1' }));
  appendStroke(doc, stroke({ id: 's2' }));

  eraseStroke(doc, 's1');
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s2']);

  // Idempotent: erasing something already gone must not throw or delete a neighbour.
  eraseStroke(doc, 's1');
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s2']);
});

test("undoLastStrokeBy removes only the author's most recent stroke", () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1', authorId: 'ada' }));
  appendStroke(doc, stroke({ id: 's2', authorId: 'bob' }));
  appendStroke(doc, stroke({ id: 's3', authorId: 'ada' }));

  undoLastStrokeBy(doc, 'ada');

  // s3 was Ada's most recent; s2 (Bob's) and s1 (Ada's older) survive.
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s1', 's2']);
});

test('undoLastStrokeBy is a no-op when the author has no strokes', () => {
  const doc = new Y.Doc();
  appendStroke(doc, stroke({ id: 's1', authorId: 'bob' }));

  expect(() => undoLastStrokeBy(doc, 'ada')).not.toThrow();
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s1']);
});

test('strokes converge across two docs, and concurrent erases resolve', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };

  appendStroke(a, stroke({ id: 's1' }));
  appendStroke(b, stroke({ id: 's2' }));
  sync();

  expect(getStrokes(a).toArray().map((s) => s.id).sort()).toEqual(['s1', 's2']);
  expect(getStrokes(b).toArray().map((s) => s.id).sort()).toEqual(['s1', 's2']);

  // Both erase s1 concurrently — the CRDT must not double-delete or throw.
  eraseStroke(a, 's1');
  eraseStroke(b, 's1');
  sync();

  expect(getStrokes(a).toArray().map((s) => s.id)).toEqual(['s2']);
  expect(getStrokes(b).toArray().map((s) => s.id)).toEqual(['s2']);
});

test('createFile adds an empty file and returns its id', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  const id = createFile(doc, 'utils.py', 'f2');

  expect(id).toBe('f2');
  expect(listFiles(doc).map((f) => f.name)).toEqual(['main.py', 'utils.py']);
  expect(getFileText(doc, 'f2').toString()).toBe('');
});

test('renameFile changes only the name — the id and the text are untouched', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const id = createFile(doc, 'utils.py', 'f2');
  getFileText(doc, id).insert(0, 'x = 1');

  renameFile(doc, id, 'helpers.js');

  expect(getFilesMap(doc).get(id)?.name).toBe('helpers.js');
  expect(getFilesMap(doc).get(id)?.id).toBe('f2');
  expect(getFileText(doc, id).toString()).toBe('x = 1');
});

test('renameFile ignores an unknown file', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(() => renameFile(doc, 'nope', 'ghost.py')).not.toThrow();
  expect(listFiles(doc)).toHaveLength(1);
});

test('deleteFile removes the file, empties its text, and takes only its strokes', () => {
  const doc = new Y.Doc();
  seedDoc(doc);
  const id = createFile(doc, 'utils.py', 'f2');
  getFileText(doc, id).insert(0, 'doomed');

  appendStroke(doc, stroke({ id: 's-main', fileId: DEFAULT_FILE.id }));
  appendStroke(doc, stroke({ id: 's-utils', fileId: 'f2' }));

  deleteFile(doc, id);

  expect(listFiles(doc).map((f) => f.id)).toEqual([DEFAULT_FILE.id]);
  expect(getFileText(doc, id).toString()).toBe('');
  // The cascade is exact: main.py's stroke survives.
  expect(getStrokes(doc).toArray().map((s) => s.id)).toEqual(['s-main']);
});

test('deleteFile is a no-op on an unknown id, so concurrent deletes are safe', () => {
  const doc = new Y.Doc();
  seedDoc(doc);

  expect(() => deleteFile(doc, 'ghost')).not.toThrow();
  expect(listFiles(doc)).toHaveLength(1);
});
