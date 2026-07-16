'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { DEFAULT_FILE, type User, getFileText, getFilesMap } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';
import { type ExecSocket, type ExecStatus, acquireExec, releaseExec } from './socket';
import { EMPTY_EXEC_STATE, type ExecState, applyExecMessage } from './state';

type ExecContextValue = ExecState & {
  status: ExecStatus;
  isRunning: boolean;
  stdin: string;
  setStdin: (value: string) => void;
  runActiveFile: () => void;
};

const ExecContext = createContext<ExecContextValue | null>(null);

export const useExecContext = (): ExecContextValue => {
  const value = useContext(ExecContext);
  if (!value) throw new Error('useExecContext must be used inside <ExecProvider>');
  return value;
};

export function ExecProvider({ roomId, user, children }: { roomId: string; user: User; children: ReactNode }) {
  const { doc } = useRoomContext();
  const [state, setState] = useState<ExecState>(EMPTY_EXEC_STATE);
  const [status, setStatus] = useState<ExecStatus>('connecting');
  const [stdin, setStdin] = useState('');
  const socket = useRef<ExecSocket | null>(null);

  useEffect(() => {
    const acquired = acquireExec(roomId);
    socket.current = acquired;
    setStatus(acquired.status);

    const unsubscribe = acquired.subscribe((message) =>
      setState((current) => applyExecMessage(current, message)),
    );
    const unwatch = acquired.watchStatus(setStatus);

    return () => {
      unsubscribe();
      unwatch();
      releaseExec(roomId);
    };
  }, [roomId]);

  const runActiveFile = useCallback(() => {
    const file = getFilesMap(doc).get(DEFAULT_FILE.id);
    if (!file) return;

    // The snapshot the presser currently sees. The server never reads the CRDT.
    socket.current?.send({
      type: 'run',
      byUser: user,
      fileName: file.name,
      language: file.language,
      code: getFileText(doc, DEFAULT_FILE.id).toString(),
      stdin,
    });
  }, [doc, stdin, user]);

  const isRunning = state.runs.some((run) => run.exitCode === null && !run.error);

  return (
    <ExecContext.Provider
      value={{ ...state, status, isRunning, stdin, setStdin, runActiveFile }}
    >
      {children}
    </ExecContext.Provider>
  );
}
