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
