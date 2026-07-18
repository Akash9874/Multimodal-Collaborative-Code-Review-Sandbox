import { expect, test } from 'vitest';
import * as Y from 'yjs';
import { createAnchor, resolveAnchor } from './anchor.js';

/** Indices: a=0 a=1 a=2 \n=3 b=4 b=5 b=6 \n=7 c=8 c=9 c=10 */
const seed = (doc: Y.Doc) => {
  const text = doc.getText('file:main');
  text.insert(0, 'aaa\nbbb\nccc');
  return text;
};

test('an anchor round-trips to the index it was created at', () => {
  const doc = new Y.Doc();
  const text = seed(doc);

  const anchor = createAnchor(text, 4, 12);

  expect(anchor.dy).toBe(12);
  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 4 });
});

test('inserting a line AT the anchored offset carries the anchor down with its code', () => {
  // The headline behaviour of the phase, and precisely what assoc=0 buys. A result of 4 here
  // means assoc regressed to -1: the annotation stayed behind while its code moved.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.insert(4, 'XXX\n');

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 8 });
});

test('inserting before the anchor shifts it', () => {
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.insert(0, 'ZZ');

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 6 });
});

test('deleting the anchored character orphans the anchor', () => {
  // Yjs still resolves this to index 4 — the surviving neighbour — so a null check would call a
  // dead anchor healthy. The tombstone is the only honest signal.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.delete(4, 3);

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'orphaned' });
});

test('deleting text around the anchor leaves it anchored', () => {
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  text.delete(5, 2); // the 2nd and 3rd 'b'; the anchored one survives

  expect(resolveAnchor(doc, anchor)).toEqual({ kind: 'anchored', index: 4 });
});

test('a peer that receives the deletion agrees it is orphaned', () => {
  // Orphan state must be identical for everyone, or two people see different annotations over
  // the same code.
  const doc = new Y.Doc();
  const text = seed(doc);
  const anchor = createAnchor(text, 4, 0);

  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  expect(resolveAnchor(peer, anchor)).toEqual({ kind: 'anchored', index: 4 });

  text.delete(4, 3);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

  expect(resolveAnchor(peer, anchor)).toEqual({ kind: 'orphaned' });
});

test('an anchor from a document this client has never seen is orphaned, not a crash', () => {
  const doc = new Y.Doc();
  const anchor = createAnchor(seed(doc), 4, 0);

  expect(resolveAnchor(new Y.Doc(), anchor)).toEqual({ kind: 'orphaned' });
});

test('a malformed anchor is orphaned, not a crash', () => {
  // Anchors arrive from other clients; this is a trust boundary.
  expect(resolveAnchor(new Y.Doc(), { rel: 'not json', dy: 0 })).toEqual({ kind: 'orphaned' });
});
