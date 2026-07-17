'use client';

import { useEffect, useState } from 'react';
import type { FileMeta } from '@sandbox/shared';
import { getFilesMap, listFiles } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** Every file in the room, creation-ordered, re-read whenever anyone adds, renames, or deletes one. */
export const useFiles = (): FileMeta[] => {
  const { doc } = useRoomContext();
  const [files, setFiles] = useState<FileMeta[]>(() => listFiles(doc));

  useEffect(() => {
    const map = getFilesMap(doc);
    const read = () => setFiles(listFiles(doc));

    read();
    map.observe(read);
    return () => map.unobserve(read);
  }, [doc]);

  return files;
};
