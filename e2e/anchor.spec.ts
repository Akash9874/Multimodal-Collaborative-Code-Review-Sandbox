import { type Page, expect, test } from '@playwright/test';
import { join } from './helpers';

/** The rendered top edge of the first stroke, in viewport pixels. */
const strokeTop = async (page: Page) => {
  const box = await page.getByTestId('stroke').first().boundingBox();
  return box!.y;
};

const drawBox = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const canvas = page.getByTestId('canvas');
  const area = (await canvas.boundingBox())!;
  await page.mouse.move(area.x + from.x, area.y + from.y);
  await page.mouse.down();
  await page.mouse.move(area.x + to.x, area.y + to.y, { steps: 8 });
  await page.mouse.up();
};

const annotate = async (page: Page) => {
  await page.getByTestId('mode-toggle').click();
  await page.getByTestId('tool-rect').click();
  await drawBox(page, { x: 60, y: 120 }, { x: 280, y: 175 });
  await expect(page.getByTestId('stroke')).toHaveCount(1);
  await page.getByTestId('mode-toggle').click(); // back to Code mode
};

/** Ten lines at the very top. Ten 19px lines is ~190px of travel. */
const insertTenLinesAbove = async (page: Page) => {
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');
};

test('an annotation follows its code when lines are inserted above it', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await annotate(page);
  const before = await strokeTop(page);

  await insertTenLinesAbove(page);

  // The annotation travelled down with the code it describes.
  await expect
    .poll(async () => (await strokeTop(page)) - before, { timeout: 10_000 })
    .toBeGreaterThan(100);

  await expect(page.getByTestId('stroke')).not.toHaveAttribute('data-orphaned', 'true');
});

test('deleting the annotated code dims the annotation instead of moving it somewhere wrong', async ({
  page,
}) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await annotate(page);

  await page.locator('.monaco-editor').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');

  // Still on screen, and visibly no longer attached to anything.
  await expect(page.getByTestId('stroke')).toHaveCount(1);
  await expect(page.getByTestId('stroke')).toHaveAttribute('data-orphaned', 'true', {
    timeout: 10_000,
  });
});

test('a second person sees the annotation move without touching it', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await annotate(alice);
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  const bobBefore = await strokeTop(bob);

  // Bob types; Alice's drawing is the thing that moves on Bob's screen. Nobody rewrote the anchor.
  await insertTenLinesAbove(bob);

  await expect
    .poll(async () => (await strokeTop(bob)) - bobBefore, { timeout: 10_000 })
    .toBeGreaterThan(100);

  await aliceCtx.close();
  await bobCtx.close();
});
