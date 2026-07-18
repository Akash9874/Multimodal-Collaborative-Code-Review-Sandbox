'use client';

import {
  LANGUAGES,
  type LanguageId,
  MAX_STDIN_BYTES,
  languageForName,
  renameExtension,
  renameFile,
} from '@sandbox/shared';
import { useExecContext } from '@/lib/exec/ExecContext';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

export function RunBar() {
  const { doc, isOffline } = useRoomContext();
  const { runActiveFile, isRunning, status, stdin, setStdin, executionEnabled } = useExecContext();
  const { activeFileId } = useActiveFile();
  const file = useFile(activeFileId);

  const language = file ? languageForName(file.name) : undefined;
  // A pill claiming offline while Run still works would undercut the thing being demonstrated.
  const offline = status !== 'connected' || isOffline;
  const disabled = offline || isRunning || !file || !language || !executionEnabled;

  const label = offline ? 'Offline' : isRunning ? 'Running…' : 'Run';
  // A dead button with no reason is worse than no button. Say why it cannot run. The hosted demo
  // has no executor at all, which is a different reason from "this file has no runtime".
  const title = !executionEnabled
    ? 'Execution is local-only — run pnpm piston:up'
    : file && !language
      ? `No runtime for ${file.name}`
      : 'Ctrl/Cmd + Enter';

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
      <code className="text-sm text-neutral-400">{file?.name ?? '—'}</code>

      {/* One write path: picking a language renames the file, and the language derives from that. */}
      <select
        aria-label="Language"
        value={language ?? ''}
        disabled={!file}
        onChange={(event) =>
          file &&
          renameFile(
            doc,
            file.id,
            renameExtension(file.name, LANGUAGES[event.target.value as LanguageId].extension),
          )
        }
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        {!language && <option value="">—</option>}
        {Object.entries(LANGUAGES).map(([id, lang]) => (
          <option key={id} value={id}>
            {lang.label}
          </option>
        ))}
      </select>

      <input
        aria-label="Standard input"
        value={stdin}
        onChange={(event) => setStdin(event.target.value.slice(0, MAX_STDIN_BYTES))}
        placeholder="stdin"
        className="w-48 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
      />

      <button
        type="button"
        data-testid="run"
        onClick={runActiveFile}
        disabled={disabled}
        title={title}
        className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        ▶ {label}
      </button>
    </div>
  );
}
