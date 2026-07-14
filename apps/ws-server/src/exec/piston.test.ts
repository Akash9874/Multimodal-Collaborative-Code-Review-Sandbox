import { afterEach, expect, test, vi } from 'vitest';
import { ExecutorError } from './executor';
import { PistonExecutor } from './piston';

const BASE = 'https://piston.test/api/v2/piston';

const respondWith = (body: unknown, status = 200) =>
  vi
    .fn()
    .mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );

const stage = (
  over: Partial<{ stdout: string; stderr: string; code: number | null; signal: string | null }> = {},
) => ({
  stdout: '',
  stderr: '',
  code: 0,
  signal: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a successful run returns stdout and the exit code', async () => {
  vi.stubGlobal('fetch', respondWith({ run: stage({ stdout: 'FizzBuzz\n', code: 0 }) }));

  const result = await new PistonExecutor(BASE).run({
    language: 'python',
    fileName: 'main.py',
    code: 'print("FizzBuzz")',
    stdin: '',
  });

  expect(result.stdout).toBe('FizzBuzz\n');
  expect(result.exitCode).toBe(0);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

test('the request pins the runtime version — `typescript` alone is ambiguous on Piston', async () => {
  const fetchMock = respondWith({ run: stage() });
  vi.stubGlobal('fetch', fetchMock);

  await new PistonExecutor(BASE).run({
    language: 'typescript',
    fileName: 'main.ts',
    code: 'console.log(1)',
    stdin: '',
  });

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(`${BASE}/execute`);

  const body = JSON.parse(init.body as string);
  expect(body.language).toBe('typescript');
  expect(body.version).toBe('5.0.3'); // the Node runtime, not Deno's 1.32.3
  expect(body.files).toEqual([{ name: 'main.ts', content: 'console.log(1)' }]);
});

test('a compile failure surfaces the compiler error, not an empty success', async () => {
  vi.stubGlobal(
    'fetch',
    respondWith({
      compile: stage({ stderr: "main.ts(1,1): error TS2304: Cannot find name 'nope'.", code: 2 }),
      run: stage(),
    }),
  );

  const result = await new PistonExecutor(BASE).run({
    language: 'typescript',
    fileName: 'main.ts',
    code: 'nope()',
    stdin: '',
  });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('TS2304');
});

test('a process killed by the sandbox is an error, never a silent exit 0', async () => {
  vi.stubGlobal('fetch', respondWith({ run: stage({ code: null, signal: 'SIGKILL' }) }));

  await expect(
    new PistonExecutor(BASE).run({
      language: 'python',
      fileName: 'main.py',
      code: 'while True: pass',
      stdin: '',
    }),
  ).rejects.toThrow(/SIGKILL|limit/i);
});

test('a 429 says so, so the terminal can explain itself', async () => {
  vi.stubGlobal('fetch', respondWith({}, 429));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/rate limit/i);
});

test('a 500 is reported as unavailable', async () => {
  vi.stubGlobal('fetch', respondWith({}, 500));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toBeInstanceOf(ExecutorError);
});

test('a body we cannot read is an error, not a crash', async () => {
  vi.stubGlobal('fetch', respondWith('<html>gateway</html>'));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/could not read/i);
});

test('a hung executor times out rather than hanging the room', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
  );

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/did not respond/i);
});

test('a network failure is reported, never swallowed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

  await expect(
    new PistonExecutor(BASE).run({ language: 'python', fileName: 'main.py', code: '', stdin: '' }),
  ).rejects.toThrow(/unreachable/i);
});
