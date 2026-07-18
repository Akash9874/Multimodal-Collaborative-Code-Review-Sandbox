/**
 * Records the Phase 5 proof: draw over a block, insert lines above it, watch the annotation follow.
 *
 * Playwright emits .webm. GIF conversion needs ffmpeg, which may not be installed — so the video is
 * written unconditionally and the conversion is attempted separately. A missing ffmpeg costs you
 * the GIF, not the recording.
 *
 * Usage: pnpm dev, then `node scripts/record-demo.mjs`
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const OUT = 'Docs/media';
const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();

await page.goto(`${BASE}/s/demo${Date.now().toString(36)}`);
await page.getByLabel('Display name').fill('Ada');
await page.getByRole('button', { name: 'Join sandbox' }).click();
await page.waitForSelector('.monaco-editor');
await page.waitForTimeout(1500);

// Draw a box over the function.
await page.getByTestId('mode-toggle').click();
await page.getByTestId('tool-rect').click();
// Near the top of the file on purpose: ten inserted lines push the box ~190px down, and anywhere
// lower it would leave the editor viewport before the recording ends — no travel, no proof.
const canvas = await page.getByTestId('canvas').boundingBox();
await page.mouse.move(canvas.x + 60, canvas.y + 25);
await page.mouse.down();
await page.mouse.move(canvas.x + 300, canvas.y + 75, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(1200);

// Insert lines above it — the annotation travels down with its code.
await page.getByTestId('mode-toggle').click();
await page.locator('.monaco-editor').click();
await page.keyboard.press('Control+Home');
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(2000);

await context.close();
await browser.close();

const video = readdirSync(OUT)
  .filter((f) => f.endsWith('.webm'))
  .sort()
  .pop();
const target = join(OUT, 'anchor-demo.webm');
rmSync(target, { force: true });
renameSync(join(OUT, video), target);
console.log(`✓ ${target}`);

try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      target,
      '-vf',
      'fps=12,scale=960:-1:flags=lanczos',
      join(OUT, 'anchor-demo.gif'),
    ],
    { stdio: 'ignore' },
  );
  console.log(`✓ ${OUT}/anchor-demo.gif`);
} catch {
  console.log('! ffmpeg not found — keeping the .webm. Install ffmpeg and rerun for a GIF.');
}
