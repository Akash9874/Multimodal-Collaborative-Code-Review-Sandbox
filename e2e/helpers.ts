import { type Page, expect } from '@playwright/test';

export const join = async (page: Page, roomId: string, name: string): Promise<void> => {
  await page.goto(`/s/${roomId}`);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Join sandbox' }).click();
  await expect(page.getByTestId('connection-pill')).toHaveText(/connected/i);
};
