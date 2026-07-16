'use client';

import { useEffect, useState } from 'react';
import type { FileMeta } from '@sandbox/shared';
import { getFilesMap } from '@sandbox/shared';
import { useRoomContext } from './RoomContext';

/** The file's metadata, re-read whenever anyone changes it — the language picker is a doc write. */
export const useFile = (fileId: string): FileMeta | undefined => {
  const { doc } = useRoomContext();
  const [file, setFile] = useState<FileMeta | undefined>(() => getFilesMap(doc).get(fileId));

  useEffect(() => {
    const files = getFilesMap(doc);
    const read = () => setFile(files.get(fileId));

    read();
    files.observe(read);
    return () => files.unobserve(read);
  }, [doc, fileId]);

  return file;
};
