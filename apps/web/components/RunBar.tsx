'use client';

import { DEFAULT_FILE, LANGUAGES, type LanguageId, MAX_STDIN_BYTES, setFileLanguage } from '@sandbox/shared';
import { useExecContext } from '@/lib/exec/ExecContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFile } from '@/lib/yjs/useFile';

export function RunBar() {
  const { doc } = useRoomContext();
  const { runActiveFile, isRunning, status, stdin, setStdin } = useExecContext();
  const file = useFile(DEFAULT_FILE.id);

  const offline = status !== 'connected';
  const disabled = offline || isRunning || !file;

  const label = offline ? 'Offline' : isRunning ? 'Running…' : 'Run';

  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
      <code className="text-sm text-neutral-400">{file?.name ?? '—'}</code>

      <select
        aria-label="Language"
        value={file?.language ?? 'python'}
        disabled={!file}
        onChange={(event) => setFileLanguage(doc, DEFAULT_FILE.id, event.target.value as LanguageId)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      >
        {Object.entries(LANGUAGES).map(([id, language]) => (
          <option key={id} value={id}>
            {language.label}
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
        title="Ctrl/Cmd + Enter"
        className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        ▶ {label}
      </button>
    </div>
  );
}
