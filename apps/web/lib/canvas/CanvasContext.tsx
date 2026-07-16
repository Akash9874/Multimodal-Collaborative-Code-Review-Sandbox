'use client';

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';
import type { User } from '@sandbox/shared';

export type Mode = 'code' | 'draw';
export type Tool = 'freehand' | 'arrow' | 'rect' | 'text' | 'eraser';

type CanvasContextValue = {
  mode: Mode;
  setMode: (mode: Mode) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  user: User;
};

const CanvasContext = createContext<CanvasContextValue | null>(null);

export const useCanvas = (): CanvasContextValue => {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('useCanvas must be used inside <CanvasProvider>');
  return value;
};

export function CanvasProvider({ user, children }: { user: User; children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('code');
  const [tool, setTool] = useState<Tool>('freehand');

  const value = useMemo(() => ({ mode, setMode, tool, setTool, user }), [mode, tool, user]);

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
