'use client';

import { createFile, deleteFile, getStrokes, renameFile, validateFileName } from '@sandbox/shared';
import { useState } from 'react';
import { useActiveFile } from '@/lib/files/ActiveFileContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { useFiles } from '@/lib/yjs/useFiles';

function NameInput({
  draftName,
  setDraftName,
  commit,
  cancel,
  error,
}: {
  draftName: string;
  setDraftName: (value: string) => void;
  commit: () => void;
  cancel: () => void;
  error: string | null;
}) {
  return (
    <div className="relative">
      <input
        aria-label="File name"
        data-testid="file-name-input"
        autoFocus
        value={draftName}
        placeholder="name.py"
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') cancel();
        }}
        className="w-32 rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 text-sm text-white"
      />
      {error && (
        <p
          role="alert"
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-red-950 px-2 py-1 text-xs text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function FileTabs() {
  const { doc } = useRoomContext();
  const files = useFiles();
  const { activeFileId, setActiveFileId } = useActiveFile();

  // The id being renamed, or 'new' while creating. One input serves both.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setEditing(null);
    setError(null);
  };

  const startCreate = () => {
    setEditing('new');
    setDraftName('');
    setError(null);
  };

  const startRename = (id: string, name: string) => {
    setEditing(id);
    setDraftName(name);
    setError(null);
  };

  const commit = () => {
    if (!editing) return;

    // A rename must not collide with itself.
    const others = files.filter((file) => file.id !== editing).map((file) => file.name);
    const problem = validateFileName(draftName, others);
    if (problem) {
      setError(problem);
      return;
    }

    const name = draftName.trim();
    // The id is generated here, not in @sandbox/shared — that package has no `crypto`.
    if (editing === 'new') setActiveFileId(createFile(doc, name, crypto.randomUUID()));
    else renameFile(doc, editing, name);

    cancel();
  };

  const remove = (id: string, name: string) => {
    // Deleting destroys someone else's text and annotations, and a CRDT cannot make that safe:
    // delete-vs-concurrent-edit is lossy by nature. The confirm is the guard, and the stroke
    // count is the part people do not expect.
    const count = getStrokes(doc)
      .toArray()
      .filter((stroke) => stroke.fileId === id).length;
    const drawings = count === 1 ? '1 drawing' : `${count} drawings`;

    if (window.confirm(`Delete ${name}? Its text and ${drawings} are gone for everyone.`)) {
      deleteFile(doc, id);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-neutral-800 px-4 py-1">
      {files.map((file) => {
        if (editing === file.id) {
          return (
            <NameInput
              key={file.id}
              {...{ draftName, setDraftName, commit, cancel, error }}
            />
          );
        }

        const active = file.id === activeFileId;

        return (
          <div
            key={file.id}
            data-testid="file-tab"
            className={`flex items-center gap-1 rounded-t-md px-3 py-1 text-sm ${
              active ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <button
              type="button"
              data-testid={`file-tab-${file.id}`}
              onClick={() => setActiveFileId(file.id)}
              onDoubleClick={() => startRename(file.id, file.name)}
              title="Double-click to rename"
            >
              {file.name}
            </button>

            {active && (
              <button
                type="button"
                data-testid="rename-file"
                aria-label={`Rename ${file.name}`}
                onClick={() => startRename(file.id, file.name)}
                className="text-neutral-500 hover:text-neutral-200"
              >
                ✎
              </button>
            )}

            <button
              type="button"
              data-testid="delete-file"
              aria-label={`Delete ${file.name}`}
              // A room with no files has no editor to render and no way back.
              disabled={files.length === 1}
              onClick={() => remove(file.id, file.name)}
              className="text-neutral-500 hover:text-red-400 disabled:invisible"
            >
              ×
            </button>
          </div>
        );
      })}

      {editing === 'new' && <NameInput {...{ draftName, setDraftName, commit, cancel, error }} />}

      <button
        type="button"
        data-testid="new-file"
        aria-label="New file"
        onClick={startCreate}
        className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
      >
        +
      </button>
    </div>
  );
}
