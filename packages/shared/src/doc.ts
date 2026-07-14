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
