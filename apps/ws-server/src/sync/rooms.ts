import * as Y from 'yjs';
import { MemoryRoomStore, type RoomStore } from '../persistence/store';
import { Room } from './room';

/** A room outlives its last connection briefly, so a page refresh does not wipe the document. */
export const ROOM_GRACE_MS = 30_000;
/** Edits are batched: the doc is written at most this often while someone is actively typing. */
export const SAVE_DEBOUNCE_MS = 2_000;

const rooms = new Map<string, Room>();
const loading = new Map<string, Promise<Room>>(); // in-flight creations, so a race shares one load
const evictions = new Map<string, NodeJS.Timeout>();
const saveTimers = new Map<string, NodeJS.Timeout>();

let store: RoomStore = new MemoryRoomStore();
let graceMs = ROOM_GRACE_MS;
let saveDebounceMs = SAVE_DEBOUNCE_MS;

/** Called once at server creation to inject the store and (in tests) shorten the timers. */
export const configureRooms = (opts: {
  store: RoomStore;
  graceMs?: number;
  saveDebounceMs?: number;
}): void => {
  store = opts.store;
  graceMs = opts.graceMs ?? ROOM_GRACE_MS;
  saveDebounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
};

const cancelEviction = (id: string): void => {
  const pending = evictions.get(id);
  if (!pending) return;
  clearTimeout(pending);
  evictions.delete(id);
};

const persist = async (id: string, room: Room): Promise<void> => {
  // Encode synchronously at call time, so a later eviction cannot change what we are about to write.
  const state = Y.encodeStateAsUpdate(room.doc);
  await store
    .save(id, state)
    .catch((error) => console.error(`[persist] save failed for ${id}:`, error));
};

const scheduleSave = (id: string, room: Room): void => {
  const pending = saveTimers.get(id);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    saveTimers.delete(id);
    void persist(id, room);
  }, saveDebounceMs);
  timer.unref();
  saveTimers.set(id, timer);
};

const flush = async (id: string, room: Room): Promise<void> => {
  const pending = saveTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    saveTimers.delete(id);
  }
  await persist(id, room);
};

export const getOrCreateRoom = async (id: string): Promise<Room> => {
  cancelEviction(id);

  const existing = rooms.get(id);
  if (existing) return existing;

  const inFlight = loading.get(id);
  if (inFlight) return inFlight;

  const creation = (async () => {
    const room = new Room(id);

    let state: Uint8Array | null = null;
    try {
      state = await store.load(id);
    } catch (error) {
      // A reachable room with an empty doc beats a dead socket. Seed and move on, loudly.
      console.error(`[persist] load failed for ${id}, seeding fresh:`, error);
    }

    if (state) {
      Y.applyUpdate(room.doc, state);
    } else {
      room.seed();
      await persist(id, room); // a row exists from the start, even before any edit
    }

    // Registered after load/seed so restoring the doc does not itself schedule a redundant save.
    room.doc.on('update', () => scheduleSave(id, room));

    rooms.set(id, room);
    loading.delete(id);
    return room;
  })();

  loading.set(id, creation);
  return creation;
};

export const releaseRoom = (room: Room, ms: number = graceMs): void => {
  if (room.size > 0 || evictions.has(room.id)) return;

  // Flush immediately on last-leave, so a crash during the grace window does not lose the edit.
  void flush(room.id, room);

  const timer = setTimeout(() => {
    evictions.delete(room.id);
    const current = rooms.get(room.id);
    if (current && current.size === 0) {
      rooms.delete(room.id);
      current.destroy();
    }
  }, ms);
  timer.unref();

  evictions.set(room.id, timer);
};

export const roomCount = (): number => rooms.size;

export const resetRooms = (): void => {
  evictions.forEach(clearTimeout);
  evictions.clear();
  saveTimers.forEach(clearTimeout);
  saveTimers.clear();
  loading.clear();
  rooms.forEach((room) => room.destroy());
  rooms.clear();
};
