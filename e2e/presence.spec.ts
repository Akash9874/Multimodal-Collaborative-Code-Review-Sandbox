import { expect, test } from '@playwright/test';
import { join } from './helpers';

test('one tab shows exactly one peer — never a StrictMode phantom', async ({ page }) => {
  await join(page, `p${Date.now().toString(36)}`, 'Ada');

  await expect(page.getByTestId('connection-pill')).toHaveText(/connected/i);
  await expect(page.getByTestId('presence-avatar')).toHaveCount(1);
});
