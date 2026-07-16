'use client';

import { nanoid } from 'nanoid';
import { useRouter } from 'next/navigation';
import { ROOM_ID_LENGTH } from '@sandbox/shared';

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Multimodal Collaborative Sandbox</h1>
      <p className="max-w-md text-center text-neutral-400">
        Create a room, share the URL, and write code together in real time.
      </p>
      <button
        type="button"
        data-testid="create-room"
        onClick={() => router.push(`/s/${nanoid(ROOM_ID_LENGTH)}`)}
        className="rounded-md bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
      >
        Create a sandbox
      </button>
    </main>
  );
}
