import * as Y from 'yjs';

/** A stroke's binding to a character in its file's text. See the Phase 5 design §3. */
export type Anchor = { rel: string; dy: number };

export type AnchorResolution = { kind: 'anchored'; index: number } | { kind: 'orphaned' };

/** The shape of `Y.relativePositionToJSON`. `item` is absent for a position at the very start. */
type RelJson = { item?: { client: number; clock: number } };

/**
 * `assoc = 0` associates the position with the character that FOLLOWS it, and that is the entire
 * feature. Inserting a newline at the anchored offset is what "add a line above the annotated
 * block" means; assoc=0 keeps the anchor on the original character as it moves down, while
 * assoc=-1 would bind to the end of the preceding text and stay put.
 *
 * The encoding is JSON, not the master spec's base64: this package compiles against
 * `lib: ["ES2022"]` alone, so neither `btoa` nor `Buffer` exists here. That constraint is
 * deliberate — it is the same one that forces ids to be passed in rather than generated.
 */
export const createAnchor = (text: Y.Text, index: number, dy: number): Anchor => ({
  rel: JSON.stringify(
    Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index, 0)),
  ),
  dy,
});

/**
 * Yjs resolves an anchor whose text was deleted to the surviving neighbour's index, NOT to null,
 * so a null check reports a dead anchor as healthy. The anchored item's tombstone is the honest
 * signal, and a synced peer independently agrees with it — which is what keeps orphan state the
 * same for every viewer instead of per-client.
 *
 * Every failure path returns `orphaned` rather than throwing: anchors are written by other
 * clients, so this is a trust boundary.
 */
export const resolveAnchor = (doc: Y.Doc, anchor: Anchor): AnchorResolution => {
  let json: RelJson;
  try {
    json = JSON.parse(anchor.rel) as RelJson;
  } catch {
    return { kind: 'orphaned' };
  }

  let index: number;
  try {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      doc,
    );
    if (!absolute) return { kind: 'orphaned' };
    index = absolute.index;
  } catch {
    return { kind: 'orphaned' };
  }

  // No item id means a position pinned to the start of the type, which cannot be deleted.
  const id = json.item;
  if (id) {
    try {
      if (Y.getItem(doc.store, Y.createID(id.client, id.clock)).deleted) {
        return { kind: 'orphaned' };
      }
    } catch {
      // Not in the store: this client has not received that update, so it cannot be placed.
      return { kind: 'orphaned' };
    }
  }

  return { kind: 'anchored', index };
};
