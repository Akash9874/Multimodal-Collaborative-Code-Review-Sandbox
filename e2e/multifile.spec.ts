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

const createFile = async (page: Page, name: string) => {
  await page.getByTestId('new-file').click();
  await page.getByTestId('file-name-input').fill(name);
  await page.getByTestId('file-name-input').press('Enter');
};

const renameActiveFile = async (page: Page, name: string) => {
  await page.getByTestId('rename-file').click();
  await page.getByTestId('file-name-input').fill(name);
  await page.getByTestId('file-name-input').press('Enter');
};

test('a file one person creates appears for the other', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await createFile(alice, 'utils.py');

  await expect(bob.getByTestId('file-tab')).toHaveCount(2, { timeout: 10_000 });
  await expect(bob.getByRole('button', { name: 'utils.py', exact: true })).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});

test('each file keeps its own text and its own drawings', async ({ browser }) => {
  const roomId = `x${Date.now().toString(36)}`;
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  await join(alice, roomId, 'Alice');
  await join(bob, roomId, 'Bob');

  await createFile(alice, 'utils.py');
  await alice.locator('.monaco-editor').click();
  await alice.keyboard.type('# only in utils');

  // Alice draws on utils.py.
  await alice.getByTestId('mode-toggle').click();
  await drawStroke(alice, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(alice.getByTestId('stroke')).toHaveCount(1);

  // Bob is still on main.py: he must see neither the text nor the drawing. This negative is the
  // load-bearing assertion — "per file" only means something if the other file is really clean.
  await expect(bob.locator('.monaco-editor')).toContainText('fizzbuzz');
  await expect(bob.locator('.monaco-editor')).not.toContainText('only in utils');
  await expect(bob.getByTestId('stroke')).toHaveCount(0);

  // Bob switches to utils.py and finds both waiting.
  await bob.getByRole('button', { name: 'utils.py', exact: true }).click();
  await expect(bob.locator('.monaco-editor')).toContainText('only in utils', { timeout: 10_000 });
  await expect(bob.getByTestId('stroke')).toHaveCount(1, { timeout: 10_000 });

  // And back: main.py is untouched, and still has no drawing.
  await bob.getByRole('button', { name: 'main.py', exact: true }).click();
  await expect(bob.locator('.monaco-editor')).toContainText('fizzbuzz');
  await expect(bob.getByTestId('stroke')).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
});

test('text survives a tab round trip — it reaches the CRDT, not just the model', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await createFile(page, 'utils.py');
  await page.locator('.monaco-editor').click();
  await page.keyboard.type('MARKER_UTILS');
  await expect(page.locator('.monaco-editor')).toContainText('MARKER_UTILS');

  // Away and back. This failed before the editor owned its models: the text lived only in
  // Monaco's model, never reached the Y.Text, and the rebind wiped it.
  await page.getByRole('button', { name: 'main.py', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toContainText('fizzbuzz');

  await page.getByRole('button', { name: 'utils.py', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toContainText('MARKER_UTILS');
});

test('renaming a file changes its language, and an unknown extension disables Run', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await createFile(page, 'thing.py');
  await expect(page.getByLabel('Language')).toHaveValue('python');

  // The extension drives the language, for everyone, with no second write.
  await renameActiveFile(page, 'thing.js');
  await expect(page.getByLabel('Language')).toHaveValue('javascript');

  // No runtime for .txt: the file still edits, but Run says why it cannot run.
  await renameActiveFile(page, 'notes.txt');
  await expect(page.getByTestId('run')).toBeDisabled();
  await expect(page.getByTestId('run')).toHaveAttribute('title', /No runtime for notes\.txt/);
});

test('a duplicate name is rejected in the UI', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await page.getByTestId('new-file').click();
  await page.getByTestId('file-name-input').fill('main.py');
  await page.getByTestId('file-name-input').press('Enter');

  await expect(page.getByTestId('file-name-error')).toContainText(/already/i);
  await expect(page.getByTestId('file-tab')).toHaveCount(1);
});

test('the last file cannot be deleted', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  // By test id, not by role: `disabled:invisible` hides it from the accessibility tree too, so
  // getByRole cannot see it. With one file there is exactly one, so this is unambiguous.
  await expect(page.getByTestId('delete-file')).toBeDisabled();
});

test('deleting a file takes its drawings and moves you to a neighbour', async ({ page }) => {
  await join(page, `x${Date.now().toString(36)}`, 'Ada');
  page.on('dialog', (dialog) => dialog.accept());

  await createFile(page, 'doomed.py');
  await page.getByTestId('mode-toggle').click();
  await drawStroke(page, { x: 80, y: 60 }, { x: 200, y: 90 });
  await expect(page.getByTestId('stroke')).toHaveCount(1);

  // By label, not by test id: every tab has a delete button.
  await page.getByRole('button', { name: 'Delete doomed.py' }).click();

  await expect(page.getByTestId('file-tab')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'main.py', exact: true })).toBeVisible();
  // You are on main.py now, which was never drawn on.
  await expect(page.getByTestId('stroke')).toHaveCount(0);
});
