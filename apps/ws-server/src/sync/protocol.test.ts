import { expect, test } from 'vitest';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  Awareness,
  encodeAwarenessUpdate as encodeAwarenessStateUpdate,
} from 'y-protocols/awareness';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  encodeSyncStep1,
  handleMessage,
} from './protocol';

const syncStep1For = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

test('encodeSyncStep1 tags the message as a sync message', () => {
  const decoder = decoding.createDecoder(encodeSyncStep1(new Y.Doc()));
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
});

test('handleMessage answers a step-1 message with the updates the peer is missing', () => {
  const server = new Y.Doc();
  server.getText('file:main').insert(0, 'server content');
  const client = new Y.Doc();

  const { reply } = handleMessage(syncStep1For(client), server, new Awareness(server), 'test');
  expect(reply).toBeDefined();

  const decoder = decoding.createDecoder(reply!);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
  syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), client, 'test');

  expect(client.getText('file:main').toString()).toBe('server content');
});

test('handleMessage applies an inbound awareness update', () => {
  const doc = new Y.Doc();
  const serverAwareness = new Awareness(doc);
  serverAwareness.setLocalState(null);

  const peerDoc = new Y.Doc();
  const peerAwareness = new Awareness(peerDoc);
  peerAwareness.setLocalStateField('user', { id: 'u1', name: 'Ada', color: '#f97316' });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    encodeAwarenessStateUpdate(peerAwareness, [peerDoc.clientID]),
  );

  handleMessage(encoding.toUint8Array(encoder), doc, serverAwareness, 'test');

  const state = serverAwareness.getStates().get(peerDoc.clientID) as { user?: { name: string } };
  expect(state?.user?.name).toBe('Ada');
});

test('handleMessage answers a query-awareness message with every known state', () => {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', { id: 'u1', name: 'Ada', color: '#f97316' });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);

  const { reply } = handleMessage(encoding.toUint8Array(encoder), doc, awareness, 'test');

  expect(reply).toBeDefined();
  const decoder = decoding.createDecoder(reply!);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_AWARENESS);
});

test('handleMessage rejects an unknown message type', () => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 99);
  const doc = new Y.Doc();

  expect(() =>
    handleMessage(encoding.toUint8Array(encoder), doc, new Awareness(doc), 'test'),
  ).toThrow(/unknown message type/);
});
