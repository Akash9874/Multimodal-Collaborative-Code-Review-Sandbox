'use client';

import { type ReactNode, createContext, useContext, useEffect } from 'react';
import type { User } from '@sandbox/shared';
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

  // activeFileId is published by CodeEditor, which is inside ActiveFileProvider and knows it.
  useEffect(() => {
    if (!handle) return;
    handle.awareness.setLocalStateField('user', user);
  }, [handle, user]);

  if (!handle) return null;

  return <RoomContext.Provider value={handle}>{children(status)}</RoomContext.Provider>;
}
