import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('metrovanai_locale', 'en');
  });
});

test('auth modal validates sign-up before network submission', async ({ page }) => {
  await page.goto('/home');

  await page.getByRole('button', { name: /Start a Project/i }).click();
  await page.getByRole('button', { name: /Sign Up/i }).first().click();

  await expect(page.getByText('Create your Metrovan AI account')).toBeVisible();
  const submitButton = page.locator('.auth-submit');
  await submitButton.click();
  await expect(page.getByText('Enter your email and password.')).toBeVisible();

  await page.getByPlaceholder('name@email.com').fill('listing@example.com');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('short1');
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('different1');
  await submitButton.click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Confirm password' }).fill('short1');
  await submitButton.click();
  await expect(page.getByText('Password must be at least 10 characters and include letters and numbers.')).toBeVisible();
});

test('demo billing flow exposes packages without starting real checkout', async ({ page }) => {
  await page.goto('/studio?demo=1');

  await page.getByRole('button', { name: 'Top up' }).click();
  await expect(page.getByText('Recharge credits')).toBeVisible();
  await expect(page.getByRole('button', { name: /\$100 Recharge/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /\$500 Recharge/i })).toBeVisible();

  await page.getByRole('button', { name: /Recharge now/i }).click();
  await expect(page.getByText('Demo mode does not perform real top-ups.')).toBeVisible();
  await expect(page).toHaveURL(/\/billing\?demo=1/);
});

test('demo project creation flow exposes upload preparation controls', async ({ page }) => {
  await page.goto('/studio?demo=1');

  await page.getByRole('button', { name: /HDR True Color/i }).click();
  await expect(page.getByRole('heading', { name: 'Project name' })).toBeVisible();
  await expect(page.getByText('Name this project and upload the photos that need processing.')).toBeVisible();
  await expect(page.getByLabel('Processing priority')).toHaveValue('standard');
  await expect(page.getByText('Drag RAW / JPG here, or click to choose files')).toBeVisible();
  await expect(page.locator('.feature-create-dropzone input[type="file"]')).toHaveAttribute('multiple', '');

  await page.getByPlaceholder('HDR True Color').fill('QA Listing Project');
  await expect(page.getByPlaceholder('HDR True Color')).toHaveValue('QA Listing Project');
});
