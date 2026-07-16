/**
 * Every persistence consumer talks to this interface — the sync room lifecycle loads a room's doc
 * on first connection and saves it on edit/leave. Storing the doc is not the same as understanding
 * it: the value is an opaque `Y.encodeStateAsUpdate` blob the relay never parses.
 */
export interface RoomStore {
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, state: Uint8Array): Promise<void>;
  /** Delete rooms untouched for longer than `olderThanMs`. Returns the number removed. */
  deleteStale(olderThanMs: number): Promise<number>;
  close(): Promise<void>;
}

/** Tests and no-DB local dev. Holds the last-saved blob per room, with a save timestamp. */
export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, { state: Uint8Array; updatedAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.rooms.get(roomId)?.state ?? null;
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    this.rooms.set(roomId, { state, updatedAt: this.now() });
  }

  async deleteStale(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.updatedAt < cutoff) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async close(): Promise<void> {}
}
