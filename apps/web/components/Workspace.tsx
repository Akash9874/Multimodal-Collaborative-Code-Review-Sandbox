'use client';

export function Workspace({ roomId }: { roomId: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold">Sandbox</span>
        <code data-testid="room-id" className="rounded bg-neutral-800 px-2 py-0.5 text-sm">
          {roomId}
        </code>
      </header>
      <main className="min-h-0 flex-1" />
    </div>
  );
}
