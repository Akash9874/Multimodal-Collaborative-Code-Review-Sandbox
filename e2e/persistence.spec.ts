import { expect, test } from '@playwright/test';
import { join } from './helpers';

// A real reload needs Postgres; without it the room only ever lived in memory and this cannot pass.
test.skip(!process.env.DATABASE_URL, 'persistence e2e requires DATABASE_URL (Supabase)');

test('code and a drawing survive closing every tab and reopening the link', async ({ browser }) => {
  const roomId = `test-e2e-${Date.now().toString(36)}`;

  // Alice types into the editor and draws one stroke over it.
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await join(alice, roomId, 'Alice');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# persisted note');
  await expect(alice.locator('.monaco-editor')).toContainText('persisted note');

  await alice.getByTestId('mode-toggle').click(); // Draw mode
  const canvas = alice.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  await alice.mouse.move(box.x + 80, box.y + 60);
  await alice.mouse.down();
  await alice.mouse.move(box.x + 200, box.y + 90, { steps: 8 });
  await alice.mouse.up();
  await expect(alice.getByTestId('stroke')).toHaveCount(1);

  // Everyone leaves. Wait past the 2s grace so the room flushes to Postgres and evicts from memory.
  await aliceCtx.close();
  await new Promise((resolve) => setTimeout(resolve, 4000));

  // A fresh person opens the same link — the server reloads the room from Postgres.
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await join(bob, roomId, 'Bob');

  await expect(bob.locator('.monaco-editor')).toContainText('persisted note');
  await expect(bob.getByTestId('stroke')).toHaveCount(1);

  await bobCtx.close();
});
