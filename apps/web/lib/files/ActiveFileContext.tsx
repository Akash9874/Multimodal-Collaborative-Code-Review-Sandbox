'use client';

import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_FILE } from '@sandbox/shared';
import { useFiles } from '@/lib/yjs/useFiles';

type ActiveFileContextValue = {
  activeFileId: string;
  setActiveFileId: (id: string) => void;
};

const ActiveFileContext = createContext<ActiveFileContextValue | null>(null);

export const useActiveFile = (): ActiveFileContextValue => {
  const value = useContext(ActiveFileContext);
  if (!value) throw new Error('useActiveFile must be used inside <ActiveFileProvider>');
  return value;
};

/**
 * Which tab you are on is yours, not the room's — this is deliberately client-local state and
 * never a Y.Doc write. Putting it in the doc would mean one person's tab click moves everyone
 * else's editor. It is published to awareness (see CodeEditor), which is the difference between
 * telling people where you are and moving them.
 */
export function ActiveFileProvider({ children }: { children: ReactNode }) {
  const files = useFiles();
  const [activeFileId, setActiveFileId] = useState<string>(DEFAULT_FILE.id);

  // Someone else deleted the file you were on: fall back to the leftmost survivor.
  useEffect(() => {
    if (files.length === 0) return;
    if (!files.some((file) => file.id === activeFileId)) setActiveFileId(files[0]!.id);
  }, [files, activeFileId]);

  const value = useMemo(() => ({ activeFileId, setActiveFileId }), [activeFileId]);

  return <ActiveFileContext.Provider value={value}>{children}</ActiveFileContext.Provider>;
}
