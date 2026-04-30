import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('metrovanai_locale', 'en');
  });
});

test('landing page opens the sign-up flow', async ({ page }) => {
  await page.goto('/home');

  await expect(page.getByRole('img', { name: 'Metrovan AI' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Listing photos cleaned up/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start a Project/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /View Examples/i })).toBeVisible();

  await page.getByRole('button', { name: /Start a Project/i }).click();
  await expect(page.getByText('Sign in to Metrovan AI')).toBeVisible();
  await expect(page.getByPlaceholder('name@email.com')).toBeVisible();
  await page.getByRole('button', { name: /Sign Up/i }).first().click();
  await expect(page.getByText('Create your Metrovan AI account')).toBeVisible();
});

test('demo studio renders the review workspace controls', async ({ page }) => {
  await page.goto('/studio?demo=1');

  await expect(page.locator('.studio-shell.demo-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: /HDR True Color/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /HDR White Wall/i })).toBeVisible();

  await page.getByRole('button', { name: 'Project history' }).click();
  const demoProject = page.locator('.project-tile', { hasText: 'Jin Project' });
  await demoProject.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByRole('heading', { name: /Jin Project/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vertical Fix' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check Groups' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Process' })).toBeVisible();
  await expect(page.locator('.group-card')).toHaveCount(4);
  await expect(page.locator('.asset-card')).toHaveCount(5);
});
