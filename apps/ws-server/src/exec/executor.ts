import type { LanguageId } from '@sandbox/shared';

export type ExecRequest = {
  language: LanguageId;
  fileName: string;
  code: string;
  stdin: string;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

/**
 * The seam. PistonExecutor implements it today; a self-hosted DockerExecutor with a pty is the
 * later, optional adapter — and it must not require touching anything above this interface.
 */
export interface CodeExecutor {
  run(request: ExecRequest): Promise<ExecResult>;
}

/** An executor failure the room is allowed to hear about, phrased for a human. */
export class ExecutorError extends Error {}

/** Injected by the tests. It never touches the network. */
export class StubExecutor implements CodeExecutor {
  public calls: ExecRequest[] = [];

  constructor(private readonly outcome: ExecResult | ExecutorError) {}

  async run(request: ExecRequest): Promise<ExecResult> {
    this.calls.push(request);
    if (this.outcome instanceof ExecutorError) throw this.outcome;
    return this.outcome;
  }
}
