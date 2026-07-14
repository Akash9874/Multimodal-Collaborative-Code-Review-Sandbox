import { EXECUTOR_TIMEOUT_MS, PISTON_RUNTIMES, RUN_TIMEOUT_MS } from '@sandbox/shared';
import { type CodeExecutor, type ExecRequest, type ExecResult, ExecutorError } from './executor';

type PistonStage = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
};

type PistonResponse = { run: PistonStage; compile?: PistonStage };

/**
 * The public Piston API, and the highest-priority NFR in the whole project: user code never runs
 * on our host. We shell out to nothing. The code is a string we forward over HTTPS — never
 * something we evaluate, interpolate into a shell, or write to disk. Piston runs it in an
 * isolated, network-less container with hard CPU, memory and wall-clock limits.
 */
export class PistonExecutor implements CodeExecutor {
  constructor(private readonly baseUrl: string) {}

  async run({ language, fileName, code, stdin }: ExecRequest): Promise<ExecResult> {
    const runtime = PISTON_RUNTIMES[language];
    const startedAt = Date.now();

    const response = await this.post({
      language: runtime.language,
      version: runtime.version,
      files: [{ name: fileName, content: code }],
      stdin,
      run_timeout: RUN_TIMEOUT_MS,
    });

    const durationMs = Date.now() - startedAt;

    // TypeScript compiles first; a compile failure never reaches the run stage, and its stderr is
    // the only thing the user needs to see.
    if (response.compile && response.compile.code !== 0) {
      return {
        stdout: '',
        stderr: response.compile.stderr || 'Compilation failed.',
        exitCode: response.compile.code ?? 1,
        durationMs,
      };
    }

    const { stdout, stderr, code: exitCode, signal } = response.run;

    // Killed by Piston's own limits: `code` is null and a signal is set. Reporting this as exit 0
    // would be a lie — the program did not finish.
    if (exitCode === null) {
      throw new ExecutorError(
        `The sandbox killed the program (${signal ?? 'no exit code'}) — it likely exceeded the ${RUN_TIMEOUT_MS / 1000}s limit.`,
      );
    }

    return { stdout, stderr, exitCode, durationMs };
  }

  private async post(body: unknown): Promise<PistonResponse> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EXECUTOR_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ExecutorError(
          `The executor did not respond within ${EXECUTOR_TIMEOUT_MS / 1000}s.`,
        );
      }
      throw new ExecutorError('The executor is unreachable.');
    }

    if (response.status === 429) {
      throw new ExecutorError('Piston is rate limiting us. Give it a moment and try again.');
    }
    if (!response.ok) {
      throw new ExecutorError(`The executor is unavailable (HTTP ${response.status}).`);
    }

    const parsed = (await response.json().catch(() => null)) as PistonResponse | null;
    if (!parsed?.run) {
      throw new ExecutorError('The executor returned a response we could not read.');
    }

    return parsed;
  }
}
