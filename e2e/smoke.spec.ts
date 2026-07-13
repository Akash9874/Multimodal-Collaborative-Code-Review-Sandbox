import { expect, test } from '@playwright/test';

test('the landing page mints a room and routes to it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-room').click();

  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{10}$/);
  // A first-time visitor is asked who they are before the workspace opens.
  await expect(page.getByRole('button', { name: 'Join sandbox' })).toBeVisible();
});

test('an invalid room id is a 404', async ({ page }) => {
  const response = await page.goto('/s/no');
  expect(response?.status()).toBe(404);
});
