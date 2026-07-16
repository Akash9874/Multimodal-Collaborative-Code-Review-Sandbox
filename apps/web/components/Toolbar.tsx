'use client';

import { undoLastStrokeBy } from '@sandbox/shared';
import { type Tool, useCanvas } from '@/lib/canvas/CanvasContext';
import { useRoomContext } from '@/lib/yjs/RoomContext';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'freehand', label: '✎ Pen' },
  { id: 'arrow', label: '↗ Arrow' },
  { id: 'rect', label: '▭ Box' },
  { id: 'text', label: 'T Text' },
  { id: 'eraser', label: '⌫ Erase' },
];

export function Toolbar() {
  const { doc } = useRoomContext();
  const { mode, setMode, tool, setTool, user } = useCanvas();

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2">
      <button
        type="button"
        data-testid="mode-toggle"
        onClick={() => setMode(mode === 'draw' ? 'code' : 'draw')}
        className={`rounded-md px-3 py-1 text-sm font-medium ${
          mode === 'draw' ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-200'
        }`}
      >
        {mode === 'draw' ? '✎ Drawing' : '✎ Draw'}
      </button>

      <div className="flex items-center gap-1" aria-disabled={mode !== 'draw'}>
        {TOOLS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-testid={`tool-${id}`}
            disabled={mode !== 'draw'}
            onClick={() => setTool(id)}
            className={`rounded-md px-2 py-1 text-sm ${
              tool === id ? 'bg-neutral-700 text-white' : 'text-neutral-400'
            } disabled:opacity-40`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="undo"
        disabled={mode !== 'draw'}
        onClick={() => undoLastStrokeBy(doc, user.id)}
        className="rounded-md px-2 py-1 text-sm text-neutral-400 disabled:opacity-40"
      >
        ↶ Undo
      </button>
    </div>
  );
}
