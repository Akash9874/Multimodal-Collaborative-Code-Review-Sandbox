import * as Y from 'yjs';
import {
  DEFAULT_FILE,
  DEFAULT_FILE_CONTENT,
  DOC_FILES_KEY,
  DOC_META_KEY,
  DOC_STROKES_KEY,
  SCHEMA_VERSION,
  fileTextKey,
  type FileMeta,
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
