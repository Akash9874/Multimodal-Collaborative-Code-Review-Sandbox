/**
 * Install the runtimes our code pins, into the self-hosted Piston.
 *
 * The versions are read from @sandbox/shared rather than restated here: PISTON_RUNTIMES is the
 * single source of truth, and a container holding python 3.11 while the code asks for 3.10 fails
 * at run time with a message about neither.
 */
import { PISTON_RUNTIMES } from '../../packages/shared/dist/index.js';

const BASE = process.env.PISTON_URL ?? 'http://localhost:2000/api/v2';

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

const installed = async () => {
  const response = await fetch(`${BASE}/runtimes`);
  const runtimes = await response.json();
  return new Set(runtimes.map((runtime) => `${runtime.language}@${runtime.version}`));
};

await waitForPiston();

const present = await installed();

for (const { language, version } of Object.values(PISTON_RUNTIMES)) {
  const key = `${language}@${version}`;

  if (present.has(key)) {
    console.log(`✓ ${key} already installed`);
    continue;
  }

  console.log(`↓ installing ${key} — this pulls a package and is slow the first time`);

  const response = await fetch(`${BASE}/packages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language, version }),
  });

  if (!response.ok) {
    console.error(`✗ ${key} failed: HTTP ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  console.log(`✓ ${key}`);
}

// Prove it end to end, rather than trusting the install endpoint's word for it.
const smoke = await fetch(`${BASE}/execute`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    language: PISTON_RUNTIMES.python.language,
    version: PISTON_RUNTIMES.python.version,
    files: [{ name: 'main.py', content: 'print(6*7)' }],
    stdin: '',
    run_timeout: 5_000,
  }),
});

const result = await smoke.json();

if (result?.run?.stdout?.trim() !== '42') {
  console.error('✗ piston is up but cannot run python:', JSON.stringify(result));
  process.exit(1);
}

console.log('\npiston is ready. Point the server at it with:');
console.log(`  PISTON_URL=${BASE}`);
