import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import type { ExecMessage } from '@sandbox/shared';
import { ExecutorError, StubExecutor } from '../src/exec/executor';
import { resetExecRooms } from '../src/exec/rooms';
import { MemoryRunStore } from '../src/exec/runs';
import { createSandboxServer } from '../src/server';

let server: ReturnType<typeof createSandboxServer> | undefined;
let execUrl: string;
let clock = 0;
const sockets: WebSocket[] = [];

const OK = { stdout: '42\n', stderr: '', exitCode: 0, durationMs: 12 };

const RUN = {
  type: 'run' as const,
  byUser: { id: 'u1', name: 'Ada', color: '#f97316' },
  fileName: 'main.py',
  language: 'python' as const,
  code: 'print(6*7)',
  stdin: '',
};

const boot = async (executor: StubExecutor = new StubExecutor(OK)) => {
  clock = 0;
  server = createSandboxServer({ executor, store: new MemoryRunStore(), now: () => clock });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  execUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/exec`;
  return executor;
};

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close());
  resetExecRooms();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

/** Connect, and collect every message the server sends us. */
const connect = async (roomId: string) => {
  const socket = new WebSocket(`${execUrl}/${roomId}`);
  sockets.push(socket);

  const received: ExecMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ExecMessage));

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  return { socket, received };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const typesOf = (messages: ExecMessage[]) => messages.map((message) => message.type);

test('a fresh room is sent an empty history, so the terminal knows it has loaded', async () => {
  await boot();
  const ada = await connect('room-exec-a');
  await waitFor(() => ada.received.length > 0);

  expect(ada.received[0]).toEqual({ type: 'run:history', runs: [] });
});

test('one person runs, and BOTH people see the output', async () => {
  await boot();
  const ada = await connect('room-exec-b');
  const bob = await connect('room-exec-b');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));

  // This is the phase. Bob pressed nothing, and Bob sees the output.
  await waitFor(() => typesOf(bob.received).includes('run:done'));

  expect(typesOf(ada.received)).toEqual(['run:history', 'run:started', 'run:output', 'run:done']);
  expect(typesOf(bob.received)).toEqual(['run:history', 'run:started', 'run:output', 'run:done']);

  const output = bob.received.find((message) => message.type === 'run:output');
  expect(output).toMatchObject({ stream: 'stdout', chunk: '42\n' });
});

test('the executor is given the code the client sent — the server never reads the CRDT', async () => {
  const executor = await boot();

  const ada = await connect('room-exec-c');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  expect(executor.calls[0]).toEqual({
    language: 'python',
    fileName: 'main.py',
    code: 'print(6*7)',
    stdin: '',
  });
});

test('someone who joins late is replayed the runs they missed', async () => {
  await boot();
  const ada = await connect('room-exec-d');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  const carol = await connect('room-exec-d');
  await waitFor(() => carol.received.length > 0);

  const history = carol.received[0];
  expect(history?.type).toBe('run:history');
  expect(history).toMatchObject({
    runs: [{ fileName: 'main.py', stdout: '42\n', exitCode: 0 }],
  });
});

test('a second run inside the window is refused — and only the person refused hears about it', async () => {
  await boot();
  const ada = await connect('room-exec-e');
  const bob = await connect('room-exec-e');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  const bobBefore = bob.received.length;
  ada.socket.send(JSON.stringify(RUN)); // the clock has not moved: no token

  await waitFor(() => typesOf(ada.received).includes('run:error'));

  // Bob never heard of a run that never started. His terminal is not littered with it.
  expect(bob.received.length).toBe(bobBefore);
});

test('the token comes back once the clock moves on', async () => {
  await boot();
  const ada = await connect('room-exec-f');
  await waitFor(() => ada.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));
  await waitFor(() => typesOf(ada.received).includes('run:done'));

  clock += 2_000;
  ada.socket.send(JSON.stringify(RUN));

  await waitFor(() => typesOf(ada.received).filter((type) => type === 'run:done').length === 2);
  expect(typesOf(ada.received)).not.toContain('run:error');
});

test('an executor failure is broadcast — nobody is left watching a run that never ends', async () => {
  await boot(new StubExecutor(new ExecutorError('Piston is rate limiting us.')));

  const ada = await connect('room-exec-g');
  const bob = await connect('room-exec-g');
  await waitFor(() => ada.received.length > 0 && bob.received.length > 0);

  ada.socket.send(JSON.stringify(RUN));

  // Bob was told the run started, so Bob must be told it failed.
  await waitFor(() => typesOf(bob.received).includes('run:error'));
  expect(bob.received.at(-1)).toMatchObject({ message: 'Piston is rate limiting us.' });
});

test('a malformed message closes the socket rather than being coerced', async () => {
  await boot();
  const ada = await connect('room-exec-h');
  await waitFor(() => ada.received.length > 0);

  const closed = new Promise<number>((resolve) => ada.socket.once('close', resolve));
  ada.socket.send('{"type":"run","code":42}');

  expect(await closed).toBe(1003);
});

test('an invalid room id never allocates a room', async () => {
  await boot();
  const socket = new WebSocket(`${execUrl}/no`);
  sockets.push(socket);

  await expect(
    new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
  ).rejects.toThrow();
});
