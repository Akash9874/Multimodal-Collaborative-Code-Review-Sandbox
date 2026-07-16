export const env = {
  port: Number(process.env.PORT ?? 1234),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * A self-hosted Piston — `pnpm piston:up`. The public instance became whitelist-only on
   * 2026-02-15 (GET /runtimes answers; POST /execute is a 401), so it is not a usable default.
   */
  pistonUrl: process.env.PISTON_URL ?? 'http://localhost:2000/api/v2',
  /** Supabase Postgres. Unset → the server runs in-memory and rooms do not survive a restart. */
  databaseUrl: process.env.DATABASE_URL,
  /** How long a room lingers in memory after its last client leaves. Short in e2e for a fast reload. */
  roomGraceMs: Number(process.env.ROOM_GRACE_MS ?? 30_000),
  /** Rooms untouched for this many days are deleted on boot. A sandbox is disposable. */
  roomTtlDays: Number(process.env.ROOM_TTL_DAYS ?? 30),
};
