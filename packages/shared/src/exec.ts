import type { LanguageId, User } from './model.js';

/** Size caps, enforced at the server's zod boundary. */
export const MAX_CODE_BYTES = 64 * 1024;
export const MAX_STDIN_BYTES = 4 * 1024;

/** A runaway print loop must not blow up every client's memory, or the ring buffer. */
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const TRUNCATION_NOTICE = '\n… output truncated\n';

export const RUN_HISTORY_LIMIT = 50;
export const RUN_STORE_MAX_ROOMS = 200;

/** Sent to Piston as `run_timeout`. The PRD's NFR names 5s as the maximum execution time. */
export const RUN_TIMEOUT_MS = 5_000;
/** Outer bound on the whole HTTP call, generous over RUN_TIMEOUT_MS to cover Piston's queue. */
export const EXECUTOR_TIMEOUT_MS = 15_000;

/** Token buckets: `capacity` tokens, one replaced every `refillMs`. */
export const ROOM_RATE = { capacity: 1, refillMs: 2_000 } as const;
export const IP_RATE = { capacity: 20, refillMs: 3_000 } as const;

/**
 * Piston lists two TypeScript runtimes (Node 5.0.3 and Deno 1.32.3) and two JavaScript runtimes,
 * so the version is never left for it to choose. Verified against GET /runtimes on 2026-07-14.
 */
export const PISTON_RUNTIMES: Record<LanguageId, { language: string; version: string }> = {
  python: { language: 'python', version: '3.10.0' },
  javascript: { language: 'javascript', version: '18.15.0' },
  typescript: { language: 'typescript', version: '5.0.3' },
};

/**
 * UTF-8 byte length, counted by hand rather than with TextEncoder — which lives in no lib this
 * isomorphic package can honestly claim (`DOM` would let it reference `document`; `@types/node`
 * would let it reference `process`). `for…of` iterates code points, so a surrogate pair counts
 * once, as the 4 bytes it is.
 */
export const byteLength = (value: string): number => {
  let bytes = 0;

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }

  return bytes;
};

export const truncateOutput = (raw: string, limit: number = MAX_OUTPUT_BYTES): string =>
  raw.length <= limit ? raw : raw.slice(0, limit) + TRUNCATION_NOTICE;

export type ExecStream = 'stdout' | 'stderr';

/** client → server. The only message the client is allowed to send. */
export type RunRequest = {
  type: 'run';
  byUser: User;
  fileName: string;
  language: LanguageId;
  code: string;
  stdin: string;
};

/** Column-for-column with the Phase 4 `runs` table, so PostgresRunStore is a drop-in. */
export type RunRecord = {
  id: string;
  roomId: string;
  byUser: User;
  fileName: string;
  language: LanguageId;
  stdin: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  error?: string;
  createdAt: number;
};

/** server → client. */
export type ExecMessage =
  // Sent once, first, on every /exec connection. The hosted demo has no executor, and a Run button
  // that fails on click is worse than one that says why it cannot.
  | { type: 'exec:hello'; executionEnabled: boolean }
  | { type: 'run:history'; runs: RunRecord[] }
  | {
      type: 'run:started';
      runId: string;
      byUser: User;
      fileName: string;
      language: LanguageId;
      stdin: string;
      at: number;
    }
  | { type: 'run:output'; runId: string; stream: ExecStream; chunk: string }
  | { type: 'run:done'; runId: string; exitCode: number; durationMs: number }
  | { type: 'run:error'; runId: string; message: string };
