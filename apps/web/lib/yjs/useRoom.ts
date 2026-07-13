'use client';

import { useEffect, useState } from 'react';
import { type RoomHandle, acquireRoom, releaseRoom } from './room';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const useRoom = (roomId: string) => {
  const [handle, setHandle] = useState<RoomHandle | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const acquired = acquireRoom(roomId);
    setHandle(acquired);
    setStatus(acquired.provider.wsconnected ? 'connected' : 'connecting');

    const onStatus = ({ status: next }: { status: string }) => {
      setStatus(next === 'connected' ? 'connected' : 'disconnected');
    };
    acquired.provider.on('status', onStatus);

    return () => {
      acquired.provider.off('status', onStatus);
      releaseRoom(roomId);
    };
  }, [roomId]);

  return { handle, status };
};
