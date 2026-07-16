import { Pool } from 'pg';
import type { RoomStore } from './store';

/**
 * The room store against Supabase Postgres. A long-lived pool (the ws-server is a persistent
 * process). `pg` maps `bytea` to a Node Buffer both ways. Tables live in the private `sandbox`
 * schema, unreachable through Supabase's Data API.
 */
export class PostgresRoomStore implements RoomStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async load(roomId: string): Promise<Uint8Array | null> {
    const { rows } = await this.pool.query<{ ydoc_state: Buffer }>(
      'select ydoc_state from sandbox.rooms where id = $1',
      [roomId],
    );
    return rows.length > 0 ? new Uint8Array(rows[0]!.ydoc_state) : null;
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    await this.pool.query(
      `insert into sandbox.rooms (id, ydoc_state) values ($1, $2)
       on conflict (id) do update set ydoc_state = excluded.ydoc_state, updated_at = now()`,
      [roomId, Buffer.from(state)],
    );
  }

  async deleteStale(olderThanMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `delete from sandbox.rooms where updated_at < now() - (interval '1 millisecond' * $1)`,
      [olderThanMs],
    );
    return rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
