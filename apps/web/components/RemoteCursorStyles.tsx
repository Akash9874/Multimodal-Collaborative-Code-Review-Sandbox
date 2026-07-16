'use client';

import { useEffect, useState } from 'react';
import type { AwarenessState } from '@sandbox/shared';
import { useRoomContext } from '@/lib/yjs/RoomContext';

export function RemoteCursorStyles() {
  const { awareness } = useRoomContext();
  const [css, setCss] = useState('');

  useEffect(() => {
    const render = () => {
      const rules: string[] = [];

      awareness.getStates().forEach((raw, clientId) => {
        if (clientId === awareness.clientID) return;
        const user = (raw as Partial<AwarenessState>).user;
        if (!user) return;

        // `user.name` is sanitized at the join gate; it cannot close this CSS string.
        rules.push(`
.yRemoteSelection-${clientId} { background-color: ${user.color}59; }
.yRemoteSelectionHead-${clientId} {
  position: absolute; box-sizing: border-box; height: 100%;
  border-left: 2px solid ${user.color};
}
.yRemoteSelectionHead-${clientId}::after {
  content: '${user.name}'; position: absolute; left: -2px; top: -1.4em;
  padding: 0 4px; font-size: 11px; line-height: 1.4em; white-space: nowrap;
  border-radius: 3px 3px 3px 0; color: #0a0a0a; background-color: ${user.color};
}`);
      });

      setCss(rules.join('\n'));
    };

    render();
    awareness.on('change', render);
    return () => awareness.off('change', render);
  }, [awareness]);

  return <style>{css}</style>;
}
