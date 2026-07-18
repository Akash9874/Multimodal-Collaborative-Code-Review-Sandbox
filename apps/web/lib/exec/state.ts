import { RUN_HISTORY_LIMIT, type ExecMessage, type RunRecord } from '@sandbox/shared';

export type ExecState = {
  runs: RunRecord[];
  /** A message meant for me alone — a rate-limit rejection for a run that never started. */
  notice: string | null;
  /**
   * Whether this server has an executor at all. Optimistic until the server says otherwise, so a
   * client that never hears exec:hello does not disable Run on a guess.
   */
  executionEnabled: boolean;
};

export const EMPTY_EXEC_STATE: ExecState = { runs: [], notice: null, executionEnabled: true };

const ordered = (runs: RunRecord[]): RunRecord[] =>
  [...runs].sort((a, b) => a.createdAt - b.createdAt).slice(-RUN_HISTORY_LIMIT);

const patch = (runs: RunRecord[], id: string, change: Partial<RunRecord>): RunRecord[] =>
  runs.map((run) => (run.id === id ? { ...run, ...change } : run));

/**
 * Runs are keyed by id, never appended blindly: the server re-sends run:history on every connect,
 * so a reconnect must re-render the same scrollback, not a second copy of it.
 */
export const applyExecMessage = (state: ExecState, message: ExecMessage): ExecState => {
  switch (message.type) {
    case 'exec:hello':
      return { ...state, executionEnabled: message.executionEnabled };

    case 'run:history': {
      // The server's copy is authoritative — it has the complete output, and we may have dropped
      // the socket half way through a run.
      const merged = new Map(state.runs.map((run) => [run.id, run]));
      for (const run of message.runs) merged.set(run.id, run);

      return { ...state, runs: ordered([...merged.values()]) };
    }

    case 'run:started': {
      if (state.runs.some((run) => run.id === message.runId)) return state;

      const run: RunRecord = {
        id: message.runId,
        roomId: '',
        byUser: message.byUser,
        fileName: message.fileName,
        language: message.language,
        stdin: message.stdin,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: null,
        createdAt: message.at,
      };

      return { ...state, runs: ordered([...state.runs, run]), notice: null };
    }

    case 'run:output': {
      const current = state.runs.find((run) => run.id === message.runId);
      if (!current) return state;

      return {
        ...state,
        runs: patch(state.runs, message.runId, {
          [message.stream]: current[message.stream] + message.chunk,
        }),
      };
    }

    case 'run:done':
      return {
        ...state,
        runs: patch(state.runs, message.runId, {
          exitCode: message.exitCode,
          durationMs: message.durationMs,
        }),
      };

    case 'run:error': {
      // A rate-limit rejection carries a runId for a run that never started, and never will.
      // It is a notice to me, not a run in anyone's history.
      if (!state.runs.some((run) => run.id === message.runId)) {
        return { ...state, notice: message.message };
      }

      return { ...state, runs: patch(state.runs, message.runId, { error: message.message }) };
    }
  }
};
