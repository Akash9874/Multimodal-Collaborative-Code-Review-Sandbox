import * as Y from 'yjs';
import {
  DEFAULT_FILE,
  DEFAULT_FILE_CONTENT,
  DOC_FILES_KEY,
  DOC_META_KEY,
  DOC_STROKES_KEY,
  LANGUAGES,
  SCHEMA_VERSION,
  fileTextKey,
  renameExtension,
  type FileMeta,
  type LanguageId,
  type Stroke,
} from './model.js';

export const getFilesMap = (doc: Y.Doc): Y.Map<FileMeta> => doc.getMap<FileMeta>(DOC_FILES_KEY);
export const getStrokes = (doc: Y.Doc): Y.Array<Stroke> => doc.getArray<Stroke>(DOC_STROKES_KEY);
export const getMeta = (doc: Y.Doc): Y.Map<number> => doc.getMap<number>(DOC_META_KEY);
export const getFileText = (doc: Y.Doc, fileId: string): Y.Text => doc.getText(fileTextKey(fileId));

export const listFiles = (doc: Y.Doc): FileMeta[] =>
  [...getFilesMap(doc).values()].sort(
    (a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name),
  );

/**
 * Seed an empty doc. Only the server calls this, once, before any client connects:
 * two peers seeding concurrently would each insert DEFAULT_FILE_CONTENT and the CRDT
 * would faithfully merge both copies.
 */
export const seedDoc = (doc: Y.Doc): void => {
  if (getFilesMap(doc).size > 0) return;

  doc.transact(() => {
    getMeta(doc).set('schemaVersion', SCHEMA_VERSION);
    getMeta(doc).set('createdAt', Date.now());
    getFilesMap(doc).set(DEFAULT_FILE.id, DEFAULT_FILE);
    getFileText(doc, DEFAULT_FILE.id).insert(0, DEFAULT_FILE_CONTENT);
  });
};

/**
 * The language picker's one write. Name and language must not drift apart: Piston keys off the
 * filename's extension for JavaScript and TypeScript, so a `main.py` holding TypeScript will not
 * compile. Phase 4 maintains the same invariant from the other end — there, renaming drives the
 * language; here, the language drives the rename.
 */
export const setFileLanguage = (doc: Y.Doc, fileId: string, language: LanguageId): void => {
  const files = getFilesMap(doc);
  const file = files.get(fileId);
  if (!file || file.language === language) return;

  files.set(fileId, {
    ...file,
    language,
    name: renameExtension(file.name, LANGUAGES[language].extension),
  });
};

/**
 * Ids are generated, never derived from the name: a rename is then metadata-only, and two
 * concurrent creates cannot collide on an id.
 *
 * The id is the caller's, like `appendStroke`'s. This package's `lib` is `ES2022` and nothing
 * else — no DOM, no @types/node — so `crypto` does not exist here to call. That restraint is
 * deliberate and load-bearing (see `byteLength` in exec.ts): a package that could reach for
 * `crypto` could equally reach for `document` or `process`. The web app generates the id, where
 * `crypto.randomUUID` is real; tests pass a literal, which makes them deterministic for free.
 */
export const createFile = (doc: Y.Doc, name: string, id: string): string => {
  doc.transact(() => {
    getFilesMap(doc).set(id, { id, name, createdAt: Date.now() });
    getFileText(doc, id); // bring the text type into existence, empty
  });

  return id;
};

/** The only write. The language follows from the name by derivation — there is nothing else to set. */
export const renameFile = (doc: Y.Doc, fileId: string, name: string): void => {
  const files = getFilesMap(doc);
  const file = files.get(fileId);
  if (!file) return;

  files.set(fileId, { ...file, name });
};

/**
 * Cascades in one transaction: the metadata, the text, and every stroke on this file.
 *
 * A Yjs root type cannot be removed from a document — there is no `doc.delete(key)` — so the text
 * can only be emptied. The empty `file:<id>` type stays and is re-encoded into every future
 * persisted blob. That leak is accepted: a room is disposable and swept after 30 days.
 */
export const deleteFile = (doc: Y.Doc, fileId: string): void => {
  const files = getFilesMap(doc);
  if (!files.has(fileId)) return;

  doc.transact(() => {
    files.delete(fileId);

    const text = getFileText(doc, fileId);
    text.delete(0, text.length);

    const strokes = getStrokes(doc);
    const list = strokes.toArray();
    // Back to front: deleting shifts the index of everything after it.
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.fileId === fileId) strokes.delete(i, 1);
    }
  });
};

/** Commit a finished stroke. Called on pointer-up; the draft in awareness is cleared separately. */
export const appendStroke = (doc: Y.Doc, stroke: Stroke): void => {
  getStrokes(doc).push([stroke]);
};

/** Delete a stroke by id. A no-op if it is already gone, so concurrent erases are safe. */
export const eraseStroke = (doc: Y.Doc, id: string): void => {
  const strokes = getStrokes(doc);
  const index = strokes.toArray().findIndex((s) => s.id === id);
  if (index !== -1) strokes.delete(index, 1);
};

/** Undo: remove the author's most recent surviving stroke. Own strokes only. */
export const undoLastStrokeBy = (doc: Y.Doc, authorId: string): void => {
  const strokes = getStrokes(doc);
  const list = strokes.toArray();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.authorId === authorId) {
      strokes.delete(i, 1);
      return;
    }
  }
};
