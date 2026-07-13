import { Room } from './room';

/** A room outlives its last connection briefly, so a page refresh does not wipe the document. */
export const ROOM_GRACE_MS = 30_000;

const rooms = new Map<string, Room>();
const evictions = new Map<string, NodeJS.Timeout>();

const cancelEviction = (id: string): void => {
  const pending = evictions.get(id);
  if (!pending) return;
  clearTimeout(pending);
  evictions.delete(id);
};

export const getOrCreateRoom = (id: string): Room => {
  cancelEviction(id);

  let room = rooms.get(id);
  if (!room) {
    room = new Room(id);
    room.seed(); // exactly once, before the first client syncs
    rooms.set(id, room);
  }
  return room;
};

export const releaseRoom = (room: Room, graceMs: number = ROOM_GRACE_MS): void => {
  if (room.size > 0 || evictions.has(room.id)) return;

  const timer = setTimeout(() => {
    evictions.delete(room.id);
    const current = rooms.get(room.id);
    if (current && current.size === 0) {
      rooms.delete(room.id);
      current.destroy();
    }
  }, graceMs);
  timer.unref();

  evictions.set(room.id, timer);
};

export const roomCount = (): number => rooms.size;

export const resetRooms = (): void => {
  evictions.forEach(clearTimeout);
  evictions.clear();
  rooms.forEach((room) => room.destroy());
  rooms.clear();
};
