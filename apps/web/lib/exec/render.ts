import type { RunRecord } from '@sandbox/shared';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** xterm needs CRLF. A bare LF moves down a line without returning to column 0 — a staircase. */
const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

const trimTrailingNewline = (text: string): string => text.replace(/\r?\n$/, '');

const renderRun = (run: RunRecord): string => {
  const stdin = run.stdin ? `${DIM}  ◂ stdin: ${run.stdin.split('\n')[0]}${RESET}` : '';
  const lines = [`${DIM}▸${RESET} ${BOLD}${run.byUser.name}${RESET} ran ${run.fileName}${stdin}`];

  if (run.stdout) lines.push(crlf(trimTrailingNewline(run.stdout)));
  if (run.stderr) lines.push(`${RED}${crlf(trimTrailingNewline(run.stderr))}${RESET}`);

  if (run.error) {
    lines.push(`${RED}✗ ${run.error}${RESET}`);
  } else if (run.exitCode === null) {
    lines.push(`${DIM}… running${RESET}`);
  } else {
    const ok = run.exitCode === 0;
    const mark = ok ? `${GREEN}✓` : `${RED}✗`;
    lines.push(`${mark} exited ${run.exitCode} in ${run.durationMs}ms${RESET}`);
  }

  return lines.join('\r\n');
};

/** The whole scrollback, rendered from state. See Terminal.tsx for why it is rendered whole. */
export const renderRuns = (runs: RunRecord[], notice: string | null): string => {
  const blocks = runs.map(renderRun);
  if (notice) blocks.push(`${RED}✗ ${notice}${RESET}`);

  // An empty console that says nothing cannot be told from one that is still loading. run:history
  // is always sent precisely so this state is knowable.
  if (blocks.length === 0) return `${DIM}No runs yet — press Ctrl/Cmd + Enter${RESET}\r\n`;

  return `${blocks.join('\r\n\r\n')}\r\n`;
};
