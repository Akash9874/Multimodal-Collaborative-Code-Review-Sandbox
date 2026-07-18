'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User } from '@sandbox/shared';
import type { RoomHandle } from './room';
import { type ConnectionStatus, useRoom } from './useRoom';

type RoomContextValue = RoomHandle & {
  isOffline: boolean;
  setOffline: (next: boolean) => void;
  pendingUpdates: number;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export const useRoomContext = (): RoomContextValue => {
  const value = useContext(RoomContext);
  if (!value) throw new Error('useRoomContext must be used inside <RoomProvider>');
  return value;
};

export function RoomProvider({
  roomId,
  user,
  children,
}: {
  roomId: string;
  user: User;
  children: (status: ConnectionStatus) => ReactNode;
}) {
  const { handle, status } = useRoom(roomId);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState(0);

  // activeFileId is published by CodeEditor, which is inside ActiveFileProvider and knows it.
  useEffect(() => {
    if (!handle) return;
    handle.awareness.setLocalStateField('user', user);
  }, [handle, user]);

  /**
   * A deliberate disconnect, so convergence can be demonstrated on purpose rather than by pulling
   * a network cable. Client-local and never a doc write — the rule activeFileId follows, for the
   * same reason: one person's demo must not disconnect the room.
   */
  const setOffline = useCallback(
    (next: boolean) => {
      if (!handle) return;
      setIsOffline(next);
      if (next) {
        handle.provider.disconnect();
      } else {
        setPendingUpdates(0);
        handle.provider.connect();
      }
    },
    [handle],
  );

  // Count local edits made while disconnected. Without a number, a successful merge on reconnect
  // is indistinguishable from nothing having happened. Updates carrying the provider as their
  // origin came from the network, so they are not local and are not counted.
  useEffect(() => {
    if (!handle || !isOffline) return;

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== handle.provider) setPendingUpdates((count) => count + 1);
    };
    handle.doc.on('update', onUpdate);
    return () => handle.doc.off('update', onUpdate);
  }, [handle, isOffline]);

  const value = useMemo(
    () => (handle ? { ...handle, isOffline, setOffline, pendingUpdates } : null),
    [handle, isOffline, setOffline, pendingUpdates],
  );

  if (!value) return null;

  return <RoomContext.Provider value={value}>{children(status)}</RoomContext.Provider>;
}
