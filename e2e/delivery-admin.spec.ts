import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('metrovanai_locale', 'en');
  });
});

async function openDemoCompletedProject(page: Page) {
  await page.goto('/studio?demo=1');
  await page.getByRole('button', { name: 'Project history' }).click();
  const completedProject = page.locator('.project-tile', { hasText: 'North Van Home' });
  await completedProject.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: /North Van Home/i })).toBeVisible();
}

test('demo completed project opens result editor controls', async ({ page }) => {
  await openDemoCompletedProject(page);

  await expect(page.getByText('Results')).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(6);

  await page.locator('.result-card').first().click();
  const editor = page.locator('.result-editor-shell');
  await expect(editor).toBeVisible();
  await expect(editor.getByText('NorthVan_Living_01.JPG')).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Regenerate' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await expect(editor.getByPlaceholder('#F2E8D8')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download result' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset result editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Close result editor' }).click();
  await expect(page.locator('.result-editor-shell')).toHaveCount(0);
});

test('demo completed project exposes safe download settings', async ({ page }) => {
  await page.goto('/studio?demo=1');
  await page.getByRole('button', { name: 'Project history' }).click();
  const completedProject = page.locator('.project-tile', { hasText: 'North Van Home' });
  await completedProject.getByRole('button', { name: 'Download' }).click();

  const dialog = page.locator('.download-card');
  await expect(dialog.getByText('Download settings')).toBeVisible();
  await expect(dialog.getByText('North Van Home')).toBeVisible();
  await expect(dialog.getByLabel('Folder structure')).toHaveValue('grouped');
  await expect(dialog.getByLabel('Naming')).toHaveValue('sequence');
  await expect(dialog.getByText('HD original size')).toBeVisible();
  await page.getByRole('button', { name: 'Generate ZIP' }).click();
  await expect(page.getByText('Demo mode does not generate real download packages.')).toBeVisible();
});

test('demo admin console loads read-only navigation', async ({ page }) => {
  await page.goto('/admin?demo=1');

  await expect(page.locator('.admin-prototype')).toBeVisible();
  await expect(page.getByText('Metrovan AI')).toBeVisible();
  await expect(page.getByText('Console')).toBeVisible();
  await expect(page.getByRole('button', { name: /用户管理/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /订单管理/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /系统设置/i })).toBeVisible();

  await page.getByRole('button', { name: /订单管理/i }).click();
  await expect(page.getByText('Console')).toBeVisible();
  await expect(page.locator('.breadcrumb .current')).toHaveText('订单管理');
});
