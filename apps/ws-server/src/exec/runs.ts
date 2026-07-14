import { RUN_HISTORY_LIMIT, RUN_STORE_MAX_ROOMS, type RunRecord } from '@sandbox/shared';

/**
 * Run history is server-authored, not collaborative state — it does not belong in the Y.Doc.
 * Phase 4 drops a PostgresRunStore in behind this interface and nothing above it changes:
 * RunRecord is column-for-column with the `runs` table in the master spec §4.4.
 */
export interface RunStore {
  append(record: RunRecord): void;
  update(roomId: string, id: string, patch: Partial<RunRecord>): void;
  list(roomId: string): RunRecord[];
}

export class MemoryRunStore implements RunStore {
  /** Insertion-ordered, so the first key is always the least recently used room. */
  private readonly rooms = new Map<string, RunRecord[]>();

  append(record: RunRecord): void {
    const runs = this.rooms.get(record.roomId) ?? [];
    runs.push(record);
    if (runs.length > RUN_HISTORY_LIMIT) runs.splice(0, runs.length - RUN_HISTORY_LIMIT);

    // Delete and re-set to move this room to the back of the insertion order.
    this.rooms.delete(record.roomId);
    this.rooms.set(record.roomId, runs);

    // Without this outer cap, a long-lived server keeps the history of every room it has ever seen.
    while (this.rooms.size > RUN_STORE_MAX_ROOMS) {
      const leastRecent = this.rooms.keys().next().value;
      if (leastRecent === undefined) break;
      this.rooms.delete(leastRecent);
    }
  }

  update(roomId: string, id: string, patch: Partial<RunRecord>): void {
    const runs = this.rooms.get(roomId);
    if (!runs) return;

    const index = runs.findIndex((run) => run.id === id);
    if (index === -1) return;

    runs[index] = { ...runs[index]!, ...patch };
  }

  list(roomId: string): RunRecord[] {
    return [...(this.rooms.get(roomId) ?? [])];
  }
}
