'use client';

import { useEffect, useState } from 'react';
import type { AwarenessState } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';

export function PresenceBar() {
  const { awareness } = useRoomContext();
  const [users, setUsers] = useState<AwarenessState['user'][]>([]);

  useEffect(() => {
    const read = () => {
      const seen = new Map<string, AwarenessState['user']>();
      awareness.getStates().forEach((raw) => {
        const user = (raw as Partial<AwarenessState>).user;
        if (user) seen.set(user.id, user);
      });
      setUsers([...seen.values()]);
    };

    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);

  return (
    <div className="flex items-center -space-x-2">
      {users.map((user) => (
        <span
          key={user.id}
          data-testid="presence-avatar"
          title={user.name}
          style={{ backgroundColor: user.color }}
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-neutral-950 text-xs font-semibold text-neutral-900"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
