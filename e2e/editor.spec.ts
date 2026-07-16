import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('the editor loads the document seeded by the server, with a clean console', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await join(page, `e${Date.now().toString(36)}`, 'Ada');

  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toContainText('fizzbuzz');

  // A broken Monaco worker setup surfaces here and nowhere else.
  expect(errors).toEqual([]);
});
