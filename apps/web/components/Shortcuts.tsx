'use client';

import { useEffect, useState } from 'react';
import { type Tool, useCanvas } from '@/lib/canvas/CanvasContext';

const TOOL_KEYS: Record<string, Tool> = {
  p: 'freehand',
  a: 'arrow',
  r: 'rect',
  t: 'text',
  e: 'eraser',
};

/**
 * Single-letter keys must never fire while focus is in a text field, or typing `probe.py` into the
 * rename box would trigger pen, then rect, then text.
 */
const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
};

export function Shortcuts() {
  const { mode, setMode, setTool } = useCanvas();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setMode(mode === 'draw' ? 'code' : 'draw');
        return;
      }

      if (event.key === '?') {
        setShowHelp((open) => !open);
        return;
      }

      if (event.key === 'Escape') {
        if (showHelp) setShowHelp(false);
        else if (mode === 'draw') setMode('code');
        return;
      }

      // Tool keys belong to Draw mode alone; in Code mode they are just letters.
      if (mode === 'draw' && !event.ctrlKey && !event.metaKey) {
        const tool = TOOL_KEYS[event.key.toLowerCase()];
        if (tool) {
          event.preventDefault();
          setTool(tool);
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode, setMode, setTool, showHelp]);

  if (!showHelp) return null;

  return (
    <div
      data-testid="shortcuts"
      className="absolute right-4 top-16 z-50 rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-300 shadow-xl"
    >
      <p className="mb-2 font-semibold text-white">Shortcuts</p>
      <ul className="space-y-1">
        <li>
          <kbd>Ctrl/Cmd</kbd> + <kbd>Enter</kbd> — Run
        </li>
        <li>
          <kbd>Ctrl/Cmd</kbd> + <kbd>B</kbd> — Code / Draw
        </li>
        <li>
          <kbd>P</kbd> <kbd>A</kbd> <kbd>R</kbd> <kbd>T</kbd> <kbd>E</kbd> — pen, arrow, box, text,
          erase
        </li>
        <li>
          <kbd>Esc</kbd> — leave Draw mode
        </li>
        <li>
          <kbd>?</kbd> — this list
        </li>
      </ul>
    </div>
  );
}
