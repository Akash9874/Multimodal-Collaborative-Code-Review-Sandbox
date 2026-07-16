import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('two people edit one document and see each other', async ({ browser }) => {
  const roomId = `c${Date.now().toString(36)}`;

  // Separate contexts, not tabs: contexts are isolated, so nothing can sync through
  // BroadcastChannel behind the server's back and hand us a false pass.
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await expect(alice.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(bob.getByTestId('presence-avatar')).toHaveCount(2);

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.press('ControlOrMeta+A');
  await alice.keyboard.type('alicewashere');
  await expect(bob.locator('.monaco-editor')).toContainText('alicewashere');

  await bob.locator('.monaco-editor').click();
  await bob.keyboard.press('End');
  await bob.keyboard.type('_and_bob');
  await expect(alice.locator('.monaco-editor')).toContainText('alicewashere_and_bob');

  // Bob's cursor is rendered inside Alice's editor.
  await expect(alice.locator('[class*="yRemoteSelectionHead"]').first()).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
