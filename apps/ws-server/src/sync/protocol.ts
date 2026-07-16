import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

/** "Here is my state vector — send me what I am missing." */
export const encodeSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

export const encodeSyncUpdate = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

export const encodeAwarenessUpdate = (
  awareness: awarenessProtocol.Awareness,
  clients: number[],
): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
  );
  return encoding.toUint8Array(encoder);
};

export type HandleResult = { reply?: Uint8Array };

/**
 * Apply one inbound client message to the room's doc and awareness.
 * The doc is merged, never inspected: this function is the whole of what the relay "understands".
 */
export const handleMessage = (
  message: Uint8Array,
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  origin: unknown,
): HandleResult => {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  const type = decoding.readVarUint(decoder);

  switch (type) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
      // A length of 1 is just the type byte: we have nothing to say back.
      return encoding.length(encoder) > 1 ? { reply: encoding.toUint8Array(encoder) } : {};
    }
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        origin,
      );
      return {};
    }
    case MESSAGE_QUERY_AWARENESS:
      return { reply: encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]) };
    case MESSAGE_AUTH:
      return {}; // server → client only
    default:
      throw new Error(`unknown message type ${type}`);
  }
};
