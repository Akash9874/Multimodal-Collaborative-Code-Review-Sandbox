/**
 * Install the runtimes our code pins, into the self-hosted Piston.
 *
 * The versions are read from @sandbox/shared rather than restated here: PISTON_RUNTIMES is the
 * single source of truth, and a container holding python 3.11 while the code asks for 3.10 fails
 * at run time with a message about neither.
 */
import { PISTON_RUNTIMES } from '../../packages/shared/dist/index.js';

const BASE = process.env.PISTON_URL ?? 'http://localhost:2000/api/v2';

/**
 * Piston has two namespaces and they do not agree. The *package* you install is `node`; the
 * *runtime* you then execute is `javascript`. The versions match — the runtime version is the
 * package version — so only the name needs translating, and only here: the application never
 * installs a package, so this mapping has no business in @sandbox/shared.
 */
const PACKAGE_FOR = {
  python: 'python',
  javascript: 'node',
  typescript: 'typescript',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForPiston = async () => {
  process.stdout.write('waiting for piston');

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE}/runtimes`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        console.log(' — up');
        return;
      }
    } catch {
      // not listening yet
    }
    process.stdout.write('.');
    await sleep(2_000);
  }

  console.error('\npiston did not come up. Is Docker running? Try: pnpm piston:logs');
  process.exit(1);
};

/** What can actually be executed right now, in the execute namespace. */
const runnable = async () => {
  const response = await fetch(`${BASE}/runtimes`);
  const runtimes = await response.json();
  return new Set(runtimes.map((runtime) => `${runtime.language}@${runtime.version}`));
};

await waitForPiston();

let available = await runnable();

for (const [id, runtime] of Object.entries(PISTON_RUNTIMES)) {
  const key = `${runtime.language}@${runtime.version}`;

  if (available.has(key)) {
    console.log(`✓ ${key} already installed`);
    continue;
  }

  const packageName = PACKAGE_FOR[id];
  console.log(`↓ installing ${packageName}@${runtime.version} (runs as ${key}) — slow the first time`);

  const response = await fetch(`${BASE}/packages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: packageName, version: runtime.version }),
  });

  if (!response.ok) {
    console.error(`✗ ${packageName}@${runtime.version} failed: HTTP ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  console.log(`✓ ${key}`);
}

// Prove every language actually runs, rather than trusting the install endpoint's word for it.
// A smoke test of python alone would have missed that `javascript` installs under the name `node`.
available = await runnable();

const SMOKE = {
  python: { file: 'main.py', code: 'print(6*7)' },
  javascript: { file: 'main.js', code: 'console.log(6*7)' },
  typescript: { file: 'main.ts', code: 'const answer: number = 6 * 7; console.log(answer);' },
};

console.log();

for (const [id, runtime] of Object.entries(PISTON_RUNTIMES)) {
  const { file, code } = SMOKE[id];

  const response = await fetch(`${BASE}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      language: runtime.language,
      version: runtime.version,
      files: [{ name: file, content: code }],
      stdin: '',
      run_timeout: 5_000,
    }),
  });

  const result = await response.json();

  if (result?.run?.stdout?.trim() !== '42') {
    console.error(`✗ ${id} is installed but cannot run:`, JSON.stringify(result));
    process.exit(1);
  }

  console.log(`✓ ${id} runs`);
}

console.log('\npiston is ready. The server picks it up from:');
console.log(`  PISTON_URL=${BASE}`);
