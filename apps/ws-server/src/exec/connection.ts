import { randomUUID } from 'node:crypto';
import { type RunRecord, truncateOutput } from '@sandbox/shared';
import type { RawData, WebSocket } from 'ws';
import { type CodeExecutor, ExecutorError } from './executor';
import type { TokenBuckets } from './limiter';
import { type ParsedRunRequest, encode, parseRunRequest } from './protocol';
import { type ExecRoom, releaseExecRoom, send } from './rooms';
import type { RunStore } from './runs';

export type ExecDeps = {
  executor: CodeExecutor;
  store: RunStore;
  roomLimiter: TokenBuckets;
  ipLimiter: TokenBuckets;
  now: () => number;
};

export const setupExecConnection = (
  conn: WebSocket,
  room: ExecRoom,
  ip: string,
  deps: ExecDeps,
): void => {
  room.add(conn);

  // Always sent, even when empty: the terminal must be able to tell "nothing has run here" from
  // "still loading".
  send(conn, encode({ type: 'run:history', runs: deps.store.list(room.id) }));

  conn.on('message', (data: RawData) => {
    let request: ParsedRunRequest;

    try {
      request = parseRunRequest(data.toString());
    } catch (error) {
      console.error(`[exec] bad message in room ${room.id}:`, error);
      conn.close(1003, 'protocol error');
      return;
    }

    void execute(conn, room, ip, request, deps);
  });

  const teardown = (): void => {
    room.remove(conn);
    releaseExecRoom(room);
  };
  conn.on('close', teardown);
  conn.on('error', teardown);
};

const execute = async (
  conn: WebSocket,
  room: ExecRoom,
  ip: string,
  request: ParsedRunRequest,
  deps: ExecDeps,
): Promise<void> => {
  const runId = randomUUID();

  // A rate-limit rejection goes to the requester alone. No run:started was broadcast, so nobody
  // else knows a run was even attempted — telling them would litter four other terminals with news
  // of something that never happened, and fill the ring buffer with non-runs.
  if (!deps.roomLimiter.take(room.id)) {
    send(
      conn,
      encode({
        type: 'run:error',
        runId,
        message: 'One run every 2 seconds per room. Give it a beat.',
      }),
    );
    return;
  }

  if (!deps.ipLimiter.take(ip)) {
    send(
      conn,
      encode({
        type: 'run:error',
        runId,
        message: 'Too many runs from this connection. Try again in a minute.',
      }),
    );
    return;
  }

  const record: RunRecord = {
    id: runId,
    roomId: room.id,
    byUser: request.byUser,
    fileName: request.fileName,
    language: request.language,
    stdin: request.stdin,
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: null,
    createdAt: deps.now(),
  };
  deps.store.append(record);

  room.broadcast(
    encode({
      type: 'run:started',
      runId,
      byUser: record.byUser,
      fileName: record.fileName,
      language: record.language,
      stdin: record.stdin,
      at: record.createdAt,
    }),
  );

  try {
    const result = await deps.executor.run({
      language: request.language,
      fileName: request.fileName,
      code: request.code,
      stdin: request.stdin,
    });

    const stdout = truncateOutput(result.stdout);
    const stderr = truncateOutput(result.stderr);

    deps.store.update(room.id, runId, {
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    // Piston is request/response: exactly one chunk per non-empty stream, never more. The message
    // is chunked so a streaming executor can replace this one without changing the wire format.
    if (stdout) {
      room.broadcast(encode({ type: 'run:output', runId, stream: 'stdout', chunk: stdout }));
    }
    if (stderr) {
      room.broadcast(encode({ type: 'run:output', runId, stream: 'stderr', chunk: stderr }));
    }

    room.broadcast(
      encode({ type: 'run:done', runId, exitCode: result.exitCode, durationMs: result.durationMs }),
    );
  } catch (error) {
    // The room has already been told this run started, so the room must be told it failed —
    // otherwise every terminal is left showing a run that never completes.
    const message =
      error instanceof ExecutorError ? error.message : 'The executor failed unexpectedly.';

    deps.store.update(room.id, runId, { error: message });
    room.broadcast(encode({ type: 'run:error', runId, message }));
  }
};
