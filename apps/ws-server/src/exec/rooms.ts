import { WebSocket } from 'ws';

export const send = (conn: WebSocket, message: string): void => {
  if (conn.readyState !== WebSocket.OPEN) return;
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
};

/**
 * The exec channel's connections for one room — and nothing else. Run history lives in the
 * RunStore, which is why this needs no grace period: there is nothing here worth preserving
 * across a refresh. (The sync Room needs its 30s grace because it holds the Y.Doc itself.)
 */
export class ExecRoom {
  private readonly connections = new Set<WebSocket>();

  constructor(readonly id: string) {}

  get size(): number {
    return this.connections.size;
  }

  add(conn: WebSocket): void {
    this.connections.add(conn);
  }

  remove(conn: WebSocket): void {
    this.connections.delete(conn);
  }

  broadcast(message: string): void {
    for (const conn of this.connections) send(conn, message);
  }
}

const execRooms = new Map<string, ExecRoom>();

export const getOrCreateExecRoom = (id: string): ExecRoom => {
  let room = execRooms.get(id);
  if (!room) {
    room = new ExecRoom(id);
    execRooms.set(id, room);
  }
  return room;
};

export const releaseExecRoom = (room: ExecRoom): void => {
  if (room.size === 0) execRooms.delete(room.id);
};

export const execRoomCount = (): number => execRooms.size;

export const resetExecRooms = (): void => execRooms.clear();
