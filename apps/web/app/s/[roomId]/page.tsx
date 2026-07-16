import { notFound } from 'next/navigation';
import { isValidRoomId } from '@sandbox/shared';
import { Workspace } from '@/components/Workspace';

export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  return <Workspace roomId={roomId} />;
}
