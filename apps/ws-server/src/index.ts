import { env } from './env';
import { PostgresRoomStore } from './persistence/postgres';
import { MemoryRoomStore, type RoomStore } from './persistence/store';
import { createSandboxServer } from './server';

let roomStore: RoomStore;
if (env.databaseUrl) {
  const pg = new PostgresRoomStore(env.databaseUrl);
  const removed = await pg.deleteStale(env.roomTtlDays * 24 * 60 * 60 * 1000);
  console.log(`[persist] connected; removed ${removed} stale room(s)`);
  roomStore = pg;
} else {
  console.warn('[persist] no DATABASE_URL — running in-memory; rooms will not survive a restart');
  roomStore = new MemoryRoomStore();
}

createSandboxServer({ roomStore, graceMs: env.roomGraceMs }).listen(env.port, env.host, () => {
  console.log(`[ws-server] listening on ${env.host}:${env.port}`);
});
