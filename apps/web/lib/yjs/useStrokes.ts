'use client';

import { useEffect, useState } from 'react';
import { type Stroke, getStrokes } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** The strokes for one file, re-read whenever anyone draws, erases, or undoes. */
export const useStrokes = (fileId: string): Stroke[] => {
  const { doc } = useRoomContext();
  const [strokes, setStrokes] = useState<Stroke[]>(() =>
    getStrokes(doc).toArray().filter((s) => s.fileId === fileId),
  );

  useEffect(() => {
    const array = getStrokes(doc);
    const read = () => setStrokes(array.toArray().filter((s) => s.fileId === fileId));

    read();
    array.observe(read);
    return () => array.unobserve(read);
  }, [doc, fileId]);

  return strokes;
};
