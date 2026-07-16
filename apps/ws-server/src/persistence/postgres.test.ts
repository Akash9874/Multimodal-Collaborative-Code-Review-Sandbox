import { Pool } from 'pg';
import { afterAll, describe, expect, test } from 'vitest';
import { PostgresRoomStore } from './postgres';

const url = process.env.DATABASE_URL;

// Gated: without a database this suite is skipped, so contributors without the secret are not blocked.
describe.skipIf(!url)('PostgresRoomStore', () => {
  const store = new PostgresRoomStore(url!);
  /**
   * A second connection, for the setup and teardown the RoomStore interface deliberately does not
   * expose: deleting exactly the rows this suite made, and back-dating one to age it past a cutoff.
   * Cleaning up via `deleteStale` instead would take every other room in the database with it.
   */
  const admin = new Pool({ connectionString: url });
  const ids: string[] = [];
  const roomId = () => {
    const id = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    ids.push(id);
    return id;
  };

  afterAll(async () => {
    await admin.query('delete from sandbox.rooms where id = any($1)', [ids]);
    await admin.end();
    await store.close();
  });

  test('load is null for an unknown room', async () => {
    expect(await store.load(roomId())).toBeNull();
  });

  test('save then load round-trips the exact bytes', async () => {
    const id = roomId();
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    await store.save(id, bytes);
    expect(await store.load(id)).toEqual(bytes);
  });

  test('save upserts — the second write overwrites the first', async () => {
    const id = roomId();
    await store.save(id, new Uint8Array([1, 1, 1]));
    await store.save(id, new Uint8Array([2, 2]));
    expect(await store.load(id)).toEqual(new Uint8Array([2, 2]));
  });

  test('deleteStale removes rooms older than the cutoff and leaves fresh ones', async () => {
    const stale = roomId();
    const fresh = roomId();
    await store.save(stale, new Uint8Array([1]));
    await store.save(fresh, new Uint8Array([2]));

    // Age one row two hours, so a one-hour cutoff falls cleanly between the two.
    await admin.query(
      `update sandbox.rooms set updated_at = now() - interval '2 hours' where id = $1`,
      [stale],
    );

    // >= 1 rather than 1: the sweep is global, and any other room in the database that is
    // genuinely older than an hour is swept too. What this asserts is which of ours went.
    expect(await store.deleteStale(3_600_000)).toBeGreaterThanOrEqual(1);
    expect(await store.load(stale)).toBeNull();
    expect(await store.load(fresh)).not.toBeNull();
  });
});
