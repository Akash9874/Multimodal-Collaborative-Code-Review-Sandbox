import { type Page, expect, test } from '@playwright/test';
import { join } from './helpers';

/** Draw a freehand stroke by dragging across the editor. Returns after pointer-up. */
const drawStroke = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const canvas = page.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
  await page.mouse.up();
};

test('one person draws over the code, and the other sees the same stroke', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click(); // enter Draw mode
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });

  // Bob drew nothing, and Bob sees the stroke.
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  // Content space, not screen space: the committed path is byte-identical for both viewers.
  const alicePath = await alice.getByTestId('stroke').locator('path').getAttribute('d');
  const bobPath = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  expect(bobPath).toBe(alicePath);

  await aliceCtx.close();
  await bobCtx.close();
});

test('the stroke stays pinned to its code when the reader scrolls', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click();
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  const before = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  // Bob scrolls the editor. The stroke's content-space path must not change — only the group's transform.
  await bob.mouse.move(400, 300);
  await bob.mouse.wheel(0, 200);
  const after = await bob.getByTestId('stroke').locator('path').getAttribute('d');
  expect(after).toBe(before);

  await aliceCtx.close();
  await bobCtx.close();
});

test('in Code mode the canvas does not eat keystrokes', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  // Default is Code mode. Type into the editor with the overlay present.
  await page.locator('.monaco-editor').click();
  await page.keyboard.type('# hello from a test');

  await expect(page.locator('.monaco-editor')).toContainText('hello from a test');
});

test('the live pen shows a peer\'s stroke before they release', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('mode-toggle').click();

  // Alice presses and moves but does NOT release.
  const canvas = alice.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await alice.mouse.move(box.x + 80, box.y + 60);
  await alice.mouse.down();
  await alice.mouse.move(box.x + 180, box.y + 90, { steps: 8 });

  // Bob sees a live draft path even though nothing has committed yet (no data-testid=stroke).
  await expect(bob.getByTestId('canvas').locator('path')).toHaveCount(1, { timeout: 10_000 });
  await expect(bob.getByTestId('stroke')).toHaveCount(0);

  await alice.mouse.up();
  // On release it commits and becomes a real stroke for both.
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  await aliceCtx.close();
  await bobCtx.close();
});

test('undo removes your own last stroke; the eraser removes by hit-test', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');
  await page.getByTestId('mode-toggle').click();

  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 60 });
  await drawStroke(page, { x: 80, y: 120 }, { x: 200, y: 120 });
  await expect(page.getByTestId('stroke')).toHaveCount(2);

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  // Erase the survivor by dragging the eraser across it.
  await page.getByTestId('tool-eraser').click();
  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 60 });
  await expect(page.getByTestId('stroke')).toHaveCount(0);
});
