import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('edits made offline merge with the room on reconnect', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('connection-pill').click();
  await expect(alice.getByTestId('connection-pill')).toHaveAttribute('data-offline', 'true');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# written while offline');
  await expect(alice.getByTestId('connection-pill')).toContainText(/local edit/);

  // Bob is still connected and must not see it yet — otherwise "offline" meant nothing.
  await expect(bob.locator('.monaco-editor')).not.toContainText('written while offline');

  // Bob edits meanwhile, so the reconnect is a real merge of two divergent docs rather than a
  // one-way replay.
  await bob.locator('.monaco-editor').click();
  await bob.keyboard.press('Control+End');
  await bob.keyboard.type('# written while Alice was away');

  await alice.getByTestId('connection-pill').click();

  await expect(alice.locator('.monaco-editor')).toContainText('written while Alice was away', {
    timeout: 15_000,
  });
  await expect(bob.locator('.monaco-editor')).toContainText('written while offline', {
    timeout: 15_000,
  });

  await aliceCtx.close();
  await bobCtx.close();
});

test('Run is disabled while you are offline', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');
  await expect(page.getByTestId('run')).toBeEnabled();

  await page.getByTestId('connection-pill').click();
  await expect(page.getByTestId('run')).toBeDisabled();

  await page.getByTestId('connection-pill').click();
  await expect(page.getByTestId('run')).toBeEnabled({ timeout: 15_000 });
});
