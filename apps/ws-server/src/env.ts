export const env = {
  port: Number(process.env.PORT ?? 1234),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * A self-hosted Piston — `pnpm piston:up`. The public instance became whitelist-only on
   * 2026-02-15 (GET /runtimes answers; POST /execute is a 401), so it is not a usable default.
   */
  pistonUrl: process.env.PISTON_URL ?? 'http://localhost:2000/api/v2',
};
