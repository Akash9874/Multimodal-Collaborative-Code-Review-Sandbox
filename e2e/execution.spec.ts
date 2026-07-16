import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('pressing Run shows the output in the terminal', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('terminal')).toBeVisible();
  await page.getByTestId('run').click();

  // The seeded file is FizzBuzz. Piston actually runs it.
  await expect(page.getByTestId('terminal')).toContainText('FizzBuzz', { timeout: 30_000 });
  await expect(page.getByTestId('terminal')).toContainText('exited 0');
});

test('one person runs, and the other person sees the output', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.getByTestId('run').click();

  // Bob pressed nothing, and Bob sees the output. This is the phase.
  // (Attribution — "Alice ran main.py" — is asserted in the stdin test below, where the run's output
  // is one line and the header stays inside xterm's rendered viewport rather than scrolling out of it.)
  await expect(bob.getByTestId('terminal')).toContainText('FizzBuzz', { timeout: 30_000 });
  await expect(bob.getByTestId('terminal')).toContainText('exited 0');

  await aliceContext.close();
  await bobContext.close();
});

test('stdin reaches the program, and the room can see what it was', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await alice.locator('.monaco-editor').click();
  await alice.keyboard.press('ControlOrMeta+A');
  await alice.keyboard.type('print(f"hello {input()}")');

  await alice.getByLabel('Standard input').fill('world');
  await alice.getByTestId('run').click();

  await expect(bob.getByTestId('terminal')).toContainText('hello world', { timeout: 30_000 });
  // Bob sees who ran it, and — since Bob did not type the input — what it was fed.
  await expect(bob.getByTestId('terminal')).toContainText('Alice ran main.py');
  await expect(bob.getByTestId('terminal')).toContainText('stdin: world');

  await aliceContext.close();
  await bobContext.close();
});
