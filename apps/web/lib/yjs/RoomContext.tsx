'use client';

import { type ReactNode, createContext, useContext, useEffect } from 'react';
import { DEFAULT_FILE, type User } from '@sandbox/shared';
import type { RoomHandle } from './room';
import { type ConnectionStatus, useRoom } from './useRoom';

const RoomContext = createContext<RoomHandle | null>(null);

export const useRoomContext = (): RoomHandle => {
  const handle = useContext(RoomContext);
  if (!handle) throw new Error('useRoomContext must be used inside <RoomProvider>');
  return handle;
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

  useEffect(() => {
    if (!handle) return;
    handle.awareness.setLocalStateField('user', user);
    handle.awareness.setLocalStateField('activeFileId', DEFAULT_FILE.id);
  }, [handle, user]);

  if (!handle) return null;

  return <RoomContext.Provider value={handle}>{children(status)}</RoomContext.Provider>;
}
